const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, safeStorage, screen, session, Tray } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { normalizeInsight, normalizeSnapshot, resolveFallbackSnapshot } = require('./snapshot');
const { createDataSourceAdapter } = require('./adapters/data-source-adapter');
const { CODEX_HANDOFF_PORT, CODEX_HANDOFF_URL, createCodexHandoffServer } = require('../bridge/codex-handoff-server');
const {
  bearerHeaders,
  createIdentityChallenge,
  readHandoffToken,
  resolveHandoffAuthPath,
  verifyHandoffIdentity
} = require('../scripts/handoff-auth');
const {
  createSecureSnapshotCodec,
  isSnapshotExpired,
  snapshotTimestamp
} = require('./secure-snapshot-store');
const { assertSnapshotForDisplay } = require('../scripts/snapshot-policy');
const {
  PULSE_APP_ASSETS,
  PULSE_APP_ENTRY_URL,
  PULSE_APP_ORIGIN,
  PULSE_RENDERER_CSP,
  installPulseAppProtocol,
  registerPulseAppScheme
} = require('./app-protocol');
const {
  DEFAULT_CONFIG,
  normalizeConfig,
  readConfigFile,
  writeConfigFile
} = require('./config');

const WINDOWS_APP_ID = 'app.pulse.dashboard';

let mainWindow;
let tray;
let quitting = false;
let codexHandoffServer;
let codexHandoffUrl = CODEX_HANDOFF_URL;
let invalidLegacySnapshotPaths = [];
let applyingWindowLayout = false;
let persistWindowBoundsTimer;
registerPulseAppScheme(protocol);
if (process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_ID);
app.enableSandbox();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function snapshotCachePath() {
  return path.join(app.getPath('userData'), 'snapshot-store.v2.json');
}

function legacySnapshotPaths() {
  const candidates = [path.join(app.getPath('userData'), 'snapshot-cache.json')];
  if (app.isPackaged && !smokeScreenshotPath()) {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || app.getPath('userData');
    candidates.push(path.join(base, 'PulseDashboard', 'codex-handoff-snapshot.json'));
  }
  return [...new Set(candidates)].filter((candidate) => candidate !== snapshotCachePath());
}

function readConfig() {
  return readConfigFile(configPath());
}

function writeConfig(next) {
  return writeConfigFile(configPath(), next);
}

