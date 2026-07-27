const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packagedExecutable = String(process.env.PULSE_WINDOW_ICON_TEST_EXECUTABLE || '').trim();
const executable = packagedExecutable || require('electron');
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-window-icon-test-'));
const outputPath = path.join(userDataPath, 'window-icon-check.json');
const arguments = [
  ...(packagedExecutable ? [] : [root]),
  `--user-data-dir=${userDataPath}`,
  `--pulse-window-icon-check=${outputPath}`,
  '--disable-gpu'
];

const child = spawn(executable, arguments, {
  cwd: root,
  env: {
    ...process.env,
    PULSE_HANDOFF_PORT: '0'
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

const timeout = setTimeout(() => child.kill(), 15_000);

child.on('error', (error) => {
  clearTimeout(timeout);
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

child.on('close', (code) => {
  clearTimeout(timeout);
  try {
    assert.equal(code, 0, `${stdout}\n${stderr}`);
    const result = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(result.ok, true);
    assert.equal(result.packaged, Boolean(packagedExecutable));
    assert.equal(result.windowCreated, true);
    assert.equal(result.appId, 'app.pulse.dashboard');
    assert.equal(result.appDetailsApplied, true);
    assert.equal(result.windowIconApplied, true);
    assert.ok(result.nativeHandleBytes >= 4);
    assert.equal(result.empty, false);
    assert.deepEqual(result.sampleSize, { width: 32, height: 32 });
    assert.ok(result.visiblePixels >= 300);
    assert.ok(result.limePixels >= 120);
    assert.ok(result.darkPixels >= 20);
    assert.equal(
      path.basename(result.sourcePath).toLowerCase(),
      packagedExecutable ? 'pulse-tray.ico' : 'icon.ico'
    );
    console.log(
      `Window icon passed (${packagedExecutable ? 'packaged' : 'development'}): `
      + `${result.appId} uses ${result.sourcePath}`
    );
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
