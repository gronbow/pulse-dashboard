const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pluginRoot = path.join(root, 'plugins', 'pulse-dashboard');
const marketplacePath = path.join(root, '.agents', 'plugins', 'marketplace.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const marketplace = readJson(marketplacePath);
assert.equal(marketplace.name, 'pulse-dashboard');
assert.equal(marketplace.interface?.displayName, 'Pulse Dashboard');
assert.equal(marketplace.plugins?.length, 1);

const entry = marketplace.plugins[0];
assert.equal(entry.name, 'pulse-dashboard');
assert.deepEqual(entry.source, {
  source: 'local',
  path: './plugins/pulse-dashboard'
});
assert.deepEqual(entry.policy, {
  installation: 'AVAILABLE',
  authentication: 'ON_INSTALL'
});
assert.equal(entry.category, 'Productivity');

const packageManifest = readJson(path.join(root, 'package.json'));
const canonicalManifest = readJson(path.join(root, '.codex-plugin', 'plugin.json'));
const publicManifest = readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'));
assert.equal(publicManifest.name, 'pulse-dashboard');
assert.equal(publicManifest.version, packageManifest.version);
assert.deepEqual(publicManifest, canonicalManifest);

for (const relativePath of [
  '.codex-plugin/plugin.json',
  'skills/pulse-dashboard/SKILL.md',
  'scripts/handoff-auth.js',
  'scripts/publish-snapshot.js',
  'scripts/test-publish-snapshot.js',
  'LICENSE'
]) {
  const canonical = fs.readFileSync(path.join(root, relativePath));
  const published = fs.readFileSync(path.join(pluginRoot, relativePath));
  assert.deepEqual(published, canonical, `${relativePath} is out of sync in the public plugin package`);
}

console.log('Public plugin package passed: marketplace metadata and packaged source are in sync.');