function readSnapshotCache() {
  try {
    const snapshot = createSecureSnapshotCodec(safeStorage).decode(fs.readFileSync(snapshotCachePath(), 'utf8'));
    if (isSnapshotExpired(snapshot, readConfig().dataRetentionDays)) {
      fs.unlinkSync(snapshotCachePath());
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function writeSnapshotCache(snapshot) {
  const filePath = snapshotCachePath();
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, createSecureSnapshotCodec(safeStorage).encode(snapshot), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function removeFileIfPresent(filePath) {
  try { fs.unlinkSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function migrateLegacySnapshotStore() {
  invalidLegacySnapshotPaths = [];
  const existingSecureSnapshot = readSnapshotCache();
  const candidates = [];
  for (const filePath of legacySnapshotPaths()) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assertSnapshotForDisplay(snapshot);
      const timestamp = snapshotTimestamp(snapshot);
      if (timestamp != null) candidates.push({ filePath, snapshot, timestamp });
    } catch {
      if (fs.existsSync(filePath)) invalidLegacySnapshotPaths.push(filePath);
    }
  }
  candidates.sort((left, right) => right.timestamp - left.timestamp);
  if (existingSecureSnapshot) {
    for (const candidate of candidates) removeFileIfPresent(candidate.filePath);
    return;
  }
  const newest = candidates[0];
  if (newest && !isSnapshotExpired(newest.snapshot, readConfig().dataRetentionDays)) {
    writeSnapshotCache(newest.snapshot);
    if (!readSnapshotCache()) throw new Error('Pulse could not verify the migrated secure snapshot store');
  }
  for (const candidate of candidates) removeFileIfPresent(candidate.filePath);
}

async function promptInvalidLegacySnapshotCleanup() {
  const paths = [...new Set(invalidLegacySnapshotPaths)].filter((filePath) => fs.existsSync(filePath));
  if (!paths.length || smokeScreenshotPath()) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['暂时保留', '删除旧文件'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: '发现旧版明文快照',
    message: 'Pulse 发现无法验证的旧版明文健康快照。',
    detail: '这些文件不会被读取或迁移。你可以保留以便手动检查，或立即从本机删除。'
  });
  if (result.response === 1) {
    for (const filePath of paths) removeFileIfPresent(filePath);
    invalidLegacySnapshotPaths = [];
  }
}

function requestJson(target, options = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(target);
    } catch {
      reject(new Error('桥接地址不是有效的 URL'));
      return;
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      reject(new Error('桥接地址只支持 HTTP 或 HTTPS'));
      return;
    }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      reject(new Error('为保护健康数据，桥接地址必须是本机 localhost 或 127.0.0.1'));
      return;
    }
    const client = url.protocol === 'https:' ? https : http;
    const requestBody = options.body ? JSON.stringify(options.body) : '';
    const request = client.request(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody, 'utf8') } : {}),
        ...(options.headers || {})
      },
      timeout: 12_000
    }, (response) => {
      let body = '';
      let responseBytes = 0;
      response.setEncoding('utf8');
      response.on('error', reject);
      response.on('data', (chunk) => {
        responseBytes += Buffer.byteLength(chunk, 'utf8');
        if (responseBytes > 2_000_000) {
          response.destroy(new Error('桥接响应超过 2 MB 限制'));
          return;
        }
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          let detail = '';
          try {
            const parsed = JSON.parse(body);
            if (typeof parsed?.message === 'string' && parsed.message.trim()) {
              detail = `：${parsed.message.trim().slice(0, 240)}`;
            }
          } catch {
            // Keep non-JSON error bodies out of the UI.
          }
          reject(new Error(`桥接服务返回 HTTP ${response.statusCode}${detail}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('桥接服务返回的不是 JSON'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('桥接服务响应超时')));
    request.on('error', reject);
    if (requestBody) request.write(requestBody);
    request.end();
  });
}

function mockSnapshot() {
  const fixturePath = path.join(__dirname, 'mock', 'snapshot.json');
  return normalizeSnapshot(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
}

function normalizeBridgeSnapshot(payload, metaOverrides) {
  return normalizeSnapshot(assertSnapshotForDisplay(payload), metaOverrides);
}

function resolveBridgeUrl(config) {
  if (config.dataSource === 'codex') return codexHandoffUrl;
  return config.bridgeUrl;
}

function friendlyBridgeError(error, dataSource) {
  const message = String(error?.message || '').trim();
  if (/ECONNREFUSED|connect\s+/i.test(message)) {
    return dataSource === 'codex' ? '本机 Handoff 尚未就绪' : '本地桥接服务尚未启动';
  }
  if (/ETIMEDOUT|响应超时/i.test(message)) return '本地桥接服务响应超时';
  if (/ENOTFOUND|getaddrinfo/i.test(message)) return '无法解析本地桥接地址';
  if (/identity check|身份校验/i.test(message)) return 'Handoff 身份校验失败，固定端口可能被其他进程占用';
  if (/authentication|HTTP 401/i.test(message)) return 'Handoff 身份令牌无效，请重启 Pulse 后重试';
  return message.slice(0, 240) || '本地桥接暂不可用';
}

async function verifyCodexHandoff(bridgeUrl, token) {
  const challenge = createIdentityChallenge();
  const identity = await requestJson(`${bridgeUrl}/api/health?challenge=${challenge}`);
  if (!verifyHandoffIdentity(identity, token, challenge)) {
    throw new Error('Pulse handoff identity check failed');
  }
  return requestJson(`${bridgeUrl}/api/health?challenge=${challenge}`, {
    headers: bearerHeaders(token)
  });
}

function createHttpBridgeAdapter(config) {
  const bridgeUrl = resolveBridgeUrl(config);
  const provider = config.dataSource === 'codex' ? 'codex-coros-mcp' : 'mcp-bridge';
  const codexToken = config.dataSource === 'codex'
    ? (codexHandoffServer?.handoffToken || readHandoffToken())
    : '';
  return createDataSourceAdapter({
    id: config.dataSource === 'codex' ? 'codex-handoff' : 'http-bridge',
    label: config.dataSource === 'codex' ? 'Codex Handoff' : 'HTTP Bridge',
    provider,
    fetchSnapshot: async () => {
      if (config.dataSource === 'codex') {
        const health = await verifyCodexHandoff(bridgeUrl, codexToken);
        if (!health.ready) throw new Error(health.message || '本机 Handoff 尚未就绪');
      }
      return requestJson(`${bridgeUrl}/api/snapshot?timezone=${encodeURIComponent(config.timezone)}`, {
        headers: config.dataSource === 'codex' ? bearerHeaders(codexToken) : undefined
      });
    },
    generateInsight: config.dataSource === 'codex'
      ? async () => {
        await verifyCodexHandoff(bridgeUrl, codexToken);
        return requestJson(`${bridgeUrl}/api/insight`, {
          method: 'POST',
          headers: bearerHeaders(codexToken)
        });
      }
      : null
  });
}

async function loadSnapshot() {
  const config = readConfig();
  const fallback = mockSnapshot();
  if (config.dataSource === 'demo') {
    return fallback;
  }
  try {
    const adapter = createHttpBridgeAdapter(config);
    const snapshot = normalizeBridgeSnapshot(await adapter.fetchSnapshot(), { source: 'bridge', provider: adapter.provider });
    if (config.dataSource !== 'codex') writeSnapshotCache(snapshot);
    return snapshot;
  } catch (error) {
    const provider = config.dataSource === 'codex' ? 'codex-coros-mcp' : 'mcp-bridge';
    const cached = readSnapshotCache();
    return resolveFallbackSnapshot(cached, {
      provider,
      timezone: config.timezone,
      error: friendlyBridgeError(error, config.dataSource)
    });
  }
}

function applyWindowConfig(config) {
  if (!mainWindow) return;
  applyWindowLayout(config);
  mainWindow.setAlwaysOnTop(Boolean(config.alwaysOnTop));
  if (app.isPackaged && typeof app.setLoginItemSettings === 'function') {
    app.setLoginItemSettings({ openAtLogin: config.launchAtLogin, args: ['--hidden'] });
  }
}

function windowSizeForConfig(config) {
  if (config.compactMode) {
    const sizes = {
      '16:9': { width: 360, height: 203 },
      '4:3': { width: 360, height: 270 },
      '21:9': { width: 420, height: 180 }
    };
    return sizes[config.compactAspectRatio] || sizes['16:9'];
  }
  return config.windowBounds
    ? { width: config.windowBounds.width, height: config.windowBounds.height }
    : { width: 430, height: 820 };
}

function clampWindowBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const width = Math.min(Math.max(1, Math.round(bounds.width)), workArea.width);
  const height = Math.min(Math.max(1, Math.round(bounds.height)), workArea.height);
  return {
    x: Math.min(Math.max(Math.round(bounds.x), workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(Math.round(bounds.y), workArea.y), workArea.y + workArea.height - height),
    width,
    height
  };
}

function initialWindowBounds(config) {
  const size = windowSizeForConfig(config);
  if (!config.windowBounds) return size;
  return clampWindowBounds({ ...config.windowBounds, ...size });
}

function applyWindowLayout(config) {
  if (!mainWindow) return;
  const compact = Boolean(config.compactMode);
  const size = windowSizeForConfig(config);
  const current = mainWindow.getBounds();
  const preferred = compact
    ? { x: current.x, y: current.y, ...size }
    : config.windowBounds || { x: current.x, y: current.y, ...size };
  const bounds = clampWindowBounds(preferred);
  applyingWindowLayout = true;
  mainWindow.setResizable(!compact);
  mainWindow.setMinimumSize(compact ? size.width : 360, compact ? size.height : 580);
  mainWindow.setBounds(bounds);
  setImmediate(() => { applyingWindowLayout = false; });
}

function persistWindowBounds() {
  if (!mainWindow || applyingWindowLayout || readConfig().compactMode) return;
  clearTimeout(persistWindowBoundsTimer);
  persistWindowBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || readConfig().compactMode) return;
    const bounds = clampWindowBounds(mainWindow.getBounds());
    writeConfig({ ...readConfig(), windowBounds: bounds });
  }, 250);
}

async function testBridge(bridgeUrl, timezone, dataSource) {
  const config = normalizeConfig({ bridgeUrl, timezone, dataSource });
  if (config.dataSource === 'demo') return { ok: false, message: '演示数据不需要测试连接' };
  if (config.dataSource === 'bridge' && !config.bridgeUrl) return { ok: false, message: '请先填写桥接地址' };
  try {
    const adapter = createHttpBridgeAdapter(config);
    const snapshot = normalizeBridgeSnapshot(await adapter.fetchSnapshot(), { source: 'bridge', provider: adapter.provider });
    return {
      ok: true,
      message: `连接成功：${snapshot.todayActivities.length} 条今日活动数据`,
      snapshotVersion: snapshot.version
    };
  } catch (error) {
    throw new Error(friendlyBridgeError(error, config.dataSource));
  }
}

async function generateInsight(snapshot) {
  const config = readConfig();
  const safeSnapshot = normalizeSnapshot(snapshot);
  if (config.dataSource !== 'demo' && resolveBridgeUrl(config)) {
    try {
      const adapter = createHttpBridgeAdapter(config);
      if (adapter.generateInsight) {
        const result = await adapter.generateInsight(safeSnapshot);
        const insight = normalizeInsight(result);
        if (insight.text) return { ...insight, source: 'bridge' };
      }
    } catch {
      // The cached/local insight below is the intentional offline fallback.
    }
  }
  return { text: safeSnapshot.insight?.text || '暂无洞察，请先刷新数据。', source: 'local' };
}

function smokeScreenshotPath() {
  if (app.isPackaged) return '';
  const prefix = '--pulse-smoke-screenshot=';
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? path.resolve(argument.slice(prefix.length)) : '';
}

function packagedAppProtocolCheckPath() {
  if (!app.isPackaged) return '';
  if (!process.argv.includes('--pulse-app-protocol-check')) return '';
  return path.join(app.getPath('userData'), 'protocol-self-check.json');
}

async function runPackagedAppProtocolCheck(outputPath) {
  const assets = [];
  for (const [url, definition] of Object.entries(PULSE_APP_ASSETS)) {
    const response = await net.fetch(url);
    const body = await response.text();
    assets.push({
      url,
      status: response.status,
      contentType: response.headers.get('content-type'),
      csp: response.headers.get('content-security-policy'),
      nosniff: response.headers.get('x-content-type-options'),
      body
    });
    if (response.status !== 200 || response.headers.get('content-type') !== definition.contentType) break;
  }
  const entry = assets.find(({ url }) => url === PULSE_APP_ENTRY_URL);
  const blocked = await net.fetch(`${PULSE_APP_ORIGIN}/main.js`);
  const result = {
    ok: assets.length === Object.keys(PULSE_APP_ASSETS).length
      && assets.every(({ status, csp, nosniff, body }) => status === 200
        && csp === PULSE_RENDERER_CSP
        && nosniff === 'nosniff'
        && body.length > 0)
      && entry?.body.includes('<title>Pulse Dashboard</title>')
      && blocked.status === 404,
    packaged: app.isPackaged,
    assetCount: assets.length,
    entryStatus: entry?.status || 0,
    blockedStatus: blocked.status,
    cspEnforced: entry?.csp === PULSE_RENDERER_CSP,
    mimeProtected: entry?.nosniff === 'nosniff'
  };
  if (!result.ok) throw new Error(`packaged protocol self-check failed: ${JSON.stringify(result)}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
}

function trayIconCheckPath() {
  const prefix = '--pulse-tray-icon-check=';
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? path.resolve(argument.slice(prefix.length)) : '';
}

function windowIconCheckPath() {
  const prefix = '--pulse-window-icon-check=';
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? path.resolve(argument.slice(prefix.length)) : '';
}

function trayIconCandidates() {
  if (app.isPackaged) {
    return [
      path.join(process.resourcesPath, 'pulse-tray.ico'),
      path.join(process.resourcesPath, 'pulse-tray.png')
    ];
  }
  return [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'tray-icon.png')
  ];
}

function inspectTrayImage(image) {
  if (!image || image.isEmpty()) throw new Error('托盘图标为空');
  const sample = image.resize({ width: 32, height: 32, quality: 'best' });
  const { width, height } = sample.getSize();
  if (width !== 32 || height !== 32) throw new Error('托盘图标无法缩放到 32x32');

  const bitmap = sample.toBitmap();
  let visiblePixels = 0;
  let limePixels = 0;
  let darkPixels = 0;
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    const blue = bitmap[offset];
    const green = bitmap[offset + 1];
    const red = bitmap[offset + 2];
    const alpha = bitmap[offset + 3];
    if (alpha > 24) visiblePixels += 1;
    if (alpha > 80 && green > 160 && red > 120 && green > blue + 45) limePixels += 1;
    if (alpha > 80 && red < 70 && green < 90 && blue < 70) darkPixels += 1;
  }
  if (visiblePixels < 300 || limePixels < 120 || darkPixels < 20) {
    throw new Error('托盘图标像素内容不完整');
  }

  return {
    empty: false,
    size: image.getSize(),
    sampleSize: { width, height },
    scaleFactors: image.getScaleFactors(),
    pngBytes: sample.toPNG().length,
    visiblePixels,
    limePixels,
    darkPixels
  };
}

function loadPulseIcon() {
  const errors = [];
  for (const candidate of trayIconCandidates()) {
    if (!fs.existsSync(candidate)) {
      errors.push(`${candidate}: 文件不存在`);
      continue;
    }
    const image = nativeImage.createFromPath(candidate);
    try {
      return { image, sourcePath: candidate, inspection: inspectTrayImage(image) };
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`无法加载 Pulse 托盘图标；${errors.join('；')}`);
}

function smokeScrollSelector() {
  if (app.isPackaged) return '';
  const selector = String(process.env.PULSE_SMOKE_SCROLL_SELECTOR || '').trim();
  return selector.length <= 80 && /^[#.][A-Za-z0-9_-]+$/.test(selector) ? selector : '';
}

function smokeTextExpectations() {
  if (app.isPackaged) return [];
  const raw = String(process.env.PULSE_SMOKE_EXPECTATIONS || '').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('smoke text expectations must be a JSON object');
  }
  return Object.entries(parsed).map(([selector, expected]) => {
    if (!/^[#.][A-Za-z0-9_-]+$/.test(selector) || selector.length > 80) {
      throw new Error(`invalid smoke expectation selector: ${selector}`);
    }
    const text = String(expected);
    if (!text || text.length > 100) {
      throw new Error(`invalid smoke expectation text for ${selector}`);
    }
    return { selector, text };
  });
}

function smokeAttributeExpectations() {
  if (app.isPackaged) return [];
  const raw = String(process.env.PULSE_SMOKE_ATTRIBUTE_EXPECTATIONS || '').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('smoke attribute expectations must be a JSON array');
  }
  return parsed.map((entry) => {
    const selector = String(entry?.selector || '');
    const attribute = String(entry?.attribute || '');
    const expected = String(entry?.expected || '');
    if (!/^(?:body|[#.][A-Za-z0-9_-]+)$/.test(selector) || selector.length > 80) {
      throw new Error(`invalid smoke attribute selector: ${selector}`);
    }
    if (!/^(?:role|aria-live|data-safety-rule|data-trust-state)$/.test(attribute)) {
      throw new Error(`invalid smoke attribute name: ${attribute}`);
    }
    if (!expected || expected.length > 100) {
      throw new Error(`invalid smoke attribute value for ${selector}`);
    }
    return { selector, attribute, expected };
  });
}

function smokeLayoutAuditMode() {
  if (app.isPackaged) return '';
  const mode = String(process.env.PULSE_SMOKE_LAYOUT_AUDIT || '').trim();
  return ['compact', 'full'].includes(mode) ? mode : '';
}

async function prepareAndAuditSmokeLayout() {
  if (process.env.PULSE_SMOKE_LONG_TEXT === '1') {
    await mainWindow.webContents.executeJavaScript(`(() => {
      document.querySelector('#source-badge').textContent = 'Codex COROS MCP 本机缓存数据尚待完整同步';
      document.querySelector('#readiness-chip').textContent = '数据不足 · 当前主观安全确认尚未完整提供';
      document.querySelector('#plan-title').textContent = '本周耐力训练与恢复状态动态调整计划';
      document.querySelector('#plan-description').textContent = '根据睡眠、恢复和近期训练负荷变化，在保持舒适强度的前提下灵活调整当天内容。';
    })()`, true);
  }
  const mode = smokeLayoutAuditMode();
  if (!mode) return;
  const result = await mainWindow.webContents.executeJavaScript(`(() => {
    const mode = ${JSON.stringify(smokeLayoutAuditMode())};
    const selectors = mode === 'compact'
      ? ['#compact-widget', '.compact-header', '.compact-status', '.compact-metric-grid', ...Array.from(document.querySelectorAll('.compact-metric')).map((_, index) => '.compact-metric:nth-child(' + (index + 1) + ')')]
      : ['.app-shell', '.titlebar', '.dayline', '.insight-card', '.training-card', '.metric-grid', '.plan-card', '.trend-card'];
    const violations = [];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) { violations.push(selector + ':missing'); continue; }
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.width < 1) {
        violations.push(selector + ':outside-viewport');
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1) {
      violations.push('document:horizontal-overflow');
    }
    if (mode === 'compact') {
      const valueSize = Number.parseFloat(getComputedStyle(document.querySelector('.compact-metric strong')).fontSize);
      const labelSize = Number.parseFloat(getComputedStyle(document.querySelector('.compact-metric-label')).fontSize);
      if (valueSize < 20) violations.push('compact-value:too-small');
      if (labelSize < 11) violations.push('compact-label:too-small');
    }
    return violations;
  })()`, true);
  if (result.length) throw new Error(`smoke layout audit failed: ${result.join(', ')}`);
}

async function captureSmokeScreenshot(outputPath) {
  const smokeConfig = await mainWindow.webContents.executeJavaScript(
    'window.pulseDesktop.getConfig()',
    true
  );
  if (smokeConfig?.launchAtLogin !== false) {
    throw new Error('fresh smoke profile unexpectedly enables launch at login');
  }
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    ready = await mainWindow.webContents.executeJavaScript(
      "document.body.dataset.snapshotReady === 'true'",
      true
    );
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('dashboard did not finish rendering within 3 seconds');
  await prepareAndAuditSmokeLayout();
  for (const expectation of smokeTextExpectations()) {
    const actual = await mainWindow.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(expectation.selector)})?.textContent || ''`,
      true
    );
    if (!actual.includes(expectation.text)) {
      throw new Error(
        `smoke text mismatch for ${expectation.selector}: expected ${JSON.stringify(expectation.text)}, `
        + `received ${JSON.stringify(actual)}`
      );
    }
  }
  for (const expectation of smokeAttributeExpectations()) {
    const actual = await mainWindow.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(expectation.selector)})?.getAttribute(${JSON.stringify(expectation.attribute)}) || ''`,
      true
    );
    if (actual !== expectation.expected) {
      throw new Error(
        `smoke attribute mismatch for ${expectation.selector}[${expectation.attribute}]: `
        + `expected ${JSON.stringify(expectation.expected)}, received ${JSON.stringify(actual)}`
      );
    }
  }
  const selector = smokeScrollSelector();
  if (selector) {
    const found = await mainWindow.webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      true
    );
    if (!found) throw new Error(`smoke scroll target was not found: ${selector}`);
    await mainWindow.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`,
      true
    );
    const visible = await mainWindow.webContents.executeJavaScript(
      `(() => {
        const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      })()`,
      true
    );
    if (!visible) throw new Error(`smoke scroll target did not enter the viewport: ${selector}`);
  }
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    true
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  await mainWindow.webContents.capturePage();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const image = await mainWindow.webContents.capturePage();
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  let brandPixels = 0;
  for (let y = 0; y < Math.floor(height * 0.16); y += 1) {
    for (let x = 0; x < Math.floor(width * 0.4); x += 1) {
      const offset = (y * width + x) * 4;
      const blue = bitmap[offset];
      const green = bitmap[offset + 1];
      const red = bitmap[offset + 2];
      if (red > 140 && green > 180 && blue < 150) brandPixels += 1;
    }
  }
  if (!selector && brandPixels < width * height * 0.001) {
    throw new Error('dashboard brand area was not painted in the captured frame');
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
}

function createWindow() {
  const config = readConfig();
  const startHidden = process.argv.includes('--hidden');
  const smokeOutput = smokeScreenshotPath();
  const windowIcon = loadPulseIcon();
  const initialBounds = initialWindowBounds(config);
  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: config.compactMode ? initialBounds.width : 360,
    minHeight: config.compactMode ? initialBounds.height : 580,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: config.alwaysOnTop,
    backgroundColor: '#00000000',
    icon: windowIcon.image,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  configureWindowIdentity(mainWindow, windowIcon);
  applyWindowConfig(config);
  mainWindow.loadURL(PULSE_APP_ENTRY_URL);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', async () => {
    if (smokeOutput) {
      try {
        mainWindow.show();
        await captureSmokeScreenshot(smokeOutput);
        quitting = true;
        app.quit();
      } catch (error) {
        console.error(`Pulse desktop smoke capture failed: ${error.message}`);
        app.exit(1);
      }
      return;
    }
    if (!startHidden) mainWindow.show();
    promptInvalidLegacySnapshotCleanup().catch(() => {
      // Leave unverified legacy files untouched if the user prompt cannot be shown.
    });
  });
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('move', persistWindowBounds);
  mainWindow.on('resize', persistWindowBounds);
}

function configureSessionSecurity() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  if (typeof session.defaultSession.setDevicePermissionHandler === 'function') {
    session.defaultSession.setDevicePermissionHandler(() => false);
  }
}

function createTray() {
  const { image } = loadPulseIcon();
  tray = new Tray(image);
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏看板', click: () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show() },
    { label: '读取最新同步', click: () => mainWindow.webContents.send('dashboard:refresh') },
    { label: '打开设置', click: () => { mainWindow.show(); mainWindow.webContents.send('dashboard:open-settings'); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Pulse 健康与训练看板');
  tray.setContextMenu(menu);
  tray.on('double-click', () => mainWindow.show());
}

function runTrayIconCheck(outputPath) {
  const { image, sourcePath, inspection } = loadPulseIcon();
  tray = new Tray(image);
  tray.setToolTip('Pulse 健康与训练看板');
  const result = {
    ok: true,
    packaged: app.isPackaged,
    sourcePath,
    trayCreated: Boolean(tray),
    bounds: tray.getBounds(),
    ...inspection
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  tray.destroy();
  tray = null;
}

function configureWindowIdentity(window, iconAsset) {
  if (process.platform !== 'win32') {
    return { appId: '', appDetailsApplied: false, windowIconApplied: false };
  }
  window.setIcon(iconAsset.image);
  window.setAppDetails({
    appId: WINDOWS_APP_ID,
    appIconPath: iconAsset.sourcePath,
    appIconIndex: 0
  });
  return {
    appId: WINDOWS_APP_ID,
    appDetailsApplied: true,
    windowIconApplied: true
  };
}

function runWindowIconCheck(outputPath) {
  const iconAsset = loadPulseIcon();
  const checkWindow = new BrowserWindow({
    width: 240,
    height: 180,
    show: false,
    icon: iconAsset.image
  });
  const identity = configureWindowIdentity(checkWindow, iconAsset);
  const nativeWindowHandle = checkWindow.getNativeWindowHandle();
  const result = {
    ok: true,
    packaged: app.isPackaged,
    processExecutable: process.execPath,
    sourcePath: iconAsset.sourcePath,
    windowCreated: !checkWindow.isDestroyed(),
    nativeHandleBytes: nativeWindowHandle.length,
    ...identity,
    ...iconAsset.inspection
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  checkWindow.destroy();
}

function startCodexHandoffBridge() {
  if (codexHandoffServer) return Promise.resolve(codexHandoffServer);
  migrateLegacySnapshotStore();
  const codec = createSecureSnapshotCodec(safeStorage);
  codexHandoffServer = createCodexHandoffServer({
    filePath: snapshotCachePath(),
    authPath: resolveHandoffAuthPath(),
    encodeSnapshot: codec.encode,
    decodeSnapshot: codec.decode,
    getRetentionDays: () => readConfig().dataRetentionDays
  });
  codexHandoffServer.on('snapshot-updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dashboard:refresh');
    }
  });
  codexHandoffServer.on('error', (error) => {
    console.error(`Pulse Codex handoff bridge (${CODEX_HANDOFF_PORT}) unavailable: ${error.message}`);
  });
  return new Promise((resolve, reject) => {
    const handleStartupError = (error) => {
      codexHandoffServer?.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      codexHandoffServer?.off('error', handleStartupError);
      const address = codexHandoffServer?.address();
      if (address && typeof address === 'object') {
        codexHandoffUrl = `http://127.0.0.1:${address.port}`;
      }
      resolve(codexHandoffServer);
    };
    codexHandoffServer.once('error', handleStartupError);
    codexHandoffServer.once('listening', handleListening);
    codexHandoffServer.listen(CODEX_HANDOFF_PORT, '127.0.0.1');
  });
}

