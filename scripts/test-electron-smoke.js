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
const screenshotPath = path.join(
  outputDirectory,
  liveSnapshotSource
    ? scrollSelector ? 'pulse-dashboard-live-trends.png' : 'pulse-dashboard-live.png'
    : scrollSelector ? 'pulse-dashboard-trends.png' : 'pulse-dashboard-smoke.png'
);
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-electron-smoke-'));
const handoffPath = path.join(userDataPath, 'handoff.json');
const defaultExpectations = JSON.stringify({
  '#secondary-health-label': '日均压力',
  '#secondary-health-value': '32'
});

fs.mkdirSync(outputDirectory, { recursive: true });
if (fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath);
if (liveSnapshotSource) {
  fs.copyFileSync(liveSnapshotSource, handoffPath);
  fs.writeFileSync(path.join(userDataPath, 'config.json'), JSON.stringify({
    dataSource: 'codex',
    bridgeUrl: '',
    refreshIntervalMinutes: 5,
    alwaysOnTop: true,
    compactMode: false,
    theme: 'dark',
    opacity: 96,
    launchAtLogin: false,
    timezone: 'Asia/Shanghai'
  }, null, 2), 'utf8');
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
    PULSE_HANDOFF_PATH: handoffPath,
    PULSE_SMOKE_EXPECTATIONS: process.env.PULSE_SMOKE_EXPECTATIONS
      || (liveSnapshotSource ? '' : defaultExpectations),
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
