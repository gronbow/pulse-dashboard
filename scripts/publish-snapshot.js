const fs = require('node:fs');
const http = require('node:http');
const { URL } = require('node:url');

const DEFAULT_URL = 'http://127.0.0.1:19091/api/snapshot';
const MAX_BYTES = 2_000_000;

function readInput() {
  const fileIndex = process.argv.indexOf('--file');
  if (fileIndex >= 0) {
    const filePath = process.argv[fileIndex + 1];
    if (!filePath) throw new Error('missing file path after --file');
    return fs.readFileSync(filePath, 'utf8');
  }
  return fs.readFileSync(0, 'utf8');
}

function assertSnapshot(value) {
  if (!value || typeof value !== 'object' || (!value.health && !Array.isArray(value.todayActivities))) {
    throw new Error('Pulse snapshot must include health or todayActivities');
  }
  return value;
}

function hasEncodingCorruption(value) {
  if (typeof value !== 'string') return false;
  const visible = [...value].filter((character) => !/\s/u.test(character));
  if (visible.length < 3) return false;
  const damaged = visible.filter((character) => character === '?' || character === '\uFFFD').length;
  return damaged / visible.length >= 0.45;
}

function assertTextEncoding(snapshot) {
  const candidates = [
    ...(Array.isArray(snapshot.todayActivities) ? snapshot.todayActivities.map((activity) => activity?.sport) : []),
    snapshot.plan?.name,
    snapshot.plan?.title,
    snapshot.plan?.description,
    snapshot.insight?.text,
    ...(Array.isArray(snapshot.insight?.tags) ? snapshot.insight.tags : [])
  ];
  if (candidates.some(hasEncodingCorruption)) {
    throw new Error('snapshot text encoding is corrupted; publish UTF-8 JSON');
  }
  return snapshot;
}

function isInRange(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}

function assertSnapshotCompleteness(snapshot) {
  const health = snapshot.health && typeof snapshot.health === 'object' ? snapshot.health : {};
  const signalCount = [
    isInRange(health.sleep?.durationMinutes, 1, 1_440),
    isInRange(health.sleep?.score, 1, 100),
    isInRange(health.restingHeartRate?.value, 20, 240),
    isInRange(health.hrv?.value, 1, 500),
    isInRange(health.steps?.value, 1, 200_000),
    isInRange(health.recovery?.value, 1, 100)
  ].filter(Boolean).length;
  if (signalCount < 2) {
    throw new Error('snapshot is incomplete: publish at least two valid health signals instead of placeholder zeros');
  }

  if (String(snapshot.insight?.text || '').trim().length < 8) {
    throw new Error('snapshot is incomplete: a data-grounded training insight is required');
  }

  for (const activity of Array.isArray(snapshot.todayActivities) ? snapshot.todayActivities : []) {
    const distance = Number(activity?.distanceKm);
    const duration = Number(activity?.durationSeconds);
    if (Number.isFinite(distance) && distance > 0 && (!Number.isFinite(duration) || duration <= 0)) {
      throw new Error('snapshot is incomplete: an activity with distance must include a positive duration');
    }
  }
  return snapshot;
}

function responseDetail(body) {
  try {
    const parsed = JSON.parse(body);
    const detail = parsed?.error || parsed?.message;
    if (typeof detail === 'string' && detail.trim()) return `: ${detail.trim().slice(0, 240)}`;
  } catch {
    // A non-JSON response has no safe structured detail to expose.
  }
  return '';
}

async function publish() {
  const input = readInput();
  const raw = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error('Pulse snapshot exceeds 2 MB');
  const snapshot = assertSnapshotCompleteness(assertTextEncoding(assertSnapshot(JSON.parse(raw))));
  const target = new URL(process.env.PULSE_HANDOFF_URL || DEFAULT_URL);
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error('Pulse handoff only permits a local 127.0.0.1 or localhost HTTP endpoint');
  }
  const body = JSON.stringify(snapshot);
  const response = await new Promise((resolve, reject) => {
    const request = http.request(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf8')
      },
      timeout: 12_000
    }, (result) => {
      let body = '';
      result.setEncoding('utf8');
      result.on('data', (chunk) => { body += chunk; });
      result.on('end', () => resolve({ status: result.statusCode, body }));
    });
    request.on('timeout', () => request.destroy(new Error('Pulse handoff timed out')));
    request.on('error', reject);
    request.end(body);
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Pulse handoff returned HTTP ${response.status}${responseDetail(response.body)}`);
  }
  console.log('Pulse dashboard snapshot published.');
}

if (require.main === module) {
  publish().catch((error) => {
    console.error(`Pulse handoff failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertSnapshot,
  assertSnapshotCompleteness,
  assertTextEncoding,
  hasEncodingCorruption,
  publish
};
