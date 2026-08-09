const assert = require('node:assert/strict');
const { createDataSourceAdapter } = require('../src/adapters/data-source-adapter');
const { SNAPSHOT_VERSION } = require('../src/snapshot');

(async () => {
  const validRawSnapshot = {
    meta: {
      source: 'bridge',
      provider: 'fixture',
      asOf: '2026-08-08T08:45:00Z',
      lastUpdated: '2026-08-08T08:50:00Z',
      timezone: 'Asia/Shanghai'
    },
    health: {
      sleep: { durationMinutes: 420, date: '2026-08-08' },
      restingHeartRate: { value: 52, date: '2026-08-08' }
    },
    todayActivities: [{ sport: 'Run', distanceKm: '5', durationSeconds: 1_500 }],
    insight: {},
    readiness: {
      status: 'data_insufficient',
      confidence: 'low',
      recommendationLevel: 'informational',
      reasons: ['主观状态尚未确认'],
      subjective: {}
    }
  };
  const adapter = createDataSourceAdapter({
    id: 'fixture',
    label: 'Fixture source',
    provider: 'fixture',
    fetchSnapshot: async () => validRawSnapshot,
    generateInsight: async (snapshot) => ({ text: `${snapshot.todayActivities.length} activity` })
  });
  const snapshot = await adapter.fetchTrainingData();
  assert.equal(adapter.protocolVersion, 1);
  assert.equal(adapter.provider, 'fixture');
  assert.equal(snapshot.version, SNAPSHOT_VERSION);
  assert.equal(snapshot.todayActivities[0].distanceKm, 5);
  assert.deepEqual(await adapter.generateInsight(snapshot), { text: '1 activity' });
  await assert.rejects(
    () => createDataSourceAdapter({ id: 'invalid', label: 'Invalid', fetchSnapshot: async () => ({}) }).fetchSnapshot(),
    /missing health or todayActivities/
  );
  await assert.rejects(
    () => createDataSourceAdapter({
      id: 'missing-meta',
      label: 'Missing metadata',
      fetchSnapshot: async () => ({ ...validRawSnapshot, meta: undefined })
    }).fetchSnapshot(),
    /meta\.asOf/
  );
  console.log('Adapter contract passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
