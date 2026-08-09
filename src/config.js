const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeRetentionDays } = require('./secure-snapshot-store');

const DEFAULT_CONFIG = Object.freeze({
  dataSource: 'demo',
  bridgeUrl: '',
  refreshIntervalMinutes: 5,
  dataRetentionDays: 7,
  alwaysOnTop: true,
  compactMode: false,
  compactAspectRatio: '16:9',
  theme: 'dark',
  opacity: 96,
  launchAtLogin: false,
  timezone: 'Asia/Shanghai',
  windowBounds: null
});

function booleanSetting(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function validTimezone(value) {
  const timezone = String(value || '').trim().slice(0, 64);
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return DEFAULT_CONFIG.timezone;
  }
}

function normalizeWindowBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(360, Math.min(1_600, Math.round(width))),
    height: Math.max(580, Math.min(1_400, Math.round(height)))
  };
}

function normalizeConfig(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const refreshIntervalMinutes = Number(raw.refreshIntervalMinutes);
  const opacity = Number(raw.opacity);
  return {
    dataSource: ['demo', 'bridge', 'codex'].includes(raw.dataSource) ? raw.dataSource : DEFAULT_CONFIG.dataSource,
    bridgeUrl: String(raw.bridgeUrl || '').trim().replace(/\/$/, '').slice(0, 2_048),
    refreshIntervalMinutes: [1, 5, 15, 30, 60].includes(refreshIntervalMinutes)
      ? refreshIntervalMinutes
      : DEFAULT_CONFIG.refreshIntervalMinutes,
    dataRetentionDays: normalizeRetentionDays(raw.dataRetentionDays),
    alwaysOnTop: booleanSetting(raw.alwaysOnTop, DEFAULT_CONFIG.alwaysOnTop),
    compactMode: booleanSetting(raw.compactMode, DEFAULT_CONFIG.compactMode),
    compactAspectRatio: ['4:3', '16:9', '21:9'].includes(raw.compactAspectRatio)
      ? raw.compactAspectRatio
      : DEFAULT_CONFIG.compactAspectRatio,
    launchAtLogin: booleanSetting(raw.launchAtLogin, DEFAULT_CONFIG.launchAtLogin),
    theme: ['dark', 'light', 'system'].includes(raw.theme) ? raw.theme : DEFAULT_CONFIG.theme,
    opacity: Number.isFinite(opacity) ? Math.max(40, Math.min(100, opacity)) : DEFAULT_CONFIG.opacity,
    timezone: validTimezone(raw.timezone || DEFAULT_CONFIG.timezone),
    windowBounds: normalizeWindowBounds(raw.windowBounds)
  };
}

function readConfigFile(filePath) {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfigFile(filePath, input) {
  const safe = normalizeConfig(input);
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(safe, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  return safe;
}

module.exports = {
  DEFAULT_CONFIG,
  normalizeConfig,
  normalizeWindowBounds,
  readConfigFile,
  validTimezone,
  writeConfigFile
};
