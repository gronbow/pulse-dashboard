const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const executable = path.join(root, 'release', 'win-unpacked', 'Pulse Dashboard.exe');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-packaged-protocol-'));
const outputPath = path.join(temporaryDirectory, 'protocol-self-check.json');
const handoffAuthPath = path.join(temporaryDirectory, 'handoff-auth.json');

assert.ok(fs.existsSync(executable), 'packaged application is missing; run npm run pack:win first');

const child = spawn(executable, [
  `--user-data-dir=${temporaryDirectory}`,
  '--pulse-app-protocol-check',
  '--disable-gpu'
], {
  cwd: root,
  env: {
    ...process.env,
    PULSE_HANDOFF_AUTH_PATH: handoffAuthPath,
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

const timeout = setTimeout(() => child.kill(), 20_000);

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
    assert.deepEqual(result, {
      ok: true,
      packaged: true,
      assetCount: 5,
      entryStatus: 200,
      blockedStatus: 404,
      cspEnforced: true,
      mimeProtected: true
    });
    console.log('Packaged application protocol passed: ASAR assets, CSP, MIME protection and 404 isolation are active.');
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
