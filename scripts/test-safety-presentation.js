const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSafetyPresentation } = require('../src/safety-presentation');

const snapshot = {
  health: {
    recovery: { value: 96, level: 'heavy_training_allowed' }
  },
  insight: {
    text: '恢复很好，可以安排高强度训练。',
    tags: ['恢复良好', '高强度']
  },
  plan: {
    title: '间歇跑',
    description: '6 × 1 km，按阈值配速完成。',
    load: 168
  },
  readiness: { status: 'ready' }
};

const expectedReady = {
  mode: 'ready',
  ruleId: 'safety.ready_passthrough',
  insight: {
    text: '恢复很好，可以安排高强度训练。',
    tags: ['恢复良好', '高强度']
  },
  recovery: { label: '可进行较高负荷', prescriptive: true },
  plan: {
    titlePrefix: '',
    description: '6 × 1 km，按阈值配速完成。',
    loadVisible: true,
    stateLabel: ''
  },
  announcement: { role: 'status', politeness: 'polite' }
};

const expectedInsufficient = {
  mode: 'data_insufficient',
  ruleId: 'safety.data_insufficient_override',
  insight: {
    text: '当前缺少完整的主观疲劳与安全确认，仅展示客观数据，不提供训练强度建议。',
    tags: ['数据不足', '仅展示客观数据']
  },
  recovery: { label: '设备恢复数据 · 仅作客观参考', prescriptive: false },
  plan: {
    titlePrefix: '待确认 · ',
    description: '完成当前状态确认后再决定是否执行原计划。',
    loadVisible: false,
    stateLabel: '待确认'
  },
  announcement: { role: 'status', politeness: 'polite' }
};

const expectedStopped = {
  mode: 'stop_refer',
  ruleId: 'safety.stop_override',
  insight: {
    text: '当前状态需要安全优先，Pulse 已停止训练建议。如症状持续或加重，请寻求适当的专业评估。',
    tags: ['安全优先', '停止训练建议']
  },
  recovery: { label: '当前不用于训练决策', prescriptive: false },
  plan: {
    titlePrefix: '原计划 · ',
    description: '当前状态下暂停训练建议；如症状持续或加重，请寻求适当的专业评估。',
    loadVisible: false,
    stateLabel: '已暂停'
  },
  announcement: { role: 'alert', politeness: 'assertive' }
};

const ready = buildSafetyPresentation(snapshot);
assert.deepEqual(ready, expectedReady);
assert.notStrictEqual(ready.insight.tags, snapshot.insight.tags);
ready.insight.tags.push('调用方修改');
assert.deepEqual(snapshot.insight.tags, ['恢复良好', '高强度']);
assert.deepEqual(buildSafetyPresentation(snapshot), expectedReady);

const recoveryLabels = new Map([
  ['heavy_training_allowed', '可进行较高负荷'],
  ['training_as_planned', '可按计划训练'],
  ['easy_training_recommended', '建议轻松训练'],
  ['rest_recommended', '建议恢复或休息'],
  ['unknown', '暂无判断'],
  ['fallback', '按状态调整'],
  ['future_level', '按状态调整']
]);
for (const [level, label] of recoveryLabels) {
  const presentation = buildSafetyPresentation({
    health: { recovery: { level } },
    readiness: { status: 'ready' }
  });
  assert.equal(presentation.recovery.label, label);
}

for (const level of ['toString', 'constructor', '__proto__']) {
  const presentation = buildSafetyPresentation({
    health: { recovery: { level } },
    readiness: { status: 'ready' }
  });
  assert.deepEqual(presentation.recovery, {
    label: '按状态调整',
    prescriptive: true
  });
}

const readyFallback = buildSafetyPresentation({
  insight: {},
  plan: { name: '恢复跑' },
  readiness: { status: 'ready' }
});
assert.equal(readyFallback.insight.text, '暂无洞察，请点击重新生成。');
assert.deepEqual(readyFallback.insight.tags, []);
assert.equal(readyFallback.plan.description, '恢复跑');
assert.equal(
  buildSafetyPresentation({ readiness: { status: 'ready' } }).plan.description,
  '今天没有计划安排'
);

const insufficient = buildSafetyPresentation({
  ...snapshot,
  readiness: { status: 'data_insufficient' }
});
assert.deepEqual(insufficient, expectedInsufficient);
const serializedInsufficient = JSON.stringify(insufficient);
for (const unsafeText of ['可进行较高负荷', '可按计划训练', '高强度训练', '阈值配速']) {
  assert.doesNotMatch(serializedInsufficient, new RegExp(unsafeText));
}

const insufficientAgain = buildSafetyPresentation({
  ...snapshot,
  readiness: { status: 'data_insufficient' }
});
for (const key of ['insight', 'recovery', 'plan', 'announcement']) {
  assert.notStrictEqual(insufficient[key], insufficientAgain[key]);
}
assert.notStrictEqual(insufficient.insight.tags, insufficientAgain.insight.tags);
insufficient.insight.tags.push('调用方修改');
insufficient.plan.description = '调用方修改';
assert.deepEqual(insufficientAgain, expectedInsufficient);

const stopped = buildSafetyPresentation({
  ...snapshot,
  readiness: { status: 'stop_refer' }
});
assert.deepEqual(stopped, expectedStopped);
const stoppedAgain = buildSafetyPresentation({
  ...snapshot,
  readiness: { status: 'stop_refer' }
});
for (const key of ['insight', 'recovery', 'plan', 'announcement']) {
  assert.notStrictEqual(stopped[key], stoppedAgain[key]);
}
assert.notStrictEqual(stopped.insight.tags, stoppedAgain.insight.tags);
stopped.insight.tags.push('调用方修改');
stopped.plan.description = '调用方修改';
assert.deepEqual(stoppedAgain, expectedStopped);

for (const malformedSnapshot of [
  { readiness: { status: 'future_state' } },
  {},
  null
]) {
  assert.deepEqual(buildSafetyPresentation(malformedSnapshot), expectedInsufficient);
}

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'safety-presentation.js'), 'utf8');
const sandbox = {};
vm.runInNewContext(source, sandbox);
assert.equal(typeof sandbox.PulseSafetyPresentation.buildSafetyPresentation, 'function');

console.log('Safety presentation passed: readiness deterministically governs insight, recovery, plan and ARIA policy.');
