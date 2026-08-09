const assert = require('node:assert/strict');
const path = require('node:path');
const {
  FuseV1Options,
  getCurrentFuseWire
} = require('@electron/fuses');
const { FuseState } = require('@electron/fuses/dist/constants');

const executablePath = path.join(__dirname, '..', 'release', 'win-unpacked', 'Pulse Dashboard.exe');
const expected = new Map([
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE]
]);

(async () => {
  const wire = await getCurrentFuseWire(executablePath);
  for (const [option, state] of expected) assert.equal(wire[option], state, `unexpected fuse state for option ${option}`);
  console.log('Electron fuses passed: packaged runtime disables Node/inspect overrides and enforces ASAR integrity.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
