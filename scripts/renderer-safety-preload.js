const { contextBridge } = require('electron');

const config = {
  dataSource: 'demo',
  bridgeUrl: '',
  timezone: 'Asia/Shanghai',
  refreshIntervalMinutes: 30,
  dataRetentionDays: 7,
  alwaysOnTop: false,
  launchAtLogin: false,
  compactMode: false,
  compactAspectRatio: '16:9',
  theme: 'dark',
  opacity: 96
};

const snapshot = {
  meta: {
    source: 'demo',
    provider: 'synthetic-renderer-test',
    timezone: 'Asia/Shanghai',
    asOf: '2026-08-10T08:00:00+08:00',
    lastUpdated: '2026-08-10T08:00:00+08:00'
  },
  readiness: {
    status: 'ready',
    confidence: 'high',
    coverage: { healthSignals: 6, subjectiveComplete: true }
  },
  health: {
    sleep: { durationMinutes: 440, score: 86, date: '2026-08-10' },
    restingHeartRate: { value: 51, trend: -1, date: '2026-08-10' },
    hrv: { value: 62, status: 'normal', date: '2026-08-10' },
    recovery: { value: 73, level: 'training_as_planned', date: '2026-08-10' },
    steps: { value: 4321, date: '2026-08-10' },
    stress: { value: 28, date: '2026-08-10' },
    spo2: { value: 98, date: '2026-08-10' }
  },
  todayActivities: [{
    sport: '合成已完成跑步',
    status: 'completed',
    durationSeconds: 1800,
    distanceKm: 5,
    paceSecondsPerKm: 360,
    heartRate: 138,
    calories: 280
  }],
  plan: {
    date: '2026-08-10',
    title: '合成节奏跑',
    name: '合成节奏跑',
    description: '合成的可执行训练说明。',
    status: 'planned',
    load: 88
  },
  load: { shortTerm: 210, longTerm: 190, ratio: 1.11 },
  trends: { trainingLoad: [], restingHeartRate: [], sleepScore: [] },
  insight: { text: '合成准备状态已确认。', tags: ['合成数据'] }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

contextBridge.exposeInMainWorld('pulseDesktop', {
  getConfig: async () => clone(config),
  updateConfig: async (updates) => ({ ...clone(config), ...clone(updates) }),
  getSnapshot: async () => clone(snapshot),
  testBridge: async () => ({ ok: true, message: '合成桥接正常' }),
  generateInsight: async () => ({ text: '预加载合成洞察。', tags: ['合成数据'] }),
  clearLocalData: async () => ({ cleared: false }),
  hide: () => {},
  quit: () => {},
  onRefresh: () => () => {},
  onOpenSettings: () => () => {}
});
