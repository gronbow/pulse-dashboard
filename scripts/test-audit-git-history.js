const assert = require('node:assert/strict');
const { parseArguments } = require('./audit-git-history');

assert.deepEqual(parseArguments([]), { all: false, reference: 'HEAD' });
assert.deepEqual(parseArguments(['--ref', 'codex/public-beta']), {
  all: false,
  reference: 'codex/public-beta'
});
assert.deepEqual(parseArguments(['--all']), { all: true, reference: 'HEAD' });
assert.throws(() => parseArguments(['--all', '--ref', 'HEAD']), /either --all or --ref/);
assert.throws(() => parseArguments(['--ref']), /requires a Git revision/);
assert.throws(() => parseArguments(['--unknown']), /Unknown argument/);

console.log('Git history audit CLI tests passed.');
