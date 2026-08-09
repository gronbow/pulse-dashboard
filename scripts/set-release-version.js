const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const targetVersion = String(process.argv[2] || '').trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(targetVersion)) {
  console.error('Usage: npm run version:set -- <semver>');
  process.exit(1);
}

const definitions = [
  {
    relativePath: 'package.json',
    update(value) { value.version = targetVersion; }
  },
  {
    relativePath: 'package-lock.json',
    update(value) {
      value.version = targetVersion;
      value.packages[''].version = targetVersion;
    }
  },
  {
    relativePath: '.codex-plugin/plugin.json',
    update(value) { value.version = targetVersion; }
  },
  {
    relativePath: 'plugins/pulse-dashboard/.codex-plugin/plugin.json',
    update(value) { value.version = targetVersion; }
  },
  {
    relativePath: 'docs/release-compatibility.json',
    update(value) { value.source.version = targetVersion; }
  }
];

const token = crypto.randomBytes(8).toString('hex');
const staged = definitions.map((definition) => {
  const filePath = path.join(root, definition.relativePath);
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  definition.update(value);
  const temporaryPath = `${filePath}.${token}.tmp`;
  const backupPath = `${filePath}.${token}.bak`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { ...definition, filePath, temporaryPath, backupPath };
});

const replaced = [];
try {
  for (const item of staged) {
    fs.renameSync(item.filePath, item.backupPath);
    try {
      fs.renameSync(item.temporaryPath, item.filePath);
      replaced.push(item);
    } catch (error) {
      fs.renameSync(item.backupPath, item.filePath);
      throw error;
    }
  }
  for (const item of staged) fs.rmSync(item.backupPath, { force: true });
  console.log(`Pulse manifests updated together to v${targetVersion}.`);
} catch (error) {
  for (const item of replaced.reverse()) {
    fs.rmSync(item.filePath, { force: true });
    fs.renameSync(item.backupPath, item.filePath);
  }
  throw error;
} finally {
  for (const item of staged) {
    fs.rmSync(item.temporaryPath, { force: true });
    fs.rmSync(item.backupPath, { force: true });
  }
}
