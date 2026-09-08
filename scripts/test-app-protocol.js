const assert = require('node:assert/strict');
const path = require('node:path');
const {
  PULSE_APP_ASSETS,
  PULSE_APP_ENTRY_URL,
  PULSE_APP_ORIGIN,
  PULSE_APP_SCHEME,
  resolvePulseAppAsset
} = require('../src/app-protocol');

const sourceRoot = path.join(__dirname, '..', 'src');
const expectedAssets = new Map([
  [PULSE_APP_ENTRY_URL, [path.join(sourceRoot, 'renderer', 'index.html'), 'text/html; charset=utf-8']],
  [`${PULSE_APP_ORIGIN}/styles.css`, [path.join(sourceRoot, 'renderer', 'styles.css'), 'text/css; charset=utf-8']],
  [`${PULSE_APP_ORIGIN}/app.js`, [path.join(sourceRoot, 'renderer', 'app.js'), 'text/javascript; charset=utf-8']],
  [`${PULSE_APP_ORIGIN}/data-trust.js`, [path.join(sourceRoot, 'data-trust.js'), 'text/javascript; charset=utf-8']],
  [`${PULSE_APP_ORIGIN}/safety-presentation.js`, [path.join(sourceRoot, 'safety-presentation.js'), 'text/javascript; charset=utf-8']]
]);

assert.equal(PULSE_APP_SCHEME, 'pulse-app');
assert.equal(Object.keys(PULSE_APP_ASSETS).length, expectedAssets.size, 'protocol asset allowlist must stay explicit');
assert.equal(Object.isFrozen(PULSE_APP_ASSETS), true, 'protocol asset allowlist must not be mutable at runtime');
for (const [url, [expectedPath, contentType]] of expectedAssets) {
  assert.deepEqual(resolvePulseAppAsset(url, 'GET', sourceRoot), {
    ok: true,
    status: 200,
    filePath: expectedPath,
    contentType
  });
}

for (const url of [
  `${PULSE_APP_ORIGIN}/main.js`,
  `${PULSE_APP_ORIGIN}/renderer/index.html`,
  `${PULSE_APP_ORIGIN}/../main.js`,
  `${PULSE_APP_ENTRY_URL}?debug=1`,
  `${PULSE_APP_ENTRY_URL}#fragment`,
  `file://${sourceRoot.replaceAll('\\', '/')}/renderer/index.html`,
  'https://dashboard/index.html'
]) {
  assert.equal(resolvePulseAppAsset(url, 'GET', sourceRoot).status, 404, `${url} must not resolve`);
}

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
  assert.equal(resolvePulseAppAsset(PULSE_APP_ENTRY_URL, method, sourceRoot).status, 405, `${method} must be rejected`);
}

console.log('Application protocol passed: only five packaged dashboard assets are available over pulse-app://.');
