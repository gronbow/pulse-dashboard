const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const fixturePath = path.join(root, 'src', 'mock', 'snapshot.json');
const packagePath = path.join(root, 'package.json');
const iconPath = path.join(root, 'build', 'icon.ico');
const trayPngPath = path.join(root, 'build', 'tray-icon.png');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

function fail(message) {
  console.error(`Validation failed: ${message}`);
  process.exitCode = 1;
}

let fixture;
try {
  fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
} catch (error) {
  fail(`cannot parse ${fixturePath}: ${error.message}`);
}

for (const key of ['meta', 'health', 'todayActivities', 'plan', 'load', 'trends', 'insight']) {
  if (!fixture || !(key in fixture)) fail(`snapshot is missing ${key}`);
}

if (fixture?.meta?.source !== 'demo') fail('mock snapshot must be marked as demo');
if (!Array.isArray(fixture?.todayActivities)) fail('todayActivities must be an array');
if (!Array.isArray(fixture?.trends?.restingHeartRate)) fail('restingHeartRate trend must be an array');
if (!Array.isArray(fixture?.trends?.sleepScore)) fail('sleepScore trend must be an array');
if (!Array.isArray(fixture?.trends?.trainingLoad) || fixture.trends.trainingLoad.length !== 7) {
  fail('trainingLoad trend must contain seven demo points');
}
if (!fixture?.health?.stress || fixture.health.stress.value == null) {
  fail('mock snapshot must include a daily stress value for the secondary health card');
}
if (!mainSource.includes("label: '读取最新同步'") || mainSource.includes("label: '立即刷新'")) {
  fail('tray refresh action must clearly describe a local snapshot reread');
}

try {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (!pkg.main || !pkg.scripts?.start) fail('package.json is missing desktop entry points');
  if (pkg.name !== 'pulse-dashboard' || pkg.productName !== 'Pulse Dashboard' || pkg.build?.appId !== 'app.pulse.dashboard') {
    fail('package.json is missing the Pulse product identity');
  }
  if (pkg.build?.win?.icon !== 'build/icon.ico') fail('Windows build must use the native ICO application icon');
  const extraResources = Array.isArray(pkg.build?.extraResources) ? pkg.build.extraResources : [];
  if (!extraResources.some(({ from, to }) => from === 'build/icon.ico' && to === 'pulse-tray.ico')) {
    fail('packaged app must include the native tray ICO resource');
  }
  if (!extraResources.some(({ from, to }) => from === 'build/tray-icon.png' && to === 'pulse-tray.png')) {
    fail('packaged app must include the PNG tray fallback resource');
  }
} catch (error) {
  fail(`cannot parse ${packagePath}: ${error.message}`);
}

for (const [label, filePath, header] of [
  ['Windows ICO', iconPath, [0, 0, 1, 0]],
  ['tray PNG', trayPngPath, [137, 80, 78, 71, 13, 10, 26, 10]]
]) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (!header.every((value, index) => buffer[index] === value)) fail(`${label} has an invalid file header`);
  } catch (error) {
    fail(`cannot read ${filePath}: ${error.message}`);
  }
}

const forbidden = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|["']?(?:access|refresh)[_-]?token["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/i;
for (const relative of ['src/mock/snapshot.json', 'README.md', 'docs/BRIDGE_CONTRACT.md']) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8');
  if (forbidden.test(content)) fail(`${relative} contains private-data markers`);
}

if (!process.exitCode) console.log('Validation passed: schema, entry points, and public-data guard are OK.');
