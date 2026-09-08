const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const release = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-candidate.yml'), 'utf8');
const dependabot = fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8');

for (const workflow of [ci, release]) {
  const references = [...workflow.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/g)].map((match) => match[1]);
  assert.ok(references.length > 0);
  for (const reference of references) assert.match(reference, /^[a-f0-9]{40}$/, `unpinned action reference: ${reference}`);
}

assert.match(ci, /dependency-review-action@/);
assert.match(ci, /fail-on-severity:\s+high/);
assert.match(release, /id-token:\s+write/);
assert.match(release, /attestations:\s+write/);
assert.match(release, /anchore\/sbom-action@/);
assert.ok((release.match(/actions\/attest@/g) || []).length >= 2);
assert.match(release, /npm run release:checksums/);
assert.match(release, /npm run test:installer/);
assert.match(release, /SHA256SUMS\.txt/);
assert.match(release, /\.spdx\.json/);
assert.match(dependabot, /package-ecosystem:\s+npm/);
assert.match(dependabot, /package-ecosystem:\s+github-actions/);

console.log('Workflow policy passed: actions are pinned and installer, dependency, SBOM, checksum and attestation gates are present.');
