const SNAPSHOT_VERSION = 1;

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

function validDate(value, fallback) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
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

function normalizeSnapshot(input, metaOverrides = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const rawHealth = raw.health && typeof raw.health === 'object' ? raw.health : {};
  const rawSleep = rawHealth.sleep && typeof rawHealth.sleep === 'object' ? rawHealth.sleep : {};
  const rawRhr = rawHealth.restingHeartRate && typeof rawHealth.restingHeartRate === 'object' ? rawHealth.restingHeartRate : {};
  const rawHrv = rawHealth.hrv && typeof rawHealth.hrv === 'object' ? rawHealth.hrv : {};
  const rawSpo2 = rawHealth.spo2 && typeof rawHealth.spo2 === 'object' ? rawHealth.spo2 : {};
  const rawSteps = rawHealth.steps && typeof rawHealth.steps === 'object' ? rawHealth.steps : {};
  const rawRecovery = rawHealth.recovery && typeof rawHealth.recovery === 'object' ? rawHealth.recovery : {};
  const rawPlan = raw.plan && typeof raw.plan === 'object' ? raw.plan : {};
  const rawLoad = raw.load && typeof raw.load === 'object' ? raw.load : {};
  const rawTrends = raw.trends && typeof raw.trends === 'object' ? raw.trends : {};
  const rawInsight = raw.insight && typeof raw.insight === 'object' ? raw.insight : {};
  const now = new Date().toISOString();

  return {
    version: SNAPSHOT_VERSION,
    meta: {
      source: text(metaOverrides.source || raw.meta?.source, 'demo'),
      provider: text(metaOverrides.provider || raw.meta?.provider, 'unknown'),
      asOf: validDate(raw.meta?.asOf, now),
      lastUpdated: validDate(raw.meta?.lastUpdated, now),
      timezone: text(raw.meta?.timezone, 'Asia/Shanghai'),
      ...(metaOverrides.error ? { error: text(metaOverrides.error) } : {})
    },
    health: {
      restingHeartRate: {
        value: finiteNumber(rawRhr.value, null, 20, 240),
        unit: 'bpm',
        trend: finiteNumber(rawRhr.trend, null, -100, 100)
      },
      hrv: {
        value: finiteNumber(rawHrv.value, null, 1, 500),
        unit: 'ms',
        status: text(rawHrv.status, 'unavailable')
      },
      sleep: {
        durationMinutes: finiteNumber(rawSleep.durationMinutes, null, 1, 1_440),
        score: finiteNumber(rawSleep.score, null, 1, 100)
      },
      spo2: {
        value: finiteNumber(rawSpo2.value, null, 1, 100),
        unit: '%',
        status: text(rawSpo2.status, 'unavailable')
      },
      steps: {
        value: finiteNumber(rawSteps.value, null, 0, 200_000),
        unit: 'steps'
      },
      recovery: {
        value: finiteNumber(rawRecovery.value, null, 1, 100),
        unit: '%',
        level: text(rawRecovery.level, 'unknown')
      }
    },
    todayActivities: Array.isArray(raw.todayActivities) ? raw.todayActivities.map(normalizeActivity).filter(Boolean) : [],
    plan: {
      name: text(rawPlan.name, ''),
      status: text(rawPlan.status, 'unknown'),
      title: text(rawPlan.title, ''),
      description: text(rawPlan.description, ''),
      load: finiteNumber(rawPlan.load, null, 0, 10_000)
    },
    load: {
      comment: text(rawLoad.comment, ''),
      shortTerm: finiteNumber(rawLoad.shortTerm, null, 0, 10_000),
      longTerm: finiteNumber(rawLoad.longTerm, null, 0, 10_000),
      ratio: finiteNumber(rawLoad.ratio, null, 0, 10)
    },
    trends: {
      restingHeartRate: listOfNumbers(rawTrends.restingHeartRate),
      sleepScore: listOfNumbers(rawTrends.sleepScore)
    },
    insight: {
      text: text(rawInsight.text, ''),
      tags: Array.isArray(rawInsight.tags) ? rawInsight.tags.map((tag) => text(tag)).filter(Boolean).slice(0, 8) : []
    }
  };
}

module.exports = { SNAPSHOT_VERSION, normalizeSnapshot };
