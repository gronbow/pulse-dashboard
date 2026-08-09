const SNAPSHOT_VERSION = 2;
const {
  FUTURE_TOLERANCE_MINUTES,
  MAX_SNAPSHOT_AGE_HOURS,
  assertSnapshotForDisplay,
  countHealthSignals,
  hasEncodingCorruption
} = require('../scripts/snapshot-policy');

function finiteNumber(value, fallback = null, minimum = -Infinity, maximum = Infinity) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return fallback;
  return number;
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 500) : fallback;
}

function listOfNumbers(value, limit = 30) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => finiteNumber(item)).filter((item) => item !== null).slice(-limit);
}

function normalizeDateKey(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  const dashedMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const match = compactMatch || dashedMatch;
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      candidate.getUTCFullYear() === year
      && candidate.getUTCMonth() === month - 1
      && candidate.getUTCDate() === day
    ) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function listOfTrainingLoad(value, limit = 7) {
  if (!Array.isArray(value)) return [];
  const byDate = new Map();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const date = normalizeDateKey(item.date ?? item.day ?? item.asOf);
    if (!date) continue;
    const point = {
      date,
      shortTerm: finiteNumber(item.shortTerm, null, 0, 10_000),
      longTerm: finiteNumber(item.longTerm, null, 0, 10_000),
      ratio: finiteNumber(item.ratio, null, 0, 10),
      comment: text(item.comment, '')
    };
    if (point.shortTerm === null && point.longTerm === null && point.ratio === null) continue;
    byDate.set(date, point);
  }
  return [...byDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-limit);
}