if (!hasSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    installPulseAppProtocol(protocol);
    configureSessionSecurity();
    try {
      const protocolCheckOutput = packagedAppProtocolCheckPath();
      if (protocolCheckOutput) {
        await runPackagedAppProtocolCheck(protocolCheckOutput);
        app.exit(0);
        return;
      }
    } catch (error) {
      console.error(`Pulse packaged protocol check failed: ${error.message}`);
      app.exit(1);
      return;
    }
    const trayCheckOutput = trayIconCheckPath();
    if (trayCheckOutput) {
      try {
        runTrayIconCheck(trayCheckOutput);
        app.exit(0);
      } catch (error) {
        console.error(`Pulse tray icon check failed: ${error.message}`);
        app.exit(1);
      }
      return;
    }
    const windowCheckOutput = windowIconCheckPath();
    if (windowCheckOutput) {
      try {
        runWindowIconCheck(windowCheckOutput);
        app.exit(0);
      } catch (error) {
        console.error(`Pulse window icon check failed: ${error.message}`);
        app.exit(1);
      }
      return;
    }
    try {
      await startCodexHandoffBridge();
    } catch (error) {
      codexHandoffServer = null;
      console.error(`Pulse secure Handoff could not start: ${error.message}`);
    }
    createWindow();
    createTray();
    app.on('activate', () => mainWindow?.show());
  });
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true;
  codexHandoffServer?.close();
});

