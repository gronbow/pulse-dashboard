const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HANDOFF_SERVICE = 'pulse-codex-handoff';
const HANDOFF_PROTOCOL_VERSION = 2;
const TOKEN_BYTES = 32;

function resolveHandoffAuthPath(environment = process.env) {
  if (environment.PULSE_HANDOFF_AUTH_PATH) return path.resolve(environment.PULSE_HANDOFF_AUTH_PATH);
  const base = environment.LOCALAPPDATA || environment.APPDATA || os.homedir();
  return path.join(base, 'PulseDashboard', 'handoff-auth.json');
}

function assertToken(value) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
    throw new Error('Pulse handoff authentication token is missing or invalid');
  }
  return token;
}

function readHandoffCredentials(filePath = resolveHandoffAuthPath()) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (value?.service !== HANDOFF_SERVICE || value?.version !== 1) {
    throw new Error('Pulse handoff authentication file has an unsupported format');
  }
  return { service: HANDOFF_SERVICE, version: 1, token: assertToken(value.token) };
}

function getOrCreateHandoffCredentials(filePath = resolveHandoffAuthPath()) {
  try {
    return readHandoffCredentials(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const credentials = {
    service: HANDOFF_SERVICE,
    version: 1,
    token: crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  };
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(credentials, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    try { fs.chmodSync(filePath, 0o600); } catch { /* Windows user-profile ACL remains authoritative. */ }
    return credentials;
  } catch (error) {
    if (error.code === 'EEXIST') return readHandoffCredentials(filePath);
    throw error;
  }
}

function readHandoffToken(environment = process.env) {
  if (environment.PULSE_HANDOFF_TOKEN) return assertToken(environment.PULSE_HANDOFF_TOKEN);
  return readHandoffCredentials(resolveHandoffAuthPath(environment)).token;
}

function bearerHeaders(token) {
  return {
    Authorization: `Bearer ${assertToken(token)}`,
    'X-Pulse-Client': 'pulse-dashboard'
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorizedRequest(request, token) {
  const match = /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization || '').trim());
  return Boolean(match && safeEqual(match[1], assertToken(token)));
}

function createIdentityChallenge() {
  return crypto.randomBytes(24).toString('hex');
}

function isValidIdentityChallenge(value) {
  return /^[a-f0-9]{32,128}$/i.test(String(value || ''));
}

function createIdentityProof(token, challenge) {
  if (!isValidIdentityChallenge(challenge)) throw new Error('Pulse handoff identity challenge is invalid');
  return crypto
    .createHmac('sha256', assertToken(token))
    .update(`${HANDOFF_SERVICE}:${HANDOFF_PROTOCOL_VERSION}:${challenge}`)
    .digest('base64url');
}

function verifyHandoffIdentity(payload, token, challenge) {
  if (payload?.service !== HANDOFF_SERVICE || payload?.version !== HANDOFF_PROTOCOL_VERSION) return false;
  return safeEqual(payload.proof, createIdentityProof(token, challenge));
}

module.exports = {
  HANDOFF_PROTOCOL_VERSION,
  HANDOFF_SERVICE,
  bearerHeaders,
  createIdentityChallenge,
  createIdentityProof,
  getOrCreateHandoffCredentials,
  isAuthorizedRequest,
  isValidIdentityChallenge,
  readHandoffCredentials,
  readHandoffToken,
  resolveHandoffAuthPath,
  verifyHandoffIdentity
};
