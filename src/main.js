const { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { normalizeSnapshot } = require('./snapshot');
const { createDataSourceAdapter } = require('./adapters/data-source-adapter');
const { CODEX_HANDOFF_PORT, CODEX_HANDOFF_URL, createCodexHandoffServer } = require('../bridge/codex-handoff-server');

const DEFAULT_CONFIG = {
  dataSource: 'demo',
  bridgeUrl: '',
  refreshIntervalMinutes: 5,
  alwaysOnTop: true,
  compactMode: false,
  theme: 'dark',
  opacity: 96,
  launchAtLogin: false,
  timezone: 'Asia/Shanghai'
};

let mainWindow;
let tray;
let quitting = false;
let codexHandoffServer;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function snapshotCachePath() {
  return path.join(app.getPath('userData'), 'snapshot-cache.json');
}

function readConfig() {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(configPath(), 'utf8')));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function normalizeConfig(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const refreshIntervalMinutes = Number(raw.refreshIntervalMinutes);
  const opacity = Number(raw.opacity);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    dataSource: ['demo', 'bridge', 'codex'].includes(raw.dataSource) ? raw.dataSource : DEFAULT_CONFIG.dataSource,
    bridgeUrl: String(raw.bridgeUrl || '').trim().replace(/\/$/, ''),
    refreshIntervalMinutes: [1, 5, 15, 30, 60].includes(refreshIntervalMinutes) ? refreshIntervalMinutes : DEFAULT_CONFIG.refreshIntervalMinutes,
    alwaysOnTop: raw.alwaysOnTop == null ? DEFAULT_CONFIG.alwaysOnTop : Boolean(raw.alwaysOnTop),
    compactMode: raw.compactMode == null ? DEFAULT_CONFIG.compactMode : Boolean(raw.compactMode),
    launchAtLogin: raw.launchAtLogin == null ? DEFAULT_CONFIG.launchAtLogin : Boolean(raw.launchAtLogin),
    theme: ['dark', 'light', 'system'].includes(raw.theme) ? raw.theme : DEFAULT_CONFIG.theme,
    opacity: Number.isFinite(opacity) ? Math.max(40, Math.min(100, opacity)) : DEFAULT_CONFIG.opacity,
    timezone: String(raw.timezone || DEFAULT_CONFIG.timezone)
  };
}

function writeConfig(next) {
  const safe = normalizeConfig(next);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}

