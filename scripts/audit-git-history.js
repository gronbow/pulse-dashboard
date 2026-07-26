const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');

const blockedPath = /\.(?:fit|gpx|tcx|kml)$/i;
const blockedContent = [
  { pattern: /(^|[^\d])\d{18}([^\d]|$)/, reason: '18-digit identifier' },
  { pattern: /[A-Za-z]:\\Users\\[^\\\r\n]+\\/i, reason: 'personal Windows user path' },
  { pattern: /(?:latitude|longitude|startLat|startLng|endLat|endLng)["']?\s*[:=]\s*-?\d{1,3}\.\d{4,}/i, reason: 'precise coordinate' },
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, reason: 'private key material' },
  { pattern: /\b(?:sk-(?:proj|live)-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}\b/, reason: 'credential-shaped token' }
];

function parseArguments(argv) {
  let all = false;
  let reference = 'HEAD';
  let explicitReference = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--all') {
      if (explicitReference) throw new Error('Use either --all or --ref, not both.');
      all = true;
      continue;
    }
    if (argument === '--ref') {
      if (all) throw new Error('Use either --all or --ref, not both.');
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--ref requires a Git revision.');
      reference = value;
      explicitReference = true;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return { all, reference };
}

function auditHistory({ all, reference }) {
  const revisionArguments = all ? ['rev-list', '--all'] : ['rev-list', reference];
  const revisions = execFileSync('git', revisionArguments, { cwd: root, encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const scope = all ? 'all local refs' : `Git revision ${reference}`;
  const blobs = new Map();
  const findings = new Set();

  for (const revision of revisions) {
    const tree = execFileSync('git', ['ls-tree', '-r', '-z', revision], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 20_000_000
    });
    for (const entry of tree.split('\0').filter(Boolean)) {
      const match = entry.match(/^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/);
      if (!match) continue;
      const [, hash, filePath] = match;
      if (blockedPath.test(filePath)) findings.add(`${revision.slice(0, 7)} ${filePath}: raw activity or location file`);
      if (!blobs.has(hash)) blobs.set(hash, new Set());
      blobs.get(hash).add(`${revision.slice(0, 7)} ${filePath}`);
    }
  }

  for (const [hash, locations] of blobs) {
    const buffer = execFileSync('git', ['cat-file', 'blob', hash], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 20_000_000
    });
    if (buffer.subarray(0, Math.min(buffer.length, 8_000)).includes(0)) continue;
    const content = buffer.toString('utf8');
    for (const rule of blockedContent) {
      if (!rule.pattern.test(content)) continue;
      for (const location of locations) findings.add(`${location}: ${rule.reason}`);
    }
  }

  if (findings.size) {
    console.error(`Git history privacy audit failed for ${scope}. Create a clean public branch before the first push:`);
    for (const finding of [...findings].slice(0, 30)) console.error(`- ${finding}`);
    if (findings.size > 30) console.error(`- ${findings.size - 30} more finding(s) omitted`);
    return false;
  }

  console.log(`Git history privacy audit passed for ${scope}.`);
  return true;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (!auditHistory(options)) process.exitCode = 1;
  } catch (error) {
    console.error(`Git history privacy audit could not run: ${error.message}`);
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main();
}

module.exports = { auditHistory, parseArguments };
