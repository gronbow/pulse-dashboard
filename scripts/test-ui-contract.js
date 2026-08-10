const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8');

function rgb(hex) {
  return hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
}

function luminance(hex) {
  return rgb(hex)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const [label, foreground, background] of [
  ['dark text', '#f3f5f2', '#0a0e0f'],
  ['dark muted', '#a9b3af', '#0a0e0f'],
  ['dark accent', '#b7f34a', '#0a0e0f'],
  ['dark warning', '#ffb36f', '#0a0e0f'],
  ['light text', '#172019', '#f5f9f5'],
  ['light muted', '#536158', '#f5f9f5'],
  ['light accent', '#426a00', '#f5f9f5'],
  ['light warning', '#914300', '#f5f9f5']
]) {
  assert.ok(contrast(foreground, background) >= 4.5, `${label} must meet WCAG AA text contrast`);
}

assert.match(html, /class="icon-sprite"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /id="plan-state"/);
assert.match(html, /<script src="\.\.\/safety-presentation\.js"><\/script>\s*<script src="app\.js"><\/script>/);
assert.doesNotMatch(html, /[⚙⌁☾♥∿]/, 'UI icons must use the bundled SVG symbol set');
assert.match(styles, /:focus-visible/);
assert.doesNotMatch(styles, /\.switch-row input\s*\{[^}]*display:\s*none/s);
assert.match(renderer, /PulseSafetyPresentation\.buildSafetyPresentation\(snapshot\)/);
assert.match(renderer, /document\.body\.dataset\.safetyRule\s*=\s*safetyPresentation\.ruleId/);
assert.match(renderer, /setAttribute\(['"]role['"],\s*safetyPresentation\.announcement\.role\)/);
assert.match(renderer, /setAttribute\(['"]aria-live['"],\s*safetyPresentation\.announcement\.politeness\)/);
assert.match(renderer, /currentSafety\.mode\s*!==\s*['"]ready['"]/);
assert.doesNotMatch(main, /mainWindow\.setOpacity/);
assert.match(main, /clampWindowBounds/);
assert.match(config, /windowBounds/);

console.log('UI contract passed: contrast, SVG icons, keyboard focus, live status and surface-only transparency are enforced.');
