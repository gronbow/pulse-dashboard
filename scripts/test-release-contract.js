const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HANDOFF_PROTOCOL_VERSION } = require('./handoff-auth');

const root = path.join(__dirname, '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const canonicalPlugin = readJson('.codex-plugin/plugin.json');
const publicPlugin = readJson('plugins/pulse-dashboard/.codex-plugin/plugin.json');
const compatibility = readJson('docs/release-compatibility.json');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages?.['']?.version, pkg.version);
assert.equal(canonicalPlugin.version, pkg.version);
assert.equal(publicPlugin.version, pkg.version);
assert.equal(compatibility.source?.version, pkg.version);
assert.equal(compatibility.source?.releaseChannel, pkg.pulse?.releaseChannel);
assert.equal(compatibility.source?.handoffProtocolVersion, pkg.pulse?.handoffProtocolVersion);
assert.equal(HANDOFF_PROTOCOL_VERSION, pkg.pulse?.handoffProtocolVersion);
assert.ok(Array.isArray(compatibility.publishedPairs) && compatibility.publishedPairs.length > 0);
assert.ok(compatibility.publishedPairs.every((pair) => (
  pair.desktopVersion
  && pair.pluginRef === `v${pair.desktopVersion}-beta`
  && Number.isInteger(pair.handoffProtocolVersion)
  && pair.status === 'published'
)));
assert.doesNotMatch(readme, /plugin marketplace add[^\r\n]+--ref\s+main/i);
for (const pair of compatibility.publishedPairs) {
  assert.match(readme, new RegExp(`--ref\\s+${pair.pluginRef.replaceAll('.', '\\.')}`));
}

console.log(`Release contract passed: source v${pkg.version}, Handoff v${HANDOFF_PROTOCOL_VERSION}, published pairs pinned.`);
