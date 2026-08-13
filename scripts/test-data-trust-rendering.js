const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-data-trust-'));
const fixturePath = path.join(temporaryDirectory, 'synthetic-data-trust.json');
const now = new Date();
const today = now.toISOString().slice(0, 10);
const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);

const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'src', 'mock', 'snapshot.json'), 'utf8'));
snapshot.meta.asOf = now.toISOString();
snapshot.meta.lastUpdated = now.toISOString();
snapshot.meta.timezone = 'UTC';
snapshot.meta.provider = 'codex-coros-mcp';
snapshot.health.sleep.date = today;
snapshot.health.sleep.provenance = 'coros';
snapshot.health.restingHeartRate.date = yesterday;
delete snapshot.health.restingHeartRate.provenance;
snapshot.health.hrv.date = null;
snapshot.health.hrv.provenance = 'coros';
snapshot.health.stress.date = today;
snapshot.health.steps.date = today;
snapshot.health.recovery.date = twoDaysAgo;
snapshot.todayActivities[0].provenance = 'coros';
snapshot.plan.date = tomorrow;
snapshot.plan.provenance = 'coros';
snapshot.load.provenance = 'derived';
snapshot.trends.trainingLoad[snapshot.trends.trainingLoad.length - 1].date = today;

fs.writeFileSync(fixturePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

try {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'test-electron-smoke.js')], {
    cwd: root,
    env: {
      ...process.env,
      PULSE_SMOKE_SNAPSHOT_PATH: fixturePath,
      PULSE_SMOKE_HANDOFF_PORT: '19194',
      PULSE_SMOKE_OUTPUT_NAME: 'pulse-dashboard-data-trust.png',
      PULSE_SMOKE_EXPECTATIONS: JSON.stringify({
        '#sleep-trust': '今日 · COROS',
        '#rhr-trust': '昨日 · COROS',
        '#hrv-trust': '日期未知 · COROS',
        '#recovery-trust': '2天前 · COROS',
        '#training-trust': '今日 · COROS',
        '#plan-trust': 'COROS',
        '#load-trust': '今日 · 汇总'
      }),
      PULSE_SMOKE_ATTRIBUTE_EXPECTATIONS: JSON.stringify([
        { selector: '#sleep-trust', attribute: 'data-trust-state', expected: 'current' },
        { selector: '#rhr-trust', attribute: 'data-trust-state', expected: 'recent' },
        { selector: '#hrv-trust', attribute: 'data-trust-state', expected: 'unknown' },
        { selector: '#plan-trust', attribute: 'data-trust-state', expected: 'scheduled' }
      ])
    },
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  process.stdout.write(result.stdout);
  console.log('Data trust rendering passed: per-card dates and sources remain visible and fail closed.');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
