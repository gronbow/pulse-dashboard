const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { convertIcon } = require('app-builder-lib/out/util/iconConverter');
const { runIconsTool } = require('app-builder-lib/out/toolsets/icons');

const root = path.join(__dirname, '..');
const buildDirectory = path.join(root, 'build');
const sourcePath = path.join(buildDirectory, 'icon.svg');
const icoPath = path.join(buildDirectory, 'icon.ico');
const trayPngPath = path.join(buildDirectory, 'tray-icon.png');

function readIcoSizes(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.ok(buffer.length >= 6, 'ICO file is too small');
  assert.deepEqual([...buffer.subarray(0, 4)], [0, 0, 1, 0], 'ICO header is invalid');
  const count = buffer.readUInt16LE(4);
  assert.ok(count > 0, 'ICO file has no image entries');
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    assert.ok(offset + 16 <= buffer.length, 'ICO directory is truncated');
    sizes.push({
      width: buffer[offset] || 256,
      height: buffer[offset + 1] || 256
    });
  }
  return sizes;
}

async function generateIcons() {
  assert.ok(fs.existsSync(sourcePath), `missing source icon: ${sourcePath}`);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-icons-'));

  try {
    const icoResult = await convertIcon({
      sources: [sourcePath],
      fallbackSources: [],
      roots: [root],
      format: 'ico',
      outDir: path.join(temporaryDirectory, 'ico')
    });
    assert.equal(icoResult.icons.length, 1, 'ICO conversion did not return one icon');

    const pngDirectory = path.join(temporaryDirectory, 'png');
    await runIconsTool({
      inputFile: sourcePath,
      outputFormat: 'set',
      outDir: pngDirectory
    });
    const pngIcons = fs.readdirSync(pngDirectory)
      .map((name) => {
        const match = name.match(/^(\d+)x\d+\.png$/i);
        return match ? { file: path.join(pngDirectory, name), size: Number(match[1]) } : null;
      })
      .filter(Boolean);
    const trayPng = pngIcons.find(({ size }) => size === 32)
      || pngIcons.find(({ size }) => size === 64)
      || pngIcons[0];
    assert.ok(trayPng, 'PNG conversion did not return a tray icon');

    fs.copyFileSync(icoResult.icons[0].file, icoPath);
    fs.copyFileSync(trayPng.file, trayPngPath);

    const icoSizes = readIcoSizes(icoPath);
    for (const expected of [16, 24, 32, 48, 64, 128, 256]) {
      assert.ok(
        icoSizes.some(({ width, height }) => width === expected && height === expected),
        `ICO file is missing the ${expected}x${expected} representation`
      );
    }

    const png = fs.readFileSync(trayPngPath);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'tray PNG header is invalid');
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), 'tray PNG must be square');
    assert.ok(png.readUInt32BE(16) >= 32, 'tray PNG must be at least 32x32');

    console.log(`Generated Pulse icons: ${path.relative(root, icoPath)}, ${path.relative(root, trayPngPath)}`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

generateIcons().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
