const HEALTH_SIGNAL_RULES = [
  ['sleep.durationMinutes', 1, 1_440],
  ['sleep.score', 1, 100],
  ['restingHeartRate.value', 20, 240],
  ['hrv.value', 1, 500],
  ['stress.value', 1, 100],
  ['steps.value', 1, 200_000],
  ['recovery.value', 1, 100]
];
const READINESS_STATUSES = new Set(['ready', 'data_insufficient', 'stop_refer']);
const CONFIDENCE_LEVELS = new Set(['low', 'moderate', 'high']);
const RECOMMENDATION_LEVELS = new Set(['informational', 'rest', 'easy', 'moderate', 'hard']);
const MAX_SNAPSHOT_AGE_HOURS = 36;
const FUTURE_TOLERANCE_MINUTES = 10;

function valueAtPath(value, keyPath) {
  return keyPath.split('.').reduce((current, key) => current?.[key], value);
}

function isInRange(value, minimum, maximum) {
  if (value == null || value === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}

function assertSnapshotPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Pulse snapshot must be a JSON object');
  }
  if (!payload.health && !Array.isArray(payload.todayActivities)) {
    throw new Error('Pulse snapshot must include health or todayActivities');
  }
  return payload;
}

function hasEncodingCorruption(value) {
  if (typeof value !== 'string') return false;
  const visible = [...value].filter((character) => !/\s/u.test(character));
  if (visible.length < 3) return false;
  const damaged = visible.filter((character) => character === '?' || character === '\uFFFD').length;
  return damaged / visible.length >= 0.45;
}

function assertTextEncoding(snapshot) {
  const candidates = [
    ...(Array.isArray(snapshot.todayActivities) ? snapshot.todayActivities.map((activity) => activity?.sport) : []),
    snapshot.plan?.name,
    snapshot.plan?.title,
    snapshot.plan?.description,
    snapshot.insight?.text,
    ...(Array.isArray(snapshot.insight?.tags) ? snapshot.insight.tags : []),
    ...(Array.isArray(snapshot.readiness?.reasons) ? snapshot.readiness.reasons : [])
  ];
  if (candidates.some(hasEncodingCorruption)) {
    throw new Error('snapshot text encoding is corrupted; publish UTF-8 JSON');
  }
  return snapshot;
}

function countHealthSignals(snapshot) {
  const health = snapshot.health && typeof snapshot.health === 'object' ? snapshot.health : {};
  return HEALTH_SIGNAL_RULES.filter(([keyPath, minimum, maximum]) => (
    isInRange(valueAtPath(health, keyPath), minimum, maximum)
  )).length;
}

function assertSnapshotCompleteness(snapshot) {
  if (countHealthSignals(snapshot) < 2) {
    throw new Error('snapshot is incomplete: publish at least two valid health signals instead of placeholder zeros');
  }
  const insight = String(snapshot.insight?.text || '').trim();
  if (insight.length < 8 || insight.length > 1_000) {
    throw new Error('snapshot is incomplete: a concise data-grounded training insight is required');
  }
  for (const activity of Array.isArray(snapshot.todayActivities) ? snapshot.todayActivities : []) {
    const distance = Number(activity?.distanceKm);
    const duration = Number(activity?.durationSeconds);
    if (Number.isFinite(distance) && distance > 0 && (!Number.isFinite(duration) || duration <= 0)) {
      throw new Error('snapshot is incomplete: an activity with distance must include a positive duration');
    }
  }
  return snapshot;
}

