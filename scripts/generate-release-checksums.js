const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function releaseFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /(?:\.exe|\.exe\.blockmap|\.spdx\.json)$/i.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function generateChecksums(directory) {
  const names = releaseFiles(directory);
  if (!names.some((name) => name.endsWith('.exe'))) throw new Error('Windows installer is missing');
  if (!names.some((name) => name.endsWith('.spdx.json'))) throw new Error('release SBOM is missing');
  const output = names.map((name) => `${sha256(path.join(directory, name))}  ${name}`).join('\n') + '\n';
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), output, 'utf8');
  return names;
}

if (require.main === module) {
  const directory = path.resolve(process.argv[2] || path.join(__dirname, '..', 'release'));
  const names = generateChecksums(directory);
  console.log(`Release checksums generated for ${names.length} artifacts.`);
}

module.exports = { generateChecksums, releaseFiles, sha256 };
