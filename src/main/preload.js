/* Copyright (c) 2026 Ferdous. All Rights Reserved.
   Unauthorized use, copying, modification, or distribution of this source is
   prohibited. See LICENSE. */
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
  exportPdf: (payload) => ipcRenderer.invoke('file:export-pdf', payload),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  confirmDiscard: () => ipcRenderer.invoke('dialog:confirm-discard'),
  confirmReload: () => ipcRenderer.invoke('dialog:confirm-reload'),
  reportDirty: (isDirty) => ipcRenderer.send('doc:dirty-state', isDirty),
  // Tell main the full set of open files to watch for external changes (one per tab).
  setWatchedPaths: (paths) => ipcRenderer.send('doc:set-watched-paths', paths),
  // Persist the open-tabs snapshot for session restore.
  saveSession: (snapshot) => ipcRenderer.send('session:tabs', snapshot),

  // Generic request bridge: main asks the renderer to run an op and awaits the
  // result. Renderer subscribes with onApiRequest and replies via sendApiResponse.
  onApiRequest: (cb) => subscribe('api:request', cb),
  sendApiResponse: (payload) => ipcRenderer.send('api:response', payload),
  // Fire a document event for the control API's event stream (opened/saved/changed).
  emitEvent: (type, payload) => ipcRenderer.send('doc:event', { type, payload }),

  // Events (main -> renderer). Each returns an unsubscribe fn.
  onFileOpened: (cb) => subscribe('file:opened', cb),
  onExternalChange: (cb) => subscribe('file:external-change', cb),
  onSessionRestore: (cb) => subscribe('session:restore', cb),
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