function assertTrustedRenderer(event) {
  const actual = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (actual !== PULSE_APP_ENTRY_URL) throw new Error('Untrusted renderer IPC request blocked');
}

async function clearLocalHealthData() {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['取消', '清除数据'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: '清除本机健康数据',
    message: '确定清除 Pulse 在本机保存的健康与训练快照吗？',
    detail: '该操作不会删除 COROS 或 Codex 中的数据，也不会重置 Handoff 身份令牌。'
  });
  if (result.response !== 1) return { cleared: false };
  codexHandoffServer?.clearSnapshot();
  removeFileIfPresent(snapshotCachePath());
  for (const filePath of legacySnapshotPaths()) removeFileIfPresent(filePath);
  mainWindow?.webContents.send('dashboard:refresh');
  return { cleared: true };
}

ipcMain.handle('app:get-config', (event) => { assertTrustedRenderer(event); return readConfig(); });
ipcMain.handle('app:update-config', (event, next) => {
  assertTrustedRenderer(event);
  const config = writeConfig({ ...readConfig(), ...(next || {}) });
  applyWindowConfig(config);
  return config;
});
ipcMain.handle('app:get-snapshot', (event) => { assertTrustedRenderer(event); return loadSnapshot(); });
ipcMain.handle('app:test-bridge', (event, bridgeUrl, timezone, dataSource) => {
  assertTrustedRenderer(event);
  return testBridge(bridgeUrl, timezone, dataSource);
});
ipcMain.handle('app:generate-insight', (event, snapshot) => {
  assertTrustedRenderer(event);
  return generateInsight(snapshot);
});
ipcMain.handle('app:clear-local-data', (event) => {
  assertTrustedRenderer(event);
  return clearLocalHealthData();
});
ipcMain.on('app:hide', (event) => { assertTrustedRenderer(event); mainWindow?.hide(); });
ipcMain.on('app:quit', (event) => { assertTrustedRenderer(event); quitting = true; app.quit(); });
