const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const blockedPaths = [
  { pattern: /(^|\/)\.env(?:\.|$)/i, reason: 'environment file' },
  { pattern: /(^|\/)(?:node_modules|dist|release|data\/private|training schedule|\.runtime-check[^/]*)\//i, reason: 'private or generated directory' },
  { pattern: /\.(?:fit|gpx|tcx|kml)$/i, reason: 'raw activity or location file' },
  { pattern: /(?:snapshot-cache|codex-handoff-snapshot|user-data)\.json$/i, reason: 'runtime health snapshot' },
  { pattern: /codex-clipboard|screenshot.*\.(?:png|jpe?g|webp)$/i, reason: 'local screenshot' },
  { pattern: /config\/local[^/]*\.json$/i, reason: 'local configuration' }
];

const blockedContent = [
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, reason: 'private key material' },
  { pattern: /\b(?:sk-(?:proj|live)-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}\b/, reason: 'credential-shaped token' },
  { pattern: /["']?(?:access|refresh)[_-]?token["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/i, reason: 'access or refresh token value' },
  { pattern: /["']?client[_-]?secret["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/i, reason: 'client secret value' },
  { pattern: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~-]{12,}/i, reason: 'bearer credential' },
  { pattern: /(?:^|[^.\d])(?:latitude|longitude|startLat|startLng|endLat|endLng)["']?\s*[:=]\s*-?\d{1,3}\.\d{4,}/im, reason: 'precise coordinate' },
  { pattern: /\b\d{18}\b/, reason: 'raw 18-digit activity identifier' },
  { pattern: /[A-Za-z]:\\Users\\[^\\\r\n]+\\/i, reason: 'personal Windows user path' }
];

function trackedFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function isProbablyBinary(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 8_000)).includes(0);
}

const findings = [];
for (const relativePath of trackedFiles()) {
  const portablePath = relativePath.replaceAll('\\', '/');
  for (const rule of blockedPaths) {
    if (rule.pattern.test(portablePath)) findings.push(`${portablePath}: ${rule.reason}`);
  }

  const absolutePath = path.join(root, relativePath);
  const buffer = fs.readFileSync(absolutePath);
  if (isProbablyBinary(buffer)) continue;
  const content = buffer.toString('utf8');
  for (const rule of blockedContent) {
    if (rule.pattern.test(content)) findings.push(`${portablePath}: ${rule.reason}`);
  }
}

if (findings.length) {
  console.error('Public repository audit failed:');
  for (const finding of [...new Set(findings)]) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('Public repository audit passed: no tracked private snapshots, raw activities, coordinates, user paths, or credential-shaped values.');
}
