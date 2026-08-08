const fs = require('node:fs');
const http = require('node:http');
const { URL } = require('node:url');
const {
  bearerHeaders,
  createIdentityChallenge,
  readHandoffToken,
  verifyHandoffIdentity
} = require('./handoff-auth');
const {
  assertSnapshotCompleteness,
  assertSnapshotForPublication,
  assertSnapshotPayload,
  assertTextEncoding,
  hasEncodingCorruption
} = require('./snapshot-policy');

const DEFAULT_URL = 'http://127.0.0.1:19091/api/snapshot';
const MAX_BYTES = 2_000_000;

function readInput() {
  const fileIndex = process.argv.indexOf('--file');
  if (fileIndex >= 0) {
    const filePath = process.argv[fileIndex + 1];
    if (!filePath) throw new Error('missing file path after --file');
    return fs.readFileSync(filePath, 'utf8');
  }
  return fs.readFileSync(0, 'utf8');
}

function responseDetail(body) {
  try {
    const parsed = JSON.parse(body);
    const detail = parsed?.error || parsed?.message;
    if (typeof detail === 'string' && detail.trim()) return `: ${detail.trim().slice(0, 240)}`;
  } catch {
    // A non-JSON response has no safe structured detail to expose.
  }
  return '';
}

function requestHandoff(target, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 12_000
    }, (result) => {
      let responseBody = '';
      let responseBytes = 0;
      result.setEncoding('utf8');
      result.on('data', (chunk) => {
        responseBytes += Buffer.byteLength(chunk, 'utf8');
        if (responseBytes > MAX_BYTES) {
          result.destroy(new Error('Pulse handoff response exceeds 2 MB'));
          return;
        }
        responseBody += chunk;
      });
      result.on('end', () => resolve({ status: result.statusCode, body: responseBody }));
    });
    request.on('timeout', () => request.destroy(new Error('Pulse handoff timed out')));
    request.on('error', reject);
    request.end(options.body || undefined);
  });
}

async function verifyHandoff(target, token) {
  const challenge = createIdentityChallenge();
  const healthUrl = new URL('/api/health', target);
  healthUrl.searchParams.set('challenge', challenge);
  const response = await requestHandoff(healthUrl);
  if (response.status !== 200) {
    throw new Error(`Pulse handoff identity check returned HTTP ${response.status}`);
  }
  let identity;
  try {
    identity = JSON.parse(response.body);
  } catch {
    throw new Error('Pulse handoff identity response is not JSON');
  }
  if (!verifyHandoffIdentity(identity, token, challenge)) {
    throw new Error('Pulse handoff identity check failed; another process may be using the configured port');
  }
}

async function publish() {
  const input = readInput();
  const raw = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error('Pulse snapshot exceeds 2 MB');
  const snapshot = assertSnapshotForPublication(JSON.parse(raw));
  const target = new URL(process.env.PULSE_HANDOFF_URL || DEFAULT_URL);
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error('Pulse handoff only permits a local 127.0.0.1 or localhost HTTP endpoint');
  }
  const token = readHandoffToken();
  await verifyHandoff(target, token);
  const body = JSON.stringify(snapshot);
  const response = await requestHandoff(target, {
    method: 'POST',
    headers: {
      ...bearerHeaders(token),
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body, 'utf8')
    },
    body
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Pulse handoff returned HTTP ${response.status}${responseDetail(response.body)}`);
  }
  console.log('Pulse dashboard snapshot published.');
}

if (require.main === module) {
  publish().catch((error) => {
    console.error(`Pulse handoff failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertSnapshot: assertSnapshotPayload,
  assertSnapshotCompleteness,
  assertTextEncoding,
  hasEncodingCorruption,
  publish,
  verifyHandoff
};
