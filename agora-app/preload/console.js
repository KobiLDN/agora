// Preload for the console UI — exposes a minimal, typed bridge API to the
// renderer. The renderer never touches Node/Electron directly.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agora', {
  getState: () => ipcRenderer.invoke('console:getState'),
  onState: (cb) => ipcRenderer.on('state', (e, state) => cb(state)),
  onSiteStatus: (cb) => ipcRenderer.on('siteStatus', (e, status) => cb(status)),
  toggleBridge: () => ipcRenderer.send('console:toggleBridge'),
  interject: (message, target) => ipcRenderer.send('console:interject', { message, target }),
  forwardLast: (from) => ipcRenderer.invoke('console:forwardLast', from),
  shareLog: (target) => ipcRenderer.invoke('console:shareLog', target),
  setSettings: (settings) => ipcRenderer.send('console:setSettings', settings),
  clearLog: () => ipcRenderer.send('console:clearLog'),
  reloadSite: (name) => ipcRenderer.send('console:reloadSite', name),
  devtoolsSite: (name) => ipcRenderer.send('console:devtoolsSite', name),
  debugSnapshot: () => ipcRenderer.invoke('console:debugSnapshot')
});
