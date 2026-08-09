const assert = require('node:assert/strict');
const {
  SNAPSHOT_VERSION,
  createUnavailableSnapshot,
  normalizeInsight,
  normalizeSnapshot,
  resolveFallbackSnapshot
} = require('../src/snapshot');

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
assert.deepEqual(normalizeInsight({ text: '????????????????', tags: ['????'] }), { text: '', tags: [] });

const unavailable = createUnavailableSnapshot({
  provider: 'codex-coros-mcp',
  timezone: 'Asia/Shanghai',
  error: 'handoff unavailable'
});
assert.equal(unavailable.meta.source, 'unavailable');
assert.equal(unavailable.meta.provider, 'codex-coros-mcp');
assert.equal(unavailable.meta.error, 'handoff unavailable');
assert.equal(unavailable.health.restingHeartRate.value, null);
assert.equal(unavailable.health.sleep.durationMinutes, null);
assert.equal(unavailable.todayActivities.length, 0);
assert.equal(unavailable.trends.trainingLoad.length, 0);
assert.match(unavailable.insight.text, /尚未收到真实 COROS 快照/);

const matchingCache = resolveFallbackSnapshot({
  meta: {
    source: 'bridge',
    provider: 'codex-coros-mcp',
    asOf: '2026-08-08T08:45:00Z',
    lastUpdated: '2026-08-08T08:50:00Z',
    timezone: 'Asia/Shanghai'
  },
  health: {
    restingHeartRate: { value: 52, date: '2026-08-08' },
    sleep: { durationMinutes: 420, date: '2026-08-08' }
  },
  todayActivities: [],
  readiness: {
    status: 'ready',
    confidence: 'high',
    recommendationLevel: 'hard',
    reasons: ['测试缓存原本声称可以进行高强度训练'],
    subjective: {
      collectedAt: '2026-08-08T08:40:00Z',
      fatigue: 2,
      soreness: 1,
      pain: false,
      illness: false,
      chestSymptoms: false,
      dizziness: false
    }
  }
}, { provider: 'codex-coros-mcp', error: 'offline', now: Date.parse('2026-08-08T09:00:00Z') });
assert.equal(matchingCache.meta.source, 'cache');
assert.equal(matchingCache.health.restingHeartRate.value, 52);
assert.equal(matchingCache.readiness.status, 'data_insufficient');
assert.equal(matchingCache.readiness.recommendationLevel, 'informational');

const freshReadyInput = {
  ...matchingCache,
  meta: { ...matchingCache.meta, source: 'bridge' },
  readiness: {
    status: 'ready',
    confidence: 'high',
    recommendationLevel: 'moderate',
    reasons: ['客观信号稳定且已经完成当前安全确认'],
    subjective: {
      collectedAt: '2026-08-08T08:40:00Z',
      fatigue: 2,
      soreness: 1,
      pain: false,
      illness: false,
      chestSymptoms: false,
      dizziness: false
    }
  }
};
const freshReady = normalizeSnapshot(freshReadyInput, {}, { now: Date.parse('2026-08-08T09:00:00Z') });
assert.equal(freshReady.readiness.status, 'ready');

const staleReady = normalizeSnapshot(freshReadyInput, {}, { now: Date.parse('2026-08-10T09:00:00Z') });
assert.equal(staleReady.readiness.status, 'data_insufficient');
assert.match(staleReady.readiness.reasons.join(' '), /过期/);

const forgedCustomReady = normalizeSnapshot(freshReadyInput, { provider: 'custom-http-bridge' }, {
  now: Date.parse('2026-08-08T09:00:00Z')
});
assert.equal(forgedCustomReady.readiness.status, 'data_insufficient');
assert.equal(forgedCustomReady.readiness.confidence, 'low');

const forgedMissingSubjective = normalizeSnapshot({
  ...freshReadyInput,
  readiness: { ...freshReadyInput.readiness, subjective: {} }
}, {}, { now: Date.parse('2026-08-08T09:00:00Z') });
assert.equal(forgedMissingSubjective.readiness.status, 'data_insufficient');

const mismatchedCache = resolveFallbackSnapshot({
  meta: { provider: 'mcp-bridge', timezone: 'Asia/Shanghai' },
  health: { restingHeartRate: { value: 88 } },
  todayActivities: []
}, { provider: 'codex-coros-mcp', error: 'offline' });
assert.equal(mismatchedCache.meta.source, 'unavailable');
assert.equal(mismatchedCache.health.restingHeartRate.value, null);
console.log('Snapshot normalization passed: placeholders become unavailable values and COROS aliases are preserved.');
