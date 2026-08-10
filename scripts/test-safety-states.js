const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const runtimeDirectory = path.join(root, '.runtime-check-v8');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const baseSnapshot = JSON.parse(fs.readFileSync(path.join(root, 'src', 'mock', 'snapshot.json'), 'utf8'));
const now = new Date().toISOString();

assert.match(
  mainSource,
  /function smokeAttributeExpectations\(\)/,
  'Electron smoke harness must enforce attribute expectations before safety-state tests can pass'
);

const negativeControl = spawnSync(process.execPath, [path.join(__dirname, 'test-electron-smoke.js')], {
  cwd: root,
  env: {
    ...process.env,
    PULSE_SMOKE_DATA_SOURCE: 'demo',
    PULSE_SMOKE_OUTPUT_NAME: 'pulse-dashboard-safety-negative-control.png',
    PULSE_SMOKE_EXPECTATIONS: '{}',
    PULSE_SMOKE_ATTRIBUTE_EXPECTATIONS: JSON.stringify([
      { selector: 'body', attribute: 'data-safety-rule', expected: 'safety.impossible_test_value' }
    ])
  },
  encoding: 'utf8',
  timeout: 30_000,
  windowsHide: true
});
assert.notEqual(negativeControl.status, 0, 'smoke harness must fail when a safety attribute is wrong');
assert.match(
  `${negativeControl.stdout}\n${negativeControl.stderr}`,
  /smoke attribute mismatch for body\[data-safety-rule\]/,
  'smoke harness failure must identify the mismatched safety attribute'
);

function runCase(name, mutate, textExpectations, attributeExpectations) {
  const snapshot = structuredClone(baseSnapshot);
  snapshot.meta.asOf = now;
  snapshot.meta.lastUpdated = now;
  mutate(snapshot);

  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const fixturePath = path.join(runtimeDirectory, `safety-${name}.json`);
  fs.writeFileSync(fixturePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'test-electron-smoke.js')], {
      cwd: root,
      env: {
        ...process.env,
        PULSE_SMOKE_SNAPSHOT_PATH: fixturePath,
        PULSE_SMOKE_OUTPUT_NAME: `pulse-dashboard-safety-${name}.png`,
        PULSE_SMOKE_EXPECTATIONS: JSON.stringify(textExpectations),
        PULSE_SMOKE_ATTRIBUTE_EXPECTATIONS: JSON.stringify(attributeExpectations)
      },
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
}

runCase('data-insufficient', (snapshot) => {
  snapshot.readiness = {
    status: 'data_insufficient',
    confidence: 'low',
    recommendationLevel: 'informational',
    reasons: ['合成主观确认缺失'],
    subjective: {}
  };
}, {
  '#insight-text': '当前缺少完整的主观疲劳与安全确认，仅展示客观数据，不提供训练强度建议。',
  '#recovery-level': '设备恢复数据 · 仅作客观参考',
  '#plan-title': '待确认 · ',
  '#plan-description': '完成当前状态确认后再决定是否执行原计划。',
  '#plan-state': '待确认'
}, [
  { selector: 'body', attribute: 'data-safety-rule', expected: 'safety.data_insufficient_override' },
  { selector: '#insight-text', attribute: 'role', expected: 'status' },
  { selector: '#insight-text', attribute: 'aria-live', expected: 'polite' }
]);

runCase('stop-refer', (snapshot) => {
  snapshot.readiness = {
    status: 'ready',
    confidence: 'high',
    recommendationLevel: 'hard',
    reasons: [],
    subjective: {
      collectedAt: now,
      fatigue: 1,
      soreness: 1,
      pain: true,
      illness: false,
      chestSymptoms: false,
      dizziness: false
    }
  };
}, {
  '#insight-text': '当前状态需要安全优先，Pulse 已停止训练建议。',
  '#recovery-level': '当前不用于训练决策',
  '#plan-title': '原计划 · ',
  '#plan-description': '当前状态下暂停训练建议',
  '#plan-state': '已暂停'
}, [
  { selector: 'body', attribute: 'data-safety-rule', expected: 'safety.stop_override' },
  { selector: '#insight-text', attribute: 'role', expected: 'alert' },
  { selector: '#insight-text', attribute: 'aria-live', expected: 'assertive' }
]);

console.log('Electron safety states passed: blocked guidance and accessibility semantics are rendered end to end.');
