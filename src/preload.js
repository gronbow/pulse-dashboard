const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, handler) {
  if (typeof handler !== 'function') throw new TypeError('Pulse event handler must be a function');
  const listener = () => handler();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('pulseDesktop', {
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  updateConfig: (config) => ipcRenderer.invoke('app:update-config', config),
  getSnapshot: () => ipcRenderer.invoke('app:get-snapshot'),
  testBridge: (bridgeUrl, timezone, dataSource) => ipcRenderer.invoke('app:test-bridge', bridgeUrl, timezone, dataSource),
  generateInsight: (snapshot) => ipcRenderer.invoke('app:generate-insight', snapshot),
  clearLocalData: () => ipcRenderer.invoke('app:clear-local-data'),
  hide: () => ipcRenderer.send('app:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  onRefresh: (handler) => subscribe('dashboard:refresh', handler),
  onOpenSettings: (handler) => subscribe('dashboard:open-settings', handler)
});
