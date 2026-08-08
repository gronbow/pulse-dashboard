const assert = require('node:assert/strict');
const { createDataSourceAdapter } = require('../src/adapters/data-source-adapter');
const { SNAPSHOT_VERSION } = require('../src/snapshot');

(async () => {
  const adapter = createDataSourceAdapter({
    id: 'fixture',
    label: 'Fixture source',
    provider: 'fixture',
    fetchSnapshot: async () => ({ health: {}, todayActivities: [{ sport: 'Run', distanceKm: '5' }] }),
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
  console.log('Adapter contract passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
