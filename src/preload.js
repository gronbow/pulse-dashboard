const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulseDesktop', {
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  updateConfig: (config) => ipcRenderer.invoke('app:update-config', config),
  getSnapshot: () => ipcRenderer.invoke('app:get-snapshot'),
  testBridge: (bridgeUrl, timezone, dataSource) => ipcRenderer.invoke('app:test-bridge', bridgeUrl, timezone, dataSource),
  generateInsight: (snapshot) => ipcRenderer.invoke('app:generate-insight', snapshot),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  hide: () => ipcRenderer.send('app:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  onRefresh: (handler) => ipcRenderer.on('dashboard:refresh', handler),
  onOpenSettings: (handler) => ipcRenderer.on('dashboard:open-settings', handler)
});
