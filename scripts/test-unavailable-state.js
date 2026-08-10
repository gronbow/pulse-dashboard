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
      '#insight-text': '当前缺少完整的主观疲劳与安全确认，仅展示客观数据，不提供训练强度建议。',
      '#error-banner': '等待 Codex 快照'
    })
  },
  encoding: 'utf8',
  windowsHide: true
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
process.stdout.write(result.stdout);
console.log('Unavailable-state smoke passed: Codex mode without cache never renders demo health values.');
