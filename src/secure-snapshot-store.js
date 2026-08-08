const STORE_VERSION = 2;
const ALLOWED_RETENTION_DAYS = new Set([1, 7, 30]);

function normalizeRetentionDays(value) {
  const days = Number(value);
  return ALLOWED_RETENTION_DAYS.has(days) ? days : 7;
}

function snapshotTimestamp(snapshot) {
  const raw = snapshot?.meta?.lastUpdated || snapshot?.meta?.asOf || '';
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isSnapshotExpired(snapshot, retentionDays, now = Date.now()) {
  const timestamp = snapshotTimestamp(snapshot);
  if (timestamp == null) return true;
  return now - timestamp > normalizeRetentionDays(retentionDays) * 86_400_000;
}

function createSecureSnapshotCodec(safeStorage) {
  function assertAvailable() {
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows secure storage is unavailable; Pulse will not write a plaintext health cache');
    }
  }

  return {
    encode(snapshot) {
      assertAvailable();
      const encrypted = safeStorage.encryptString(JSON.stringify(snapshot));
      return JSON.stringify({
        version: STORE_VERSION,
        encrypted: true,
        scheme: 'electron-safe-storage',
        payload: encrypted.toString('base64')
      });
    },
    decode(serialized) {
      assertAvailable();
      const envelope = JSON.parse(String(serialized || ''));
      if (
        envelope?.version !== STORE_VERSION
        || envelope?.encrypted !== true
        || envelope?.scheme !== 'electron-safe-storage'
        || typeof envelope?.payload !== 'string'
      ) {
        throw new Error('Pulse secure snapshot store has an unsupported format');
      }
      return JSON.parse(safeStorage.decryptString(Buffer.from(envelope.payload, 'base64')));
    }
  };
}

module.exports = {
  STORE_VERSION,
  createSecureSnapshotCodec,
  isSnapshotExpired,
  normalizeRetentionDays,
  snapshotTimestamp
};
