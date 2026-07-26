const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const fixturePath = path.join(root, 'src', 'mock', 'snapshot.json');
const packagePath = path.join(root, 'package.json');

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

try {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (!pkg.main || !pkg.scripts?.start) fail('package.json is missing desktop entry points');
  if (pkg.name !== 'pulse-dashboard' || pkg.productName !== 'Pulse Dashboard' || pkg.build?.appId !== 'app.pulse.dashboard') {
    fail('package.json is missing the Pulse product identity');
  }
} catch (error) {
  fail(`cannot parse ${packagePath}: ${error.message}`);
}

const forbidden = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|["']?(?:access|refresh)[_-]?token["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/i;
for (const relative of ['src/mock/snapshot.json', 'README.md', 'docs/BRIDGE_CONTRACT.md']) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8');
  if (forbidden.test(content)) fail(`${relative} contains private-data markers`);
}

if (!process.exitCode) console.log('Validation passed: schema, entry points, and public-data guard are OK.');
