const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeSnapshot } = require('../src/snapshot');
const { isSnapshotExpired } = require('../src/secure-snapshot-store');
const {
  HANDOFF_PROTOCOL_VERSION,
  HANDOFF_SERVICE,
  createIdentityProof,
  getOrCreateHandoffCredentials,
  isAuthorizedRequest,
  isValidIdentityChallenge,
  resolveHandoffAuthPath
} = require('../scripts/handoff-auth');

const configuredPort = Number(process.env.PULSE_HANDOFF_PORT);
const CODEX_HANDOFF_PORT = Number.isInteger(configuredPort) && configuredPort >= 0 && configuredPort <= 65_535
  ? configuredPort
  : 19091;
const CODEX_HANDOFF_URL = `http://127.0.0.1:${CODEX_HANDOFF_PORT}`;
const MAX_BODY_BYTES = 2_000_000;

function resolveHandoffPath(environment = process.env) {
  if (environment.PULSE_HANDOFF_PATH) return environment.PULSE_HANDOFF_PATH;
  const base = environment.LOCALAPPDATA || environment.APPDATA || os.homedir();
  return path.join(base, 'PulseDashboard', 'codex-handoff-snapshot.json');
}

function assertSnapshotPayload(payload) {
  if (!payload || typeof payload !== 'object' || (!payload.health && !Array.isArray(payload.todayActivities))) {
    throw new Error('Codex handoff requires health or todayActivities');
  }
  return payload;
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function isLocalHostHeader(value) {
  const host = String(value || '').trim().toLowerCase();
  return /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host);
}

function isJsonRequest(request) {
  return /^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('handoff payload exceeds 2 MB');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('handoff payload is not JSON');
  }
}

function hasEncodingCorruption(value) {
  if (typeof value !== 'string') return false;
  const visible = [...value].filter((character) => !/\s/u.test(character));
  if (visible.length < 3) return false;
  const damaged = visible.filter((character) => character === '?' || character === '\uFFFD').length;
  return damaged / visible.length >= 0.45;
}

function assertTextEncoding(payload) {
  const candidates = [
    ...(Array.isArray(payload.todayActivities) ? payload.todayActivities.map((activity) => activity?.sport) : []),
    payload.plan?.name,
    payload.plan?.title,
    payload.plan?.description,
    payload.insight?.text,
    ...(Array.isArray(payload.insight?.tags) ? payload.insight.tags : [])
  ];
  if (candidates.some(hasEncodingCorruption)) {
    throw new Error('snapshot text encoding is corrupted; publish UTF-8 JSON with the Pulse publish script');
  }
  return payload;
}

function isInRange(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}

function assertSnapshotCompleteness(payload) {
  const health = payload.health && typeof payload.health === 'object' ? payload.health : {};
  const signals = [
    isInRange(health.sleep?.durationMinutes, 1, 1_440),
    isInRange(health.sleep?.score, 1, 100),
    isInRange(health.restingHeartRate?.value, 20, 240),
    isInRange(health.hrv?.value, 1, 500),
    isInRange(health.stress?.value, 1, 100),
    isInRange(health.steps?.value, 1, 200_000),
    isInRange(health.recovery?.value, 1, 100)
  ].filter(Boolean).length;
  if (signals < 2) {
    throw new Error('snapshot is incomplete: publish at least two valid health signals instead of placeholder zeros');
  }

  const insight = String(payload.insight?.text || '').trim();
  if (insight.length < 8) {
    throw new Error('snapshot is incomplete: a data-grounded training insight is required');
  }

  for (const activity of Array.isArray(payload.todayActivities) ? payload.todayActivities : []) {
    const distance = Number(activity?.distanceKm);
    const duration = Number(activity?.durationSeconds);
    if (Number.isFinite(distance) && distance > 0 && (!Number.isFinite(duration) || duration <= 0)) {
      throw new Error('snapshot is incomplete: an activity with distance must include a positive duration');
    }
  }
  return payload;
}

function writeTextAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, value, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function createCodexHandoffServer({
  filePath = resolveHandoffPath(),
  authPath = resolveHandoffAuthPath(),
  authToken,
  encodeSnapshot = (value) => JSON.stringify(value, null, 2),
  decodeSnapshot = (value) => JSON.parse(value),
  getRetentionDays = () => 7
} = {}) {
  const credentials = authToken
    ? { token: authToken }
    : getOrCreateHandoffCredentials(authPath);
  const handoffToken = credentials.token;
  let snapshot = null;
  let lastError = '等待 Codex 快照';
  let server;

  function readSnapshot() {
    if (!filePath) return snapshot;
    try {
      const decoded = decodeSnapshot(fs.readFileSync(filePath, 'utf8'));
      const raw = assertSnapshotCompleteness(assertTextEncoding(assertSnapshotPayload(decoded)));
      if (isSnapshotExpired(raw, getRetentionDays())) {
        fs.unlinkSync(filePath);
        throw Object.assign(new Error('stored snapshot exceeded the configured retention period'), { code: 'ENOENT' });
      }
      snapshot = normalizeSnapshot(raw, { source: 'bridge', provider: 'codex-coros-mcp' });
      lastError = '';
      return snapshot;
    } catch (error) {
      snapshot = null;
      lastError = error.code === 'ENOENT' ? '等待 Codex 快照' : `无法读取 Codex 快照：${error.message}`;
      return null;
    }
  }

  function saveSnapshot(payload) {
    const normalized = normalizeSnapshot(assertSnapshotCompleteness(assertTextEncoding(assertSnapshotPayload(payload))), { source: 'bridge', provider: 'codex-coros-mcp' });
    if (filePath) writeTextAtomic(filePath, encodeSnapshot(normalized));
    snapshot = normalized;
    lastError = '';
    server?.emit('snapshot-updated', {
      lastUpdated: normalized.meta.lastUpdated,
      provider: normalized.meta.provider
    });
    return normalized;
  }

  function clearSnapshot() {
    snapshot = null;
    lastError = '等待 Codex 快照';
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    server?.emit('snapshot-cleared');
  }

  readSnapshot();
  server = http.createServer(async (request, response) => {
    if (!isLocalHostHeader(request.headers.host) || request.headers.origin) {
      json(response, 403, { error: 'local_requests_only' });
      return;
    }
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
      const challenge = requestUrl.searchParams.get('challenge');
      if (!isValidIdentityChallenge(challenge)) {
        json(response, 400, { error: 'identity_challenge_required' });
        return;
      }
      const identity = {
        ok: true,
        service: HANDOFF_SERVICE,
        version: HANDOFF_PROTOCOL_VERSION,
        proof: createIdentityProof(handoffToken, challenge)
      };
      if (!isAuthorizedRequest(request, handoffToken)) {
        json(response, 200, identity);
        return;
      }
      const current = readSnapshot();
      json(response, 200, {
        ...identity,
        ready: Boolean(current),
        lastUpdated: current?.meta?.lastUpdated || null,
        message: current ? 'Codex 快照可用' : lastError
      });
      return;
    }
    if (!isAuthorizedRequest(request, handoffToken)) {
      json(response, 401, { error: 'handoff_authentication_required' });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/snapshot') {
      const current = readSnapshot();
      if (!current) {
        json(response, 503, { error: 'codex_snapshot_unavailable', message: lastError });
        return;
      }
      json(response, 200, current);
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/snapshot') {
      if (!isJsonRequest(request)) {
        json(response, 415, { error: 'json_content_type_required' });
        return;
      }
      try {
        const current = saveSnapshot(await readJsonBody(request));
        json(response, 201, { ok: true, lastUpdated: current.meta.lastUpdated, provider: current.meta.provider });
      } catch (error) {
        json(response, error.message.includes('2 MB') ? 413 : 400, { error: 'invalid_codex_snapshot', message: error.message });
      }
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/insight') {
      const current = readSnapshot();
      if (!current) {
        json(response, 503, { error: 'codex_snapshot_unavailable', message: lastError });
        return;
      }
      json(response, 200, { text: current.insight.text || 'Codex 快照暂未包含训练洞察。', tags: current.insight.tags || [] });
      return;
    }
    json(response, 404, { error: 'not_found' });
  });

  server.handoffPath = filePath;
  server.authPath = authPath;
  server.handoffToken = handoffToken;
  server.clearSnapshot = clearSnapshot;
  return server;
}

if (require.main === module) {
  const server = createCodexHandoffServer({ filePath: null });
  server.listen(CODEX_HANDOFF_PORT, '127.0.0.1', () => {
    console.log(`Pulse Codex handoff listening at ${CODEX_HANDOFF_URL}`);
  });
}

module.exports = {
  CODEX_HANDOFF_PORT,
  CODEX_HANDOFF_URL,
  createCodexHandoffServer,
  isLocalHostHeader,
  resolveHandoffPath
};