function readSnapshotCache() {
  try {
    return JSON.parse(fs.readFileSync(snapshotCachePath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeSnapshotCache(snapshot) {
  fs.mkdirSync(path.dirname(snapshotCachePath()), { recursive: true });
  fs.writeFileSync(snapshotCachePath(), JSON.stringify(snapshot, null, 2), 'utf8');
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
  if (!payload || typeof payload !== 'object' || (!payload.health && !Array.isArray(payload.todayActivities))) {
    throw new Error('桥接返回缺少 health 或 todayActivities 字段');
  }
  return normalizeSnapshot(payload, metaOverrides);
}

function resolveBridgeUrl(config) {
  if (config.dataSource === 'codex') return CODEX_HANDOFF_URL;
  return config.bridgeUrl;
}

function createHttpBridgeAdapter(config) {
  const bridgeUrl = resolveBridgeUrl(config);
  const provider = config.dataSource === 'codex' ? 'codex-coros-mcp' : 'mcp-bridge';
  return createDataSourceAdapter({
    id: config.dataSource === 'codex' ? 'codex-handoff' : 'http-bridge',
    label: config.dataSource === 'codex' ? 'Codex Handoff' : 'HTTP Bridge',
    provider,
    fetchSnapshot: () => requestJson(`${bridgeUrl}/api/snapshot?timezone=${encodeURIComponent(config.timezone)}`),
    generateInsight: (snapshot) => requestJson(`${bridgeUrl}/api/insight`, { method: 'POST', body: { snapshot } })
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
    writeSnapshotCache(snapshot);
    return snapshot;
  } catch (error) {
    const provider = config.dataSource === 'codex' ? 'codex-coros-mcp' : 'mcp-bridge';
    const cached = readSnapshotCache();
    if (cached) {
      return normalizeSnapshot(cached, { source: 'cache', provider, error: error.message });
    }
    return normalizeSnapshot(fallback, { source: 'demo', provider, error: error.message });
  }
}

function applyWindowConfig(config) {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(Boolean(config.alwaysOnTop));
  mainWindow.setOpacity(Math.max(0.1, Math.min(1, Number(config.opacity || 100) / 100)));
  if (app.isPackaged && typeof app.setLoginItemSettings === 'function') {
    app.setLoginItemSettings({ openAtLogin: config.launchAtLogin, args: ['--hidden'] });
  }
}

async function testBridge(bridgeUrl, timezone, dataSource) {
  const config = normalizeConfig({ bridgeUrl, timezone, dataSource });
  if (config.dataSource === 'demo') return { ok: false, message: '演示数据不需要测试连接' };
  if (config.dataSource === 'bridge' && !config.bridgeUrl) return { ok: false, message: '请先填写桥接地址' };
  const adapter = createHttpBridgeAdapter(config);
  const snapshot = normalizeBridgeSnapshot(await adapter.fetchSnapshot(), { source: 'bridge', provider: adapter.provider });
  return {
    ok: true,
    message: `连接成功：${snapshot.todayActivities.length} 条今日活动数据`,
    snapshotVersion: snapshot.version
  };
}

async function generateInsight(snapshot) {
  const config = readConfig();
  const safeSnapshot = normalizeSnapshot(snapshot);
  if (config.dataSource !== 'demo' && resolveBridgeUrl(config)) {
    try {
      const result = await createHttpBridgeAdapter(config).generateInsight(safeSnapshot);
      if (result && result.text) return { text: result.text, source: 'bridge' };
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
  if (brandPixels < width * height * 0.001) {
    throw new Error('dashboard brand area was not painted in the captured frame');
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
}

function createWindow() {
  const config = readConfig();
  const startHidden = process.argv.includes('--hidden');
  const smokeOutput = smokeScreenshotPath();
  mainWindow = new BrowserWindow({
    width: 430,
    height: 820,
    minWidth: 360,
    minHeight: 580,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: config.alwaysOnTop,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  applyWindowConfig(config);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
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
  });
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const traySvg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#b7f34a"/><path d="M9 24V8h7c4.3 0 7 2.2 7 5.8s-2.7 5.7-7 5.7h-3V24H9zm4-8h2.8c1.9 0 3.2-.7 3.2-2.2s-1.3-2.2-3.2-2.2H13V16z" fill="#11170d"/></svg>';
  const trayIcon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(traySvg).toString('base64')}`);
  tray = new Tray(trayIcon);
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏看板', click: () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show() },
    { label: '立即刷新', click: () => mainWindow.webContents.send('dashboard:refresh') },
    { label: '打开设置', click: () => { mainWindow.show(); mainWindow.webContents.send('dashboard:open-settings'); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Pulse 健康与训练看板');
  tray.setContextMenu(menu);
  tray.on('double-click', () => mainWindow.show());
}

function startCodexHandoffBridge() {
  if (codexHandoffServer) return;
  codexHandoffServer = createCodexHandoffServer();
  codexHandoffServer.on('snapshot-updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dashboard:refresh');
    }
  });
  codexHandoffServer.on('error', (error) => {
    console.error(`Pulse Codex handoff bridge (${CODEX_HANDOFF_PORT}) unavailable: ${error.message}`);
  });
  codexHandoffServer.listen(CODEX_HANDOFF_PORT, '127.0.0.1');
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
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    startCodexHandoffBridge();
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

ipcMain.handle('app:get-config', () => readConfig());
ipcMain.handle('app:update-config', (_event, next) => {
  const config = writeConfig(next || {});
  applyWindowConfig(config);
  return config;
});
ipcMain.handle('app:get-snapshot', () => loadSnapshot());
ipcMain.handle('app:test-bridge', (_event, bridgeUrl, timezone, dataSource) => testBridge(bridgeUrl, timezone, dataSource));
ipcMain.handle('app:generate-insight', (_event, snapshot) => generateInsight(snapshot));
ipcMain.handle('app:open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});
ipcMain.on('app:hide', () => mainWindow?.hide());
ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
