const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outputName = 'pulse-dashboard-light-long-text.png';
const result = spawnSync(process.execPath, [path.join(__dirname, 'test-electron-smoke.js')], {
  cwd: root,
  env: {
    ...process.env,
    PULSE_SMOKE_DATA_SOURCE: 'demo',
    PULSE_SMOKE_THEME: 'light',
    PULSE_SMOKE_SCALE_FACTOR: '1.5',
    PULSE_SMOKE_LONG_TEXT: '1',
    PULSE_SMOKE_LAYOUT_AUDIT: 'full',
    PULSE_SMOKE_OUTPUT_NAME: outputName
  },
  encoding: 'utf8',
  windowsHide: true
});

assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
const screenshot = fs.readFileSync(path.join(root, '.runtime-check-v8', outputName));
assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
const width = screenshot.readUInt32BE(16);
const height = screenshot.readUInt32BE(20);
assert.ok(Math.abs(width - 645) <= 3, `unexpected 150% DPI width: ${width}`);
assert.ok(height >= 867 && height <= 1_233, `height must respect the 580–820 CSS px display clamp: ${height}`);
console.log(`Responsive layout passed: light theme and long text remain within the ${width}x${height} window at 150% DPI.`);
