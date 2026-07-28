const assert = require('node:assert/strict');
const { SNAPSHOT_VERSION, normalizeSnapshot } = require('../src/snapshot');

const normalized = normalizeSnapshot({
  meta: { source: 'bridge', asOf: 'not-a-date', lastUpdated: null },
  health: {
    sleep: { durationMinutes: 'bad', score: 0 },
    restingHeartRate: { value: 0, trend: null, date: '20260726' },
    hrv: { value: 0, date: 'not-a-date' },
    stress: { value: '32', date: '20260728' },
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
  trends: {
    restingHeartRate: [55, 'bad', 57],
    trainingLoad: [
      { date: '2026-07-27', shortTerm: 71, longTerm: 66, ratio: 1.07, comment: 'Optimized' },
      { date: '20260726', shortTerm: '83', longTerm: 68, ratio: 1.22 },
      { date: 'bad', shortTerm: 999 },
      { date: '2026-07-20', shortTerm: null, longTerm: null, ratio: null }
    ]
  }
}, { source: 'cache', error: 'offline' });

assert.equal(normalized.version, SNAPSHOT_VERSION);
assert.equal(normalized.meta.source, 'cache');
assert.equal(normalized.meta.error, 'offline');
assert.notEqual(normalized.meta.lastUpdated, '1970-01-01T00:00:00.000Z');
assert.equal(normalized.health.sleep.durationMinutes, null);
assert.equal(normalized.health.sleep.score, null);
assert.equal(normalized.health.restingHeartRate.value, null);
assert.equal(normalized.health.restingHeartRate.trend, null);
assert.equal(normalized.health.restingHeartRate.date, '2026-07-26');
assert.equal(normalized.health.hrv.value, null);
assert.equal(normalized.health.hrv.date, null);
assert.equal(normalized.health.stress.value, 32);
assert.equal(normalized.health.stress.date, '2026-07-28');
assert.equal(normalized.health.spo2.value, null);
assert.equal(normalized.health.steps.value, null);
assert.equal(normalized.health.recovery.value, null);
assert.equal(normalized.todayActivities[0].paceSecondsPerKm, 300);
assert.equal(normalized.todayActivities[0].heartRate, 145);
assert.equal(normalized.todayActivities[0].calories, 320);
assert.deepEqual(normalized.trends.restingHeartRate, [55, 57]);
assert.deepEqual(normalized.trends.trainingLoad, [
  { date: '2026-07-26', shortTerm: 83, longTerm: 68, ratio: 1.22, comment: '' },
  { date: '2026-07-27', shortTerm: 71, longTerm: 66, ratio: 1.07, comment: 'Optimized' }
]);
assert.equal(normalized.todayActivities[0].sport, '<script>');
console.log('Snapshot normalization passed: placeholders become unavailable values and COROS aliases are preserved.');
