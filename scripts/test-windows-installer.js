const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'win32') {
  console.log('Windows installer smoke skipped: this check only runs on Windows.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const releaseDirectory = path.join(root, 'release');
const version = require(path.join(root, 'package.json')).version;
const installerPath = path.join(releaseDirectory, `Pulse-Dashboard-Setup-${version}-x64.exe`);
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-installer-smoke-'));
const installDirectory = path.join(testRoot, 'app');
const userDataDirectory = path.join(testRoot, 'profile');
const installedExecutable = path.join(installDirectory, 'Pulse Dashboard.exe');
const uninstallerPath = path.join(installDirectory, 'Uninstall Pulse Dashboard.exe');

function run(label, executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 120_000,
    env: { ...process.env, ...(options.env || {}) }
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${label} failed with exit code ${result.status}\n${result.stdout || ''}\n${result.stderr || ''}`
  );
}

function waitUntilMissing(filePath, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (fs.existsSync(filePath) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

try {
  assert.ok(fs.existsSync(installerPath), `Windows installer not found: ${installerPath}`);
  run('installer', installerPath, ['/S', `/D=${installDirectory}`]);
  assert.ok(fs.existsSync(installedExecutable), 'installed Pulse executable was not found');
  assert.ok(fs.existsSync(uninstallerPath), 'Pulse uninstaller was not found');

  fs.mkdirSync(userDataDirectory, { recursive: true });
  run(
    'installed application protocol self-check',
    installedExecutable,
    [`--user-data-dir=${userDataDirectory}`, '--pulse-app-protocol-check', '--disable-gpu'],
    { env: { PULSE_HANDOFF_PORT: '0' } }
  );
  const resultPath = path.join(userDataDirectory, 'protocol-self-check.json');
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.packaged, true);
  assert.equal(result.assetCount, 5);
  assert.equal(result.cspEnforced, true);
  assert.equal(result.mimeProtected, true);

  run('uninstaller', uninstallerPath, ['/S']);
  waitUntilMissing(installedExecutable);
  assert.equal(fs.existsSync(installedExecutable), false, 'installed executable remained after uninstall');
  console.log('Windows installer passed: silent install, packaged self-check and uninstall completed in isolation.');
} finally {
  if (fs.existsSync(uninstallerPath)) {
    spawnSync(uninstallerPath, ['/S'], { windowsHide: true, timeout: 120_000 });
    waitUntilMissing(installedExecutable);
  }
  fs.rmSync(testRoot, { recursive: true, force: true });
}
