const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateChecksums, sha256 } = require('./generate-release-checksums');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-metadata-'));
try {
  const files = {
    'Pulse-Dashboard-Setup-0.5.6-x64.exe': 'synthetic installer',
    'Pulse-Dashboard-Setup-0.5.6-x64.exe.blockmap': 'synthetic blockmap',
    'pulse-dashboard-windows-x64.spdx.json': '{"spdxVersion":"SPDX-2.3"}'
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content, 'utf8');
  assert.equal(generateChecksums(directory).length, 3);
  const checksums = fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  assert.equal(checksums.length, 3);
  for (const name of Object.keys(files)) {
    assert.ok(checksums.includes(`${sha256(path.join(directory, name))}  ${name}`));
  }
  console.log('Release metadata passed: installer, blockmap and SPDX SBOM receive deterministic SHA-256 entries.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
