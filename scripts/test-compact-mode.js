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
  '#compact-sleep': '6h 32m'
});

const cases = [
  { ratio: '16:9', width: 360, height: 203 },
  { ratio: '4:3', width: 360, height: 270 },
  { ratio: '21:9', width: 420, height: 180 }
];

for (const testCase of cases) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'test-electron-smoke.js')], {
    cwd: root,
    env: {
      ...process.env,
      PULSE_SMOKE_DATA_SOURCE: 'demo',
      PULSE_SMOKE_COMPACT_MODE: '1',
      PULSE_SMOKE_COMPACT_ASPECT_RATIO: testCase.ratio,
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
  const scale = actualWidth / testCase.width;
  assert.equal(Number.isInteger(scale), true, testCase.ratio + ' width is not an integer DPI scale');
  assert.equal(actualHeight, testCase.height * scale, testCase.ratio + ' height mismatch');
  console.log('Compact mode passed: ' + testCase.ratio + ' CSS ' + testCase.width + 'x' + testCase.height + ' (PNG ' + actualWidth + 'x' + actualHeight + ').');
}
