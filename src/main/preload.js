'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Electron 30+ removed File.path; webUtils.getPathForFile is the supported way
// to resolve a dropped file's absolute path.
contextBridge.exposeInMainWorld('electronFilePath', (file) => {
  try {
    return webUtils.getPathForFile(file);
  } catch (_) {
    return null;
  }
});

// A small, explicit surface exposed to the renderer. No raw ipcRenderer,
// no Node APIs leak into the page.
contextBridge.exposeInMainWorld('api', {
  // File operations (renderer -> main, awaited)
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  save: (payload) => ipcRenderer.invoke('file:save', payload),
  exportHtml: (payload) => ipcRenderer.invoke('file:export-html', payload),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  confirmDiscard: () => ipcRenderer.invoke('dialog:confirm-discard'),
  reportDirty: (isDirty) => ipcRenderer.send('doc:dirty-state', isDirty),

  // Events (main -> renderer). Each returns an unsubscribe fn.
  onFileOpened: (cb) => subscribe('file:opened', cb),
  onMenuNew: (cb) => subscribe('menu:new', cb),
  onMenuSave: (cb) => subscribe('menu:save', cb),
  onMenuSaveAs: (cb) => subscribe('menu:save-as', cb),
  onMenuExportHtml: (cb) => subscribe('menu:export-html', cb),
  onMenuFormat: (cb) => subscribe('menu:format', cb),
  onMenuViewMode: (cb) => subscribe('menu:view-mode', cb),
  onMenuToggleTheme: (cb) => subscribe('menu:toggle-theme', cb),
  onMenuFind: (cb) => subscribe('menu:find', cb),
  onMenuPalette: (cb) => subscribe('menu:palette', cb),
  onMenuOutline: (cb) => subscribe('menu:outline', cb),
  onMenuZen: (cb) => subscribe('menu:zen', cb),
  onMenuExportPdf: (cb) => subscribe('menu:export-pdf', cb),

  platform: process.platform,
});

function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
