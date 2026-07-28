const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const result = spawnSync(process.execPath, [path.join(__dirname, 'test-electron-smoke.js')], {
  cwd: root,
  env: {
    ...process.env,
    PULSE_SMOKE_DATA_SOURCE: 'codex',
    PULSE_SMOKE_EXPECTATIONS: JSON.stringify({
      '#source-badge': '等待首次同步',
      '#rhr-value': '—',
      '#sleep-value': '—',
      '#insight-text': '尚未收到真实 COROS 快照',
      '#error-banner': '本机 Handoff 尚未就绪'
    })
  },
  encoding: 'utf8',
  windowsHide: true
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
process.stdout.write(result.stdout);
console.log('Unavailable-state smoke passed: Codex mode without cache never renders demo health values.');
