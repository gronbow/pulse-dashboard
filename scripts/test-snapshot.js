const assert = require('node:assert/strict');
const { SNAPSHOT_VERSION, normalizeSnapshot } = require('../src/snapshot');

const normalized = normalizeSnapshot({
  meta: { source: 'bridge', asOf: 'not-a-date' },
  health: {
    sleep: { durationMinutes: 'bad', score: 0 },
    restingHeartRate: { value: 0, trend: null },
    hrv: { value: 0 },
    spo2: { value: 0 },
    steps: { value: null },
    recovery: { value: 0 }
  },
  todayActivities: [{
    sport: '<script>',
    durationSeconds: 600,
    distanceKm: 2,
    averageHeartRate: 145,
    calorie: 320
  }],
  trends: { restingHeartRate: [55, 'bad', 57] }
}, { source: 'cache', error: 'offline' });

assert.equal(normalized.version, SNAPSHOT_VERSION);
assert.equal(normalized.meta.source, 'cache');
assert.equal(normalized.meta.error, 'offline');
assert.equal(normalized.health.sleep.durationMinutes, null);
assert.equal(normalized.health.sleep.score, null);
assert.equal(normalized.health.restingHeartRate.value, null);
assert.equal(normalized.health.restingHeartRate.trend, null);
assert.equal(normalized.health.hrv.value, null);
assert.equal(normalized.health.spo2.value, null);
assert.equal(normalized.health.steps.value, null);
assert.equal(normalized.health.recovery.value, null);
assert.equal(normalized.todayActivities[0].paceSecondsPerKm, 300);
assert.equal(normalized.todayActivities[0].heartRate, 145);
assert.equal(normalized.todayActivities[0].calories, 320);
assert.deepEqual(normalized.trends.restingHeartRate, [55, 57]);
assert.equal(normalized.todayActivities[0].sport, '<script>');
console.log('Snapshot normalization passed: placeholders become unavailable values and COROS aliases are preserved.');
