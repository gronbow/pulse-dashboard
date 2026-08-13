const assert = require('node:assert/strict');
const {
  assertSnapshotForDisplay,
  assertSnapshotForPublication,
  PROVENANCE_VALUES,
  summarizeSnapshotCoverage
} = require('./snapshot-policy');
const { PROVENANCE_VALUES: RENDERER_PROVENANCE_VALUES } = require('../src/data-trust');

const now = Date.parse('2026-08-08T09:00:00Z');
const base = {
  meta: {
    asOf: '2026-08-08T08:45:00Z',
    lastUpdated: '2026-08-08T08:50:00Z',
    timezone: 'Asia/Shanghai'
  },
  health: {
    sleep: { durationMinutes: 420, score: 88, date: '2026-08-08' },
    restingHeartRate: { value: 52, date: '2026-08-08' },
    hrv: { value: 74, date: '2026-08-08' }
  },
  todayActivities: [],
  plan: { date: '2026-08-09' },
  trends: { trainingLoad: [{ date: '2026-08-08', shortTerm: 65, longTerm: 64, ratio: 1.02 }] },
  insight: { text: '客观健康数据可用于展示，但尚未确认今天的主观疲劳与安全状态。', tags: ['数据待补充'] },
  readiness: {
    status: 'data_insufficient',
    confidence: 'low',
    recommendationLevel: 'informational',
    reasons: ['尚未收集主观疲劳与安全状态'],
    subjective: {}
  }
};

const copy = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(PROVENANCE_VALUES, RENDERER_PROVENANCE_VALUES);
assert.doesNotThrow(() => assertSnapshotForPublication(copy(base), { now }));
assert.equal(summarizeSnapshotCoverage(base).healthSignals, 4);
assert.equal(summarizeSnapshotCoverage(base).subjectiveComplete, false);

const objectiveOnly = copy(base);
delete objectiveOnly.insight;
assert.doesNotThrow(() => assertSnapshotForPublication(objectiveOnly, { now }));

const corruptInsight = copy(base);
corruptInsight.insight = { text: '????????????????', tags: ['????'] };
assert.doesNotThrow(() => assertSnapshotForDisplay(corruptInsight));

const ready = copy(base);
ready.readiness = {
  status: 'ready',
  confidence: 'moderate',
  recommendationLevel: 'moderate',
  reasons: ['客观信号稳定且已完成主观安全确认'],
  subjective: {
    collectedAt: '2026-08-08T08:55:00Z',
    fatigue: 3,
    soreness: 2,
    pain: false,
    illness: false,
    chestSymptoms: false,
    dizziness: false
  }
};
assert.doesNotThrow(() => assertSnapshotForPublication(ready, { now }));

const missingSubjective = copy(ready);
missingSubjective.readiness.subjective.fatigue = null;
assert.throws(() => assertSnapshotForPublication(missingSubjective, { now }), /requires current fatigue/);

const unsafeReady = copy(ready);
unsafeReady.readiness.subjective.pain = true;
assert.throws(() => assertSnapshotForPublication(unsafeReady, { now }), /stop_refer must override/);

const stopped = copy(unsafeReady);
stopped.readiness.status = 'stop_refer';
stopped.readiness.recommendationLevel = 'rest';
stopped.readiness.reasons = ['报告运动相关疼痛，停止训练并寻求合适的专业评估'];
assert.doesNotThrow(() => assertSnapshotForPublication(stopped, { now }));

const stale = copy(base);
stale.meta.asOf = '2026-08-01T08:45:00Z';
stale.meta.lastUpdated = '2026-08-01T08:50:00Z';
stale.health.sleep.date = '2026-08-01';
stale.health.restingHeartRate.date = '2026-08-01';
stale.health.hrv.date = '2026-08-01';
stale.plan.date = '2026-08-02';
stale.trends.trainingLoad[0].date = '2026-08-01';
assert.doesNotThrow(() => assertSnapshotForDisplay(stale));
assert.throws(() => assertSnapshotForPublication(stale, { now }), /snapshot is stale/);

const future = copy(base);
future.meta.lastUpdated = '2026-08-08T10:00:00Z';
assert.throws(() => assertSnapshotForPublication(future, { now }), /future/);

const futureMetric = copy(base);
futureMetric.health.sleep.date = '2026-08-09';
assert.throws(() => assertSnapshotForPublication(futureMetric, { now }), /future metric date/);

const timezoneMidnight = copy(base);
timezoneMidnight.meta.asOf = '2026-08-07T16:30:00Z';
timezoneMidnight.meta.lastUpdated = '2026-08-07T16:31:00Z';
assert.doesNotThrow(() => assertSnapshotForPublication(timezoneMidnight, {
  now: Date.parse('2026-08-07T16:35:00Z')
}));

const invalidTimezone = copy(base);
invalidTimezone.meta.timezone = 'Not/A_Timezone';
assert.throws(() => assertSnapshotForDisplay(invalidTimezone), /valid IANA timezone/);

const tooManyActivities = copy(base);
tooManyActivities.todayActivities = Array.from({ length: 33 }, () => ({ sport: '跑步', durationSeconds: 60 }));
assert.throws(() => assertSnapshotForPublication(tooManyActivities, { now }), /32-item limit/);

const badDate = copy(base);
badDate.health.sleep.date = '2026-02-30';
assert.throws(() => assertSnapshotForPublication(badDate, { now }), /invalid YYYY-MM-DD/);

const validProvenance = copy(base);
validProvenance.health.sleep.provenance = 'coros';
validProvenance.todayActivities = [{ sport: 'Run', durationSeconds: 600, provenance: 'coros' }];
validProvenance.plan.provenance = 'coros';
validProvenance.load = { shortTerm: 60, provenance: 'derived' };
assert.doesNotThrow(() => assertSnapshotForPublication(validProvenance, { now }));

const invalidProvenance = copy(base);
invalidProvenance.health.sleep.provenance = '<remote-endpoint>';
assert.throws(() => assertSnapshotForDisplay(invalidProvenance), /provenance/);

const inheritedProvenance = copy(base);
inheritedProvenance.health.sleep = Object.assign(Object.create({ provenance: '<remote-endpoint>' }), inheritedProvenance.health.sleep);
assert.doesNotThrow(() => assertSnapshotForDisplay(inheritedProvenance));

console.log('Snapshot policy passed: freshness, limits, readiness and stop/refer override are enforced.');