function parseTimestamp(value, fieldName) {
  if (typeof value !== 'string' || !value.includes('T')) {
    throw new Error(`snapshot ${fieldName} must be an ISO 8601 timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`snapshot ${fieldName} is invalid`);
  return timestamp;
}

function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function dateKeyPlusDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function assertDatesAndFreshness(snapshot, {
  requireFresh = false,
  now = Date.now(),
  maxSnapshotAgeHours = MAX_SNAPSHOT_AGE_HOURS,
  futureToleranceMinutes = FUTURE_TOLERANCE_MINUTES
} = {}) {
  const asOf = parseTimestamp(snapshot.meta?.asOf, 'meta.asOf');
  const lastUpdated = parseTimestamp(snapshot.meta?.lastUpdated, 'meta.lastUpdated');
  if (typeof snapshot.meta?.timezone !== 'string' || !snapshot.meta.timezone.trim() || snapshot.meta.timezone.length > 64) {
    throw new Error('snapshot meta.timezone is required');
  }
  const futureTolerance = futureToleranceMinutes * 60_000;
  if (asOf > now + futureTolerance || lastUpdated > now + futureTolerance) {
    throw new Error('snapshot timestamps cannot be in the future');
  }
  if (lastUpdated + futureTolerance < asOf) {
    throw new Error('snapshot meta.lastUpdated cannot precede meta.asOf');
  }
  if (requireFresh && now - lastUpdated > maxSnapshotAgeHours * 3_600_000) {
    throw new Error(`snapshot is stale: lastUpdated exceeds ${maxSnapshotAgeHours} hours`);
  }

  const asOfDate = String(snapshot.meta.asOf).slice(0, 10);
  if (!validDateKey(asOfDate)) throw new Error('snapshot meta.asOf does not contain a valid calendar date');
  const observationDates = [
    ...Object.values(snapshot.health || {}).map((metric) => metric?.date),
    ...(Array.isArray(snapshot.trends?.trainingLoad)
      ? snapshot.trends.trainingLoad.map((point) => point?.date)
      : [])
  ].filter((value) => value != null && value !== '');
  for (const date of observationDates) {
    if (!validDateKey(date)) throw new Error(`snapshot contains an invalid YYYY-MM-DD date: ${date}`);
    if (date > asOfDate) throw new Error(`snapshot contains a future metric date: ${date}`);
  }
  const planDate = snapshot.plan?.date;
  if (planDate != null && planDate !== '') {
    if (!validDateKey(planDate)) throw new Error(`snapshot contains an invalid plan date: ${planDate}`);
    if (planDate > dateKeyPlusDays(asOfDate, 31)) throw new Error(`snapshot plan date is more than 31 days in the future: ${planDate}`);
  }
  return snapshot;
}

function assertCollectionLimits(snapshot) {
  if (!Array.isArray(snapshot.todayActivities)) throw new Error('snapshot todayActivities must be an array');
  if (snapshot.todayActivities.length > 32) throw new Error('snapshot todayActivities exceeds the 32-item limit');
  if (snapshot.insight?.tags != null && !Array.isArray(snapshot.insight.tags)) {
    throw new Error('snapshot insight.tags must be an array');
  }
  if ((snapshot.insight?.tags || []).length > 8) throw new Error('snapshot insight.tags exceeds the 8-item limit');
  for (const tag of snapshot.insight?.tags || []) {
    if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > 80) {
      throw new Error('snapshot insight.tags must contain non-empty strings up to 80 characters');
    }
  }
  if (snapshot.trends?.trainingLoad != null && !Array.isArray(snapshot.trends.trainingLoad)) {
    throw new Error('snapshot trends.trainingLoad must be an array');
  }
  if ((snapshot.trends?.trainingLoad || []).length > 31) {
    throw new Error('snapshot trends.trainingLoad exceeds the 31-item limit');
  }
  for (const activity of snapshot.todayActivities) {
    if (!activity || typeof activity !== 'object' || Array.isArray(activity)) {
      throw new Error('snapshot todayActivities must contain objects');
    }
  }
  return snapshot;
}

function subjectiveState(snapshot) {
  const subjective = snapshot.readiness?.subjective;
  const complete = Boolean(
    subjective
    && isInRange(subjective.fatigue, 0, 10)
    && isInRange(subjective.soreness, 0, 10)
    && typeof subjective.pain === 'boolean'
    && typeof subjective.illness === 'boolean'
    && typeof subjective.chestSymptoms === 'boolean'
    && typeof subjective.dizziness === 'boolean'
    && typeof subjective.collectedAt === 'string'
    && Number.isFinite(Date.parse(subjective.collectedAt))
  );
  return { subjective: subjective || {}, complete };
}

function assertReadinessGate(snapshot, { now = Date.now() } = {}) {
  const readiness = snapshot.readiness;
  if (!readiness || typeof readiness !== 'object') {
    throw new Error('snapshot readiness is required; use data_insufficient when subjective safety inputs are unavailable');
  }
  if (!READINESS_STATUSES.has(readiness.status)) throw new Error('snapshot readiness.status is invalid');
  if (!CONFIDENCE_LEVELS.has(readiness.confidence)) throw new Error('snapshot readiness.confidence is invalid');
  if (!RECOMMENDATION_LEVELS.has(readiness.recommendationLevel)) {
    throw new Error('snapshot readiness.recommendationLevel is invalid');
  }
  if (!Array.isArray(readiness.reasons) || readiness.reasons.length < 1 || readiness.reasons.length > 6) {
    throw new Error('snapshot readiness.reasons must contain 1 to 6 concise reasons');
  }
  for (const reason of readiness.reasons) {
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 240) {
      throw new Error('snapshot readiness.reasons must contain strings between 3 and 240 characters');
    }
  }

  const { subjective, complete } = subjectiveState(snapshot);
  const urgentFlag = subjective.pain === true || subjective.chestSymptoms === true || subjective.dizziness === true;
  if (urgentFlag && readiness.status !== 'stop_refer') {
    throw new Error('stop_refer must override wearable metrics when pain, chest symptoms or dizziness is reported');
  }
  if (readiness.status === 'stop_refer') {
    if (!urgentFlag) throw new Error('stop_refer requires an explicit pain, chest-symptom or dizziness flag');
    if (!['informational', 'rest'].includes(readiness.recommendationLevel)) {
      throw new Error('stop_refer cannot include a training-intensity recommendation');
    }
    return snapshot;
  }

  if (readiness.status === 'data_insufficient') {
    if (readiness.confidence !== 'low') throw new Error('data_insufficient confidence must be low');
    if (!['informational', 'rest'].includes(readiness.recommendationLevel)) {
      throw new Error('data_insufficient cannot include easy, moderate or hard training advice');
    }
    return snapshot;
  }

  if (!complete) {
    throw new Error('ready status requires current fatigue, soreness, pain, illness, chest-symptom and dizziness inputs');
  }
  const collectedAt = Date.parse(subjective.collectedAt);
  if (collectedAt > now + FUTURE_TOLERANCE_MINUTES * 60_000 || now - collectedAt > MAX_SNAPSHOT_AGE_HOURS * 3_600_000) {
    throw new Error('ready status requires subjective inputs collected within the last 36 hours');
  }
  if (subjective.pain || subjective.illness || subjective.chestSymptoms || subjective.dizziness) {
    throw new Error('ready status cannot be used when a safety flag is present');
  }
  if (readiness.confidence === 'low') throw new Error('ready confidence must be moderate or high');
  return snapshot;
}

function summarizeSnapshotCoverage(snapshot) {
  const { complete } = subjectiveState(snapshot);
  const lastUpdated = Date.parse(snapshot.meta?.lastUpdated || '');
  const ageHours = Number.isFinite(lastUpdated)
    ? Math.max(0, (Date.now() - lastUpdated) / 3_600_000)
    : null;
  return {
    healthSignals: countHealthSignals(snapshot),
    subjectiveComplete: complete,
    ageHours
  };
}

function assertSnapshotForDisplay(snapshot) {
  return assertCollectionLimits(
    assertDatesAndFreshness(
      assertSnapshotCompleteness(
        assertTextEncoding(
          assertSnapshotPayload(snapshot)
        )
      )
    )
  );
}

function assertSnapshotForPublication(snapshot, options = {}) {
  assertSnapshotForDisplay(snapshot);
  assertDatesAndFreshness(snapshot, { ...options, requireFresh: true });
  assertReadinessGate(snapshot, options);
  return snapshot;
}

module.exports = {
  CONFIDENCE_LEVELS,
  FUTURE_TOLERANCE_MINUTES,
  MAX_SNAPSHOT_AGE_HOURS,
  READINESS_STATUSES,
  RECOMMENDATION_LEVELS,
  assertCollectionLimits,
  assertDatesAndFreshness,
  assertReadinessGate,
  assertSnapshotCompleteness,
  assertSnapshotForDisplay,
  assertSnapshotForPublication,
  assertSnapshotPayload,
  assertTextEncoding,
  countHealthSignals,
  hasEncodingCorruption,
  summarizeSnapshotCoverage
};
