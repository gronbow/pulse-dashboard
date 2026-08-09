const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const electronPath = require('electron');
const outputDirectory = path.join(root, '.runtime-check-v8');
const liveSnapshotSource = process.env.PULSE_SMOKE_SNAPSHOT_PATH || '';
const scrollSelector = process.env.PULSE_SMOKE_SCROLL_SELECTOR || '';
const smokeDataSource = process.env.PULSE_SMOKE_DATA_SOURCE || (liveSnapshotSource ? 'codex' : 'demo');
const compactMode = process.env.PULSE_SMOKE_COMPACT_MODE === '1';
const compactAspectRatio = ['4:3', '16:9', '21:9'].includes(process.env.PULSE_SMOKE_COMPACT_ASPECT_RATIO)
  ? process.env.PULSE_SMOKE_COMPACT_ASPECT_RATIO
  : '16:9';
const screenshotPath = path.join(
  outputDirectory,
  compactMode
    ? 'pulse-dashboard-compact-' + compactAspectRatio.replace(':', '-') + '.png'
    : liveSnapshotSource
    ? scrollSelector ? 'pulse-dashboard-live-trends.png' : 'pulse-dashboard-live.png'
    : smokeDataSource === 'codex'
      ? 'pulse-dashboard-awaiting-sync.png'
    : scrollSelector ? 'pulse-dashboard-trends.png' : 'pulse-dashboard-smoke.png'
);
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-electron-smoke-'));
const legacySnapshotPath = path.join(userDataPath, 'snapshot-cache.json');
const handoffAuthPath = path.join(userDataPath, 'handoff-auth.json');
const defaultExpectations = JSON.stringify({
  '#secondary-health-label': '日均压力',
  '#secondary-health-value': '32'
});

fs.mkdirSync(outputDirectory, { recursive: true });
if (fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath);
if (liveSnapshotSource || smokeDataSource !== 'demo' || compactMode) {
  if (liveSnapshotSource) fs.copyFileSync(liveSnapshotSource, legacySnapshotPath);
  fs.writeFileSync(path.join(userDataPath, 'config.json'), JSON.stringify({
    dataSource: smokeDataSource,
    bridgeUrl: '',
    refreshIntervalMinutes: 5,
    alwaysOnTop: true,
    compactMode: false,
    compactAspectRatio: '16:9',
    theme: 'dark',
    opacity: 96,
    launchAtLogin: false,
    timezone: 'Asia/Shanghai'
  }, null, 2), 'utf8');
}
if (compactMode) {
  const compactConfigPath = path.join(userDataPath, 'config.json');
  const compactConfig = JSON.parse(fs.readFileSync(compactConfigPath, 'utf8'));
  compactConfig.compactMode = true;
  compactConfig.compactAspectRatio = compactAspectRatio;
  fs.writeFileSync(compactConfigPath, JSON.stringify(compactConfig, null, 2), 'utf8');
}

const child = spawn(electronPath, [
  root,
  `--user-data-dir=${userDataPath}`,
  `--pulse-smoke-screenshot=${screenshotPath}`,
  '--disable-gpu'
], {
  cwd: root,
  env: {
    ...process.env,
    PULSE_HANDOFF_AUTH_PATH: handoffAuthPath,
    PULSE_SMOKE_EXPECTATIONS: process.env.PULSE_SMOKE_EXPECTATIONS
      || (liveSnapshotSource || smokeDataSource !== 'demo' ? '' : defaultExpectations),
    PULSE_HANDOFF_PORT: liveSnapshotSource
      ? (process.env.PULSE_SMOKE_HANDOFF_PORT || '19191')
      : '0'
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

const timeout = setTimeout(() => {
  child.kill();
}, 20_000);

child.on('error', (error) => {
  clearTimeout(timeout);
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

child.on('close', (code) => {
  clearTimeout(timeout);
  try {
    assert.equal(code, 0, `${stdout}\n${stderr}`);
    const screenshot = fs.readFileSync(screenshotPath);
    assert.ok(screenshot.length > 20_000, 'desktop screenshot is unexpectedly small');
    assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    console.log(`Electron smoke passed: real window rendered to ${screenshotPath}`);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
