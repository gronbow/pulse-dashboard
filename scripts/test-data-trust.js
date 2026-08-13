const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  PROVENANCE_VALUES,
  buildDataTrust,
  combineProvenance,
  normalizeProvenance
} = require('../src/data-trust');

const now = Date.parse('2026-08-13T12:00:00+08:00');
const meta = {
  source: 'bridge',
  provider: 'codex-coros-mcp',
  timezone: 'Asia/Shanghai'
};

assert.deepEqual([...PROVENANCE_VALUES], [
  'coros',
  'derived',
  'user',
  'demo',
  'local',
  'mixed',
  'unknown'
]);
assert.equal(normalizeProvenance('coros'), 'coros');
assert.equal(normalizeProvenance('future-provider'), 'unknown');
assert.equal(combineProvenance(['coros', 'coros']), 'coros');
assert.equal(combineProvenance(['coros', 'unknown']), 'mixed');
assert.equal(combineProvenance([]), 'unknown');

assert.deepEqual(
  buildDataTrust({ date: '2026-08-13', provenance: 'coros' }, meta, { now }),
  {
    state: 'current',
    provenance: 'coros',
    freshnessLabel: '今日',
    sourceLabel: 'COROS',
    label: '今日 · COROS',
    compactLabel: '今日',
    title: '数据日期：今日；来源：COROS'
  }
);

assert.equal(
  buildDataTrust({ date: '2026-08-12' }, meta, { now }).label,
  '昨日 · COROS'
);
assert.equal(
  buildDataTrust({ date: '2026-08-11', provenance: 'user' }, meta, { now }).label,
  '2天前 · 用户确认'
);
assert.deepEqual(
  buildDataTrust({ date: '2026-07-24', provenance: 'demo' }, meta, { now }),
  {
    state: 'old',
    provenance: 'demo',
    freshnessLabel: '7月24日',
    sourceLabel: '演示',
    label: '7月24日 · 演示',
    compactLabel: '7/24',
    title: '数据日期：7月24日；来源：演示'
  }
);

const unknownDate = buildDataTrust({ value: 53 }, meta, { now });
assert.equal(unknownDate.state, 'unknown');
assert.equal(unknownDate.label, '日期未知 · COROS');
assert.equal(unknownDate.compactLabel, '日期未知');

const invalidDate = buildDataTrust({ date: '2026-02-30' }, meta, { now });
assert.equal(invalidDate.state, 'unknown');
assert.equal(invalidDate.freshnessLabel, '日期异常');

const scheduled = buildDataTrust(
  { date: '2026-08-14', provenance: 'coros' },
  meta,
  { now, allowFuture: true }
);
assert.equal(scheduled.state, 'scheduled');
assert.equal(scheduled.label, '8月14日 · COROS');
assert.equal(scheduled.compactLabel, '8/14');

const unavailable = buildDataTrust(
  { date: '2026-08-13', provenance: 'coros' },
  meta,
  { now, available: false }
);
assert.equal(unavailable.state, 'unavailable');
assert.equal(unavailable.label, '暂无数据 · COROS');
assert.equal(unavailable.compactLabel, '暂无数据');

const inherited = Object.create({ date: '2026-08-13', provenance: 'coros' });
const inheritedResult = buildDataTrust(inherited, {}, { now });
assert.equal(inheritedResult.label, '日期未知 · 来源未知');

const explicitInvalid = buildDataTrust(
  { date: '2026-08-13', provenance: 'future-provider' },
  meta,
  { now }
);
assert.equal(explicitInvalid.provenance, 'unknown');
assert.equal(explicitInvalid.sourceLabel, '来源未知');

const previousProvenance = Object.getOwnPropertyDescriptor(Object.prototype, 'provenance');
Object.defineProperty(Object.prototype, 'provenance', {
  configurable: true,
  value: 'coros'
});
try {
  const polluted = buildDataTrust({ date: '2026-08-13' }, {}, { now });
  assert.equal(polluted.sourceLabel, '来源未知');
} finally {
  if (previousProvenance) Object.defineProperty(Object.prototype, 'provenance', previousProvenance);
  else delete Object.prototype.provenance;
}

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'data-trust.js'), 'utf8');
const sandbox = {};
vm.runInNewContext(source, sandbox);
assert.equal(typeof sandbox.PulseDataTrust.buildDataTrust, 'function');

console.log('Data trust passed: freshness and provenance fail closed and remain renderer-safe.');
