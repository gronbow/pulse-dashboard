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
const {
  assertSnapshotForDisplay,
  assertSnapshotForPublication
} = require('../scripts/snapshot-policy');

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
      const raw = assertSnapshotForDisplay(decoded);
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
    const normalized = normalizeSnapshot(assertSnapshotForPublication(payload), { source: 'bridge', provider: 'codex-coros-mcp' });
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
