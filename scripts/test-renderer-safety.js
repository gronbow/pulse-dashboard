const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('disable-gpu');

async function waitForRenderer(window, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await window.webContents.executeJavaScript(
      "document.body.dataset.snapshotReady === 'true' && typeof render === 'function' && typeof regenerateInsight === 'function'",
      true
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Renderer safety test timed out waiting for the real dashboard renderer');
}

const behaviorTest = String.raw`
(async () => {
  function equal(actual, expected, label) {
    if (actual !== expected) {
      throw new Error(label + ': expected ' + JSON.stringify(expected) + ', received ' + JSON.stringify(actual));
    }
  }

  function includes(actual, expected, label) {
    if (!String(actual).includes(expected)) {
      throw new Error(label + ': expected ' + JSON.stringify(actual) + ' to include ' + JSON.stringify(expected));
    }
  }

  const ready = {
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
  const insufficient = {
    ...ready,
    readiness: {
      status: 'data_insufficient',
      confidence: 'low',
      coverage: { healthSignals: 6, subjectiveComplete: false }
    }
  };
  const stopped = {
    ...ready,
    readiness: {
      status: 'stop_refer',
      confidence: 'high',
      coverage: { healthSignals: 6, subjectiveComplete: true }
    }
  };

  function view() {
    const insight = document.querySelector('#insight-text');
    const planState = document.querySelector('#plan-state');
    const planLoad = document.querySelector('#plan-load');
    return {
      ruleId: document.body.dataset.safetyRule,
      insightText: insight.textContent,
      insightRole: insight.getAttribute('role'),
      insightLive: insight.getAttribute('aria-live'),
      planTitle: document.querySelector('#plan-title').textContent,
      planDescription: document.querySelector('#plan-description').textContent,
      planState: planState.textContent,
      planStateHidden: planState.hidden,
      planLoad: planLoad.textContent,
      planLoadHidden: planLoad.hidden,
      recoveryValue: document.querySelector('#recovery-value').textContent,
      trainingStatus: document.querySelector('#training-status').textContent,
      activityText: document.querySelector('#activity-list').textContent,
      errorHidden: document.querySelector('#error-banner').hidden,
      errorText: document.querySelector('#error-banner').textContent
    };
  }

  render(ready);
  let state = view();
  equal(state.ruleId, 'safety.ready_passthrough', 'ready body rule');
  equal(state.insightRole, 'status', 'ready insight role');
  equal(state.insightLive, 'polite', 'ready insight aria-live');
  equal(state.planStateHidden, true, 'ready plan state hidden');
  equal(state.planLoadHidden, false, 'ready plan load visible');
  equal(state.planLoad, '训练负荷 88', 'ready plan load text');

  render(insufficient);
  state = view();
  equal(state.ruleId, 'safety.data_insufficient_override', 'insufficient body rule');
  equal(state.insightRole, 'status', 'insufficient insight role');
  equal(state.insightLive, 'polite', 'insufficient insight aria-live');
  equal(state.planState, '待确认', 'insufficient plan state');
  equal(state.planStateHidden, false, 'insufficient plan state visible');
  equal(state.planLoadHidden, true, 'insufficient plan load hidden');
  equal(state.recoveryValue, '73%', 'blocked objective recovery value');
  equal(state.trainingStatus, '已完成', 'blocked completed activity status');
  includes(state.activityText, '合成已完成跑步', 'blocked completed activity text');

  render(ready);
  state = view();
  equal(state.ruleId, 'safety.ready_passthrough', 'restored ready body rule');
  equal(state.insightRole, 'status', 'restored ready insight role');
  equal(state.insightLive, 'polite', 'restored ready insight aria-live');
  equal(state.planState, '', 'restored ready plan state text');
  equal(state.planStateHidden, true, 'restored ready plan state hidden');
  equal(state.planLoadHidden, false, 'restored ready plan load visible');

  const originalBuild = window.PulseSafetyPresentation.buildSafetyPresentation;
  let buildCalls = 0;
  window.PulseSafetyPresentation.buildSafetyPresentation = (...args) => {
    buildCalls += 1;
    return originalBuild(...args);
  };
  try {
    render(ready);
    equal(buildCalls, 1, 'first direct render safety build count');
    render(insufficient);
    equal(buildCalls, 2, 'second direct render safety build count');
  } finally {
    window.PulseSafetyPresentation.buildSafetyPresentation = originalBuild;
  }

  render(ready);
  let resolveGeneration;
  let generationCalls = 0;
  const generationResult = new Promise((resolve) => { resolveGeneration = resolve; });
  const successfulGeneration = regenerateInsight(() => {
    generationCalls += 1;
    return generationResult;
  });
  equal(generationCalls, 1, 'regenerateInsight injected success generator calls');
  render(insufficient);
  resolveGeneration({ text: '允许执行高强度训练。', tags: ['宽松建议'] });
  await successfulGeneration;
  state = view();
  equal(state.ruleId, 'safety.data_insufficient_override', 'successful race body rule');
  equal(state.insightText, '当前缺少完整的主观疲劳与安全确认，仅展示客观数据，不提供训练强度建议。', 'successful race blocked insight');
  equal(state.planDescription, '完成当前状态确认后再决定是否执行原计划。', 'successful race blocked plan');
  equal(state.planLoadHidden, true, 'successful race plan load hidden');

  render(ready);
  let rejectGeneration;
  let rejectionCalls = 0;
  const rejectionResult = new Promise((resolve, reject) => { rejectGeneration = reject; });
  const rejectedGeneration = regenerateInsight(() => {
    rejectionCalls += 1;
    return rejectionResult;
  });
  equal(rejectionCalls, 1, 'regenerateInsight injected rejection generator calls');
  render(stopped);
  rejectGeneration(new Error('合成服务不可用'));
  await rejectedGeneration;
  state = view();
  equal(state.ruleId, 'safety.stop_override', 'rejected race body rule');
  equal(state.insightText, '当前状态需要安全优先，Pulse 已停止训练建议。如症状持续或加重，请寻求适当的专业评估。', 'rejected race stopped insight');
  equal(state.insightRole, 'alert', 'rejected race insight role');
  equal(state.insightLive, 'assertive', 'rejected race insight aria-live');
  equal(state.planState, '已暂停', 'rejected race stopped plan state');
  equal(state.planDescription, '当前状态下暂停训练建议；如症状持续或加重，请寻求适当的专业评估。', 'rejected race stopped plan');
  equal(state.planLoadHidden, true, 'rejected race plan load hidden');
  equal(state.errorHidden, false, 'rejected race error banner visible');
  includes(state.errorText, '洞察生成失败：合成服务不可用', 'rejected race operational error');

  return true;
})()
`;

async function run() {
  let window;
  let exitCode = 0;
  try {
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'renderer-safety-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await waitForRenderer(window);
    await window.webContents.executeJavaScript(behaviorTest, true);
    console.log('Renderer safety behavior passed: policy transitions and insight races preserve the latest safety state.');
  } catch (error) {
    exitCode = 1;
    console.error(error.stack || error.message);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(exitCode);
  }
}

app.whenReady().then(run);
