const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const fixturePath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-secondary-health-')),
  'snapshot-without-stress.json'
);

try {
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'src', 'mock', 'snapshot.json'), 'utf8'));
  delete snapshot.health.stress;
  snapshot.health.spo2 = {
    value: 97,
    unit: '%',
    status: 'available',
    date: snapshot.meta.asOf.slice(0, 10)
  };
  fs.writeFileSync(fixturePath, JSON.stringify(snapshot, null, 2), 'utf8');

  const result = spawnSync(process.execPath, [path.join(__dirname, 'test-electron-smoke.js')], {
    cwd: root,
    env: {
      ...process.env,
      PULSE_SMOKE_SNAPSHOT_PATH: fixturePath,
      PULSE_SMOKE_HANDOFF_PORT: '19192',
      PULSE_SMOKE_SCROLL_SELECTOR: '.secondary-health-card',
      PULSE_SMOKE_EXPECTATIONS: JSON.stringify({
        '#secondary-health-label': '血氧',
        '#secondary-health-value': '97%'
      })
    },
    encoding: 'utf8',
    windowsHide: true
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  process.stdout.write(result.stdout);
  console.log('Secondary health fallback passed: snapshots without stress render SpO2.');
} finally {
  fs.rmSync(path.dirname(fixturePath), { recursive: true, force: true });
}