function validDate(value, fallback) {
  if (value == null || value === '') return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function normalizeInsight(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const insightText = text(raw.text, '');
  if (insightText.length < 8 || hasEncodingCorruption(insightText)) return { text: '', tags: [] };
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((tag) => text(tag)).filter((tag) => tag && !hasEncodingCorruption(tag)).slice(0, 8)
    : [];
  return { text: insightText, tags };
}

function normalizeReadiness(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const subjective = raw.subjective && typeof raw.subjective === 'object' ? raw.subjective : {};
  return {
    status: ['ready', 'data_insufficient', 'stop_refer'].includes(raw.status) ? raw.status : 'data_insufficient',
    confidence: ['low', 'moderate', 'high'].includes(raw.confidence) ? raw.confidence : 'low',
    recommendationLevel: ['informational', 'rest', 'easy', 'moderate', 'hard'].includes(raw.recommendationLevel)
      ? raw.recommendationLevel
      : 'informational',
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map((reason) => text(reason)).filter(Boolean).slice(0, 6) : [],
    subjective: {
      collectedAt: validDate(subjective.collectedAt, null),
      fatigue: finiteNumber(subjective.fatigue, null, 0, 10),
      soreness: finiteNumber(subjective.soreness, null, 0, 10),
      pain: booleanOrNull(subjective.pain),
      illness: booleanOrNull(subjective.illness),
      chestSymptoms: booleanOrNull(subjective.chestSymptoms),
      dizziness: booleanOrNull(subjective.dizziness)
    },
    coverage: { healthSignals: 0, subjectiveComplete: false }
  };
}

function effectiveReadiness(snapshot, now = Date.now()) {
  const readiness = snapshot.readiness;
  const subjective = readiness.subjective;
  const urgent = subjective.pain === true || subjective.chestSymptoms === true || subjective.dizziness === true;
  const downgrade = (reason, recommendationLevel = 'informational') => ({
    ...readiness,
    status: 'data_insufficient',
    confidence: 'low',
    recommendationLevel,
    reasons: [reason, ...readiness.reasons].filter((value, index, all) => value && all.indexOf(value) === index).slice(0, 6)
  });

  if (urgent) {
    return {
      ...readiness,
      status: 'stop_refer',
      confidence: 'low',
      recommendationLevel: 'rest',
      reasons: ['出现疼痛、胸部症状或头晕，安全优先并停止训练建议', ...readiness.reasons]
        .filter((value, index, all) => value && all.indexOf(value) === index)
        .slice(0, 6)
    };
  }
  if (readiness.status === 'stop_refer') return downgrade('停止训练状态缺少当前明确安全信号，不能作为即时判断');
  if (readiness.status !== 'ready') {
    return downgrade(
      readiness.reasons[0] || '尚未完成当前主观疲劳与安全确认',
      readiness.recommendationLevel === 'rest' ? 'rest' : 'informational'
    );
  }
  if (snapshot.meta.source !== 'bridge' || snapshot.meta.provider !== 'codex-coros-mcp') {
    return downgrade('缓存、演示或自定义数据源不用于给出训练强度建议');
  }
  const snapshotTime = Date.parse(snapshot.meta.lastUpdated || snapshot.meta.asOf || '');
  const collectedAt = Date.parse(subjective.collectedAt || '');
  const maximumAge = MAX_SNAPSHOT_AGE_HOURS * 3_600_000;
  const futureTolerance = FUTURE_TOLERANCE_MINUTES * 60_000;
  if (
    !Number.isFinite(snapshotTime)
    || !Number.isFinite(collectedAt)
    || now - snapshotTime > maximumAge
    || now - collectedAt > maximumAge
    || snapshotTime > now + futureTolerance
    || collectedAt > now + futureTolerance
  ) {
    return downgrade('快照或主观状态已过期，需重新确认后再给出训练强度');
  }
  if (!readiness.coverage.subjectiveComplete || subjective.illness === true) {
    return downgrade('主观疲劳、酸痛、疾病与安全状态尚未完整确认');
  }
  return readiness;
}

function normalizeActivity(activity) {
  if (!activity || typeof activity !== 'object') return null;
  const distanceKm = finiteNumber(activity.distanceKm, 0, 0, 1000);
  const durationSeconds = finiteNumber(activity.durationSeconds, 0, 0, 86_400);
  const inferredPace = distanceKm > 0 ? durationSeconds / distanceKm : null;
  const rawHeartRate = activity.heartRate ?? activity.averageHeartRate;
  const rawCalories = activity.calories ?? activity.calorie;
  const rawPace = activity.paceSecondsPerKm ?? activity.averagePaceSecondsPerKm;
  return {
    sport: text(activity.sport, '运动'),
    type: text(activity.type, 'unknown'),
    status: ['completed', 'planned', 'skipped'].includes(activity.status) ? activity.status : 'completed',
    durationSeconds,
    distanceKm,
    paceSecondsPerKm: finiteNumber(rawPace, inferredPace > 0 ? inferredPace : null, 1, 3_600),
    heartRate: finiteNumber(rawHeartRate, null, 20, 240),
    calories: finiteNumber(rawCalories, null, 1, 20_000)
  };
}

function normalizeSnapshot(input, metaOverrides = {}, { now = Date.now() } = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const rawHealth = raw.health && typeof raw.health === 'object' ? raw.health : {};
  const rawSleep = rawHealth.sleep && typeof rawHealth.sleep === 'object' ? rawHealth.sleep : {};
  const rawRhr = rawHealth.restingHeartRate && typeof rawHealth.restingHeartRate === 'object' ? rawHealth.restingHeartRate : {};
  const rawHrv = rawHealth.hrv && typeof rawHealth.hrv === 'object' ? rawHealth.hrv : {};
  const rawStress = rawHealth.stress && typeof rawHealth.stress === 'object' ? rawHealth.stress : {};
  const rawSpo2 = rawHealth.spo2 && typeof rawHealth.spo2 === 'object' ? rawHealth.spo2 : {};
  const rawSteps = rawHealth.steps && typeof rawHealth.steps === 'object' ? rawHealth.steps : {};
  const rawRecovery = rawHealth.recovery && typeof rawHealth.recovery === 'object' ? rawHealth.recovery : {};
  const rawPlan = raw.plan && typeof raw.plan === 'object' ? raw.plan : {};
  const rawLoad = raw.load && typeof raw.load === 'object' ? raw.load : {};
  const rawTrends = raw.trends && typeof raw.trends === 'object' ? raw.trends : {};
  const rawInsight = raw.insight && typeof raw.insight === 'object' ? raw.insight : {};
  const nowIso = new Date(now).toISOString();

  const normalized = {
    version: SNAPSHOT_VERSION,
    meta: {
      source: text(metaOverrides.source || raw.meta?.source, 'demo'),
      provider: text(metaOverrides.provider || raw.meta?.provider, 'unknown'),
      asOf: validDate(raw.meta?.asOf, nowIso),
      lastUpdated: validDate(raw.meta?.lastUpdated, nowIso),
      timezone: text(raw.meta?.timezone, 'Asia/Shanghai'),
      ...(metaOverrides.error ? { error: text(metaOverrides.error) } : {})
    },
    health: {
      restingHeartRate: {
        value: finiteNumber(rawRhr.value, null, 20, 240),
        unit: 'bpm',
        trend: finiteNumber(rawRhr.trend, null, -100, 100),
        date: normalizeDateKey(rawRhr.date ?? rawRhr.asOf)
      },
      hrv: {
        value: finiteNumber(rawHrv.value, null, 1, 500),
        unit: 'ms',
        status: text(rawHrv.status, 'unavailable'),
        date: normalizeDateKey(rawHrv.date ?? rawHrv.asOf)
      },
      stress: {
        value: finiteNumber(rawStress.value, null, 1, 100),
        unit: 'score',
        date: normalizeDateKey(rawStress.date ?? rawStress.asOf)
      },
      sleep: {
        durationMinutes: finiteNumber(rawSleep.durationMinutes, null, 1, 1_440),
        score: finiteNumber(rawSleep.score, null, 1, 100),
        date: normalizeDateKey(rawSleep.date ?? rawSleep.asOf)
      },
      spo2: {
        value: finiteNumber(rawSpo2.value, null, 1, 100),
        unit: '%',
        status: text(rawSpo2.status, 'unavailable'),
        date: normalizeDateKey(rawSpo2.date ?? rawSpo2.asOf)
      },
      steps: {
        value: finiteNumber(rawSteps.value, null, 0, 200_000),
        unit: 'steps',
        date: normalizeDateKey(rawSteps.date ?? rawSteps.asOf)
      },
      recovery: {
        value: finiteNumber(rawRecovery.value, null, 1, 100),
        unit: '%',
        level: text(rawRecovery.level, 'unknown'),
        date: normalizeDateKey(rawRecovery.date ?? rawRecovery.asOf)
      }
    },
    todayActivities: Array.isArray(raw.todayActivities) ? raw.todayActivities.map(normalizeActivity).filter(Boolean) : [],
    plan: {
      name: text(rawPlan.name, ''),
      status: text(rawPlan.status, 'unknown'),
      title: text(rawPlan.title, ''),
      description: text(rawPlan.description, ''),
      load: finiteNumber(rawPlan.load, null, 0, 10_000),
      date: normalizeDateKey(rawPlan.date ?? rawPlan.scheduledDate)
    },
    load: {
      comment: text(rawLoad.comment, ''),
      shortTerm: finiteNumber(rawLoad.shortTerm, null, 0, 10_000),
      longTerm: finiteNumber(rawLoad.longTerm, null, 0, 10_000),
      ratio: finiteNumber(rawLoad.ratio, null, 0, 10)
    },
    trends: {
      restingHeartRate: listOfNumbers(rawTrends.restingHeartRate),
      sleepScore: listOfNumbers(rawTrends.sleepScore),
      trainingLoad: listOfTrainingLoad(rawTrends.trainingLoad)
    },
    insight: normalizeInsight(rawInsight),
    readiness: normalizeReadiness(raw.readiness)
  };
  const subjective = normalized.readiness.subjective;
  normalized.readiness.coverage = {
    healthSignals: countHealthSignals(normalized),
    subjectiveComplete: Boolean(
      subjective.collectedAt
      && subjective.fatigue !== null
      && subjective.soreness !== null
      && subjective.pain !== null
      && subjective.illness !== null
      && subjective.chestSymptoms !== null
      && subjective.dizziness !== null
    )
  };
  normalized.readiness = effectiveReadiness(normalized, now);
  return normalized;
}

function createUnavailableSnapshot({
  provider = 'unknown',
  timezone = 'Asia/Shanghai',
  error = ''
} = {}) {
  const now = new Date().toISOString();
  const isCodex = provider === 'codex-coros-mcp';
  return normalizeSnapshot({
    meta: {
      source: 'unavailable',
      provider,
      asOf: now,
      lastUpdated: now,
      timezone
    },
    health: {},
    todayActivities: [],
    plan: {},
    load: {},
    trends: {},
    insight: {
      text: isCodex
        ? '尚未收到真实 COROS 快照，请先在 Codex 中刷新 Pulse。'
        : '尚未收到桥接快照，请先检查本地数据源连接。',
      tags: []
    },
    readiness: {
      status: 'data_insufficient',
      confidence: 'low',
      recommendationLevel: 'informational',
      reasons: ['尚未收到可验证的健康与主观状态数据'],
      subjective: {}
    }
  }, {
    source: 'unavailable',
    provider,
    ...(error ? { error } : {})
  });
}

function resolveFallbackSnapshot(cached, {
  provider = 'unknown',
  timezone = 'Asia/Shanghai',
  error = '',
  now = Date.now()
} = {}) {
  if (cached?.meta?.provider === provider) {
    try {
      assertSnapshotForDisplay(cached);
      return normalizeSnapshot(cached, { source: 'cache', provider, ...(error ? { error } : {}) }, { now });
    } catch {
      return createUnavailableSnapshot({ provider, timezone, error: error || '本机缓存未通过完整性校验' });
    }
  }
  return createUnavailableSnapshot({ provider, timezone, error });
}

module.exports = {
  SNAPSHOT_VERSION,
  createUnavailableSnapshot,
  effectiveReadiness,
  normalizeDateKey,
  normalizeInsight,
  normalizeSnapshot,
  resolveFallbackSnapshot
};
