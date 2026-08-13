const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outputDirectory = path.join(root, '.runtime-check-v8');
const expectations = JSON.stringify({
  '#compact-steps': '9,551',
  '#compact-calories': '510',
  '#compact-rhr': '53',
  '#compact-sleep': '6h 32m',
  '#compact-steps-meta': '7/24',
  '#compact-calories-meta': '7/24',
  '#compact-rhr-meta': '7/24',
  '#compact-sleep-meta': '7/24'
});

const cases = [
  { ratio: '16:9', width: 360, height: 203, scale: 1 },
  { ratio: '4:3', width: 360, height: 270, scale: 1.25 },
  { ratio: '21:9', width: 420, height: 180, scale: 1.5 }
];

for (const testCase of cases) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'test-electron-smoke.js')], {
    cwd: root,
    env: {
      ...process.env,
      PULSE_SMOKE_DATA_SOURCE: 'demo',
      PULSE_SMOKE_COMPACT_MODE: '1',
      PULSE_SMOKE_COMPACT_ASPECT_RATIO: testCase.ratio,
      PULSE_SMOKE_LAYOUT_AUDIT: 'compact',
      PULSE_SMOKE_SCALE_FACTOR: String(testCase.scale),
      PULSE_SMOKE_EXPECTATIONS: expectations
    },
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(result.status, 0, testCase.ratio + '\n' + result.stdout + '\n' + result.stderr);
  const screenshotPath = path.join(outputDirectory, 'pulse-dashboard-compact-' + testCase.ratio.replace(':', '-') + '.png');
  const screenshot = fs.readFileSync(screenshotPath);
  assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const actualWidth = screenshot.readUInt32BE(16);
  const actualHeight = screenshot.readUInt32BE(20);
  assert.ok(Math.abs(actualWidth - Math.round(testCase.width * testCase.scale)) <= 1, testCase.ratio + ' width mismatch');
  assert.ok(Math.abs(actualHeight - Math.round(testCase.height * testCase.scale)) <= 1, testCase.ratio + ' height mismatch');
  console.log('Compact mode passed: ' + testCase.ratio + ' at ' + Math.round(testCase.scale * 100) + '% DPI (' + actualWidth + 'x' + actualHeight + ' PNG).');
}
