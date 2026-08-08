const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createIdentityChallenge,
  createIdentityProof,
  getOrCreateHandoffCredentials,
  readHandoffCredentials,
  verifyHandoffIdentity
} = require('./handoff-auth');
const {
  createSecureSnapshotCodec,
  isSnapshotExpired,
  normalizeRetentionDays
} = require('../src/secure-snapshot-store');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-security-test-'));
try {
  const authPath = path.join(tempDir, 'handoff-auth.json');
  const created = getOrCreateHandoffCredentials(authPath);
  assert.equal(created.token.length >= 43, true);
  assert.deepEqual(readHandoffCredentials(authPath), created);
  assert.deepEqual(getOrCreateHandoffCredentials(authPath), created);

  const challenge = createIdentityChallenge();
  const identity = {
    service: 'pulse-codex-handoff',
    version: 2,
    proof: createIdentityProof(created.token, challenge)
  };
  assert.equal(verifyHandoffIdentity(identity, created.token, challenge), true);
  assert.equal(verifyHandoffIdentity({ ...identity, proof: 'invalid' }, created.token, challenge), false);

  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0x5a)),
    decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString('utf8')
  };
  const codec = createSecureSnapshotCodec(fakeSafeStorage);
  const snapshot = { meta: { lastUpdated: new Date().toISOString() }, health: { steps: { value: 1234 } } };
  const encoded = codec.encode(snapshot);
  assert.equal(encoded.includes('1234'), false);
  assert.deepEqual(codec.decode(encoded), snapshot);
  assert.equal(isSnapshotExpired(snapshot, 7), false);
  assert.equal(isSnapshotExpired({ meta: { lastUpdated: '2000-01-01T00:00:00Z' } }, 30), true);
  assert.equal(normalizeRetentionDays(999), 7);
  console.log('Local security passed: credentials, identity proofs, secure envelopes and retention are enforced.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
