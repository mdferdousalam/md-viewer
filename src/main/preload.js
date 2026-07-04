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
  exportDocx: (payload) => ipcRenderer.invoke('file:export-docx', payload),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  pickFolder: () => ipcRenderer.invoke('fs:pick-folder'),
  listDir: (dirPath) => ipcRenderer.invoke('fs:list-dir', dirPath),
  walkWorkspace: (root) => ipcRenderer.invoke('fs:walk-markdown', root),
  createNote: (root, name) => ipcRenderer.invoke('fs:create-note', { root, name }),
  backlinks: (root, targetPath) => ipcRenderer.invoke('fs:backlinks', { root, targetPath }),
  searchWorkspace: (root, query, opts) => ipcRenderer.invoke('fs:search-workspace', { root, query, opts }),
  linkGraph: (root) => ipcRenderer.invoke('fs:link-graph', { root }),
  watchFolder: (root) => ipcRenderer.send('workspace:watch', root),
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
  onWorkspaceChanged: (cb) => subscribe('workspace:changed', cb),
  onMenuNew: (cb) => subscribe('menu:new', cb),
  onMenuCloseTab: (cb) => subscribe('menu:close-tab', cb),
  onMenuSave: (cb) => subscribe('menu:save', cb),
  onMenuSaveAs: (cb) => subscribe('menu:save-as', cb),
  onMenuExportHtml: (cb) => subscribe('menu:export-html', cb),
  onMenuExportDocx: (cb) => subscribe('menu:export-docx', cb),
  onMenuPrint: (cb) => subscribe('menu:print', cb),
  onMenuFormat: (cb) => subscribe('menu:format', cb),
  onMenuViewMode: (cb) => subscribe('menu:view-mode', cb),
  onMenuToggleTheme: (cb) => subscribe('menu:toggle-theme', cb),
  onMenuFind: (cb) => subscribe('menu:find', cb),
  onMenuPalette: (cb) => subscribe('menu:palette', cb),
  onMenuOutline: (cb) => subscribe('menu:outline', cb),
  onMenuZen: (cb) => subscribe('menu:zen', cb),
  onMenuExportPdf: (cb) => subscribe('menu:export-pdf', cb),

  // Close guard: main asks the renderer to save all dirty tabs, then the
  // renderer reports whether it succeeded (false -> abort the close).
  onWindowSaveAll: (cb) => subscribe('window:save-all', cb),
  windowSaveAllDone: (ok) => ipcRenderer.send('window:save-all-done', ok),

  platform: process.platform,
});

function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
