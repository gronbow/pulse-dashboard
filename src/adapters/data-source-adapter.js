const { normalizeSnapshot } = require('../snapshot');
const { assertSnapshotForDisplay } = require('../../scripts/snapshot-policy');

const ADAPTER_PROTOCOL_VERSION = 1;

function assertSnapshotPayload(payload) {
  if (!payload || typeof payload !== 'object' || (!payload.health && !Array.isArray(payload.todayActivities))) {
    throw new Error('data source snapshot is missing health or todayActivities');
  }
  return payload;
}

function createDataSourceAdapter({ id, label, provider = 'generic', fetchSnapshot, generateInsight }) {
  if (!id || !label || typeof fetchSnapshot !== 'function') {
    throw new TypeError('data source adapter requires id, label, and fetchSnapshot');
  }

  const readSnapshot = async (context) => {
    const raw = assertSnapshotPayload(await fetchSnapshot(context));
    assertSnapshotForDisplay(raw);
    return normalizeSnapshot(raw, { provider });
  };
  const adapter = {
    protocolVersion: ADAPTER_PROTOCOL_VERSION,
    id,
    label,
    provider,
    fetchSnapshot: readSnapshot,
    fetchHealthData: readSnapshot,
    fetchTrainingData: readSnapshot,
    fetchPlan: readSnapshot,
    generateInsight: typeof generateInsight === 'function'
      ? (snapshot, context) => {
        assertSnapshotForDisplay(assertSnapshotPayload(snapshot));
        return generateInsight(normalizeSnapshot(snapshot, { provider }), context);
      }
      : null
  };
  return Object.freeze(adapter);
}

module.exports = { ADAPTER_PROTOCOL_VERSION, assertSnapshotPayload, createDataSourceAdapter };
