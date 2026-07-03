/* Copyright (c) 2026 Ferdous. All Rights Reserved.
   Unauthorized use, copying, modification, or distribution of this source is
   prohibited. See LICENSE. */
'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { parseCli } = require('./cli');
const { startApiServer } = require('./api-server');

const isMac = process.platform === 'darwin';

/** Files queued from the OS (double-click / "open with") before a window exists. */
let pendingOpenPath = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** Local control-API server handle (only when launched with --serve / MDV_API). */
let apiServer = null;

function createWindow(bounds) {
  const win = new BrowserWindow({
    ...(bounds && Number.isFinite(bounds.width)
      ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      : { width: 1200, height: 800 }),
    minWidth: 640,
    minHeight: 480,
    title: 'Markdown Viewer',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    // Restore the previous session's tabs and/or open a launch file — sent as
    // one ordered message so a launch file opens on top of the restored tabs
    // (avoids a race between async restore and the file open).
    const session = readSession();
    const restore = session && session.tabs && session.tabs.length ? session : null;
    if (restore || pendingOpenPath) {
      if (pendingOpenPath) app.addRecentDocument(pendingOpenPath);
      win.webContents.send('session:restore', { session: restore, openAfter: pendingOpenPath || null });
      pendingOpenPath = null;
    }
  });

  win.on('resize', scheduleSessionWrite);
  win.on('move', scheduleSessionWrite);
  win.on('close', persistSession);

  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.on('closed', () => stopWatchingAll(win));

  return win;
}

function readFileSafe(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return { filePath, content };
}

// ---- Session persistence (reopen tabs + window bounds on relaunch) -------
// Stored as a single JSON file in userData (same pattern as api.json). The
// renderer owns the tab list; the main process owns the window bounds.
const sessionFile = () => path.join(app.getPath('userData'), 'session.json');
let rendererTabs = null; // latest {tabs, activeIndex} snapshot from the renderer
let sessionTimer = null;

function readSession() {
  try { return JSON.parse(fs.readFileSync(sessionFile(), 'utf8')); } catch (_) { return null; }
}
function persistSession() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const data = { windowBounds: mainWindow.getBounds(), ...(rendererTabs || {}) };
  try {
    const tmp = sessionFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, sessionFile());
  } catch (_) { /* best-effort */ }
}
function scheduleSessionWrite() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(persistSession, 400);
}

function openPathInWindow(win, filePath) {
  try {
    const { content } = readFileSafe(filePath);
    win.webContents.send('file:opened', { filePath, content });
    app.addRecentDocument(filePath);
  } catch (err) {
    dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
  }
}

// ---- Live reload: watch the active document for external changes ---------
// Any program (an editor, a script, an LLM agent) that rewrites the open file
// on disk triggers a push to the renderer, which reloads it live. `watchFile`
// polling is used because it survives the write-temp-then-rename that many
// tools (and atomic savers) use, which `fs.watch` misses.

// `win.__watch` is a Map<path, listener> so every open tab's file is watched
// (a background tab's file can change on disk too), not just the active one.
function stopWatchingAll(win) {
  if (!win.__watch) return;
  for (const [p, l] of win.__watch) fs.unwatchFile(p, l);
  win.__watch = null;
}

// Reconcile the watched set to exactly `paths` (the open tabs' file paths).
function setWatchedPaths(win, paths) {
  const desired = new Set((paths || []).filter(Boolean));
  if (!win.__watch) win.__watch = new Map();
  for (const [p, l] of [...win.__watch]) {
    if (!desired.has(p)) { fs.unwatchFile(p, l); win.__watch.delete(p); }
  }
  for (const p of desired) {
    if (win.__watch.has(p)) continue;
    const listener = (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return; // touch without content change
      if (win.isDestroyed()) { fs.unwatchFile(p, listener); return; }
      let content;
      try { ({ content } = readFileSafe(p)); }
      catch (_) { return; } // removed/renamed mid-write — ignore this tick
      win.webContents.send('file:external-change', { filePath: p, content });
    };
    fs.watchFile(p, { interval: 300 }, listener);
    win.__watch.set(p, listener);
  }
}

async function handleOpenDialog(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open Markdown File',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!canceled && filePaths.length > 0) {
    openPathInWindow(win, filePaths[0]);
  }
}

/**
 * Save handler used by both "Save" and "Save As".
 * @returns {Promise<{filePath: string} | null>}
 */
async function saveContent(win, { filePath, content, forceDialog }) {
  let target = filePath;
  if (!target || forceDialog) {
    const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
      title: 'Save Markdown File',
      defaultPath: target || 'untitled.md',
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (canceled || !chosen) return null;
    target = chosen;
  }
  fs.writeFileSync(target, content, 'utf8');
  app.addRecentDocument(target);
  return { filePath: target };
}

async function exportHtml(win, { html, title }) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export as HTML',
    defaultPath: (title || 'export') + '.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, html, 'utf8');
  return { filePath };
}

// ---- Renderer request bridge --------------------------------------------
// A generic request/response channel so the main process (CLI, HTTP API) can
// ask the renderer to perform an operation and await a typed result. The
// renderer implements the ops (see API_OPS in renderer.js); we correlate
// replies by id. This is the shared spine reused by headless export and the
// (future) local control API.

let __reqId = 0;
const __pending = new Map();

ipcMain.on('api:response', (_e, { id, result, error }) => {
  const p = __pending.get(id);
  if (!p) return;
  __pending.delete(id);
  clearTimeout(p.timer);
  if (error) p.reject(new Error(error));
  else p.resolve(result);
});

function rendererRequest(win, op, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++__reqId;
    const timer = setTimeout(() => {
      __pending.delete(id);
      reject(new Error(`renderer op '${op}' timed out`));
    }, timeoutMs);
    __pending.set(id, { resolve, reject, timer });
    win.webContents.send('api:request', { id, op, args });
  });
}

// Render standalone HTML to a PDF buffer by loading it into a throwaway hidden
// window and using Chromium's print-to-PDF (clean, content-only, includes
// rendered diagrams + math). Replaces the old window.print() path.
async function htmlToPdf(html, existingWin) {
  const tmp = path.join(os.tmpdir(), `mdv-export-${process.pid}-${__reqId}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  // Reuse the caller's window when given (headless export) to avoid spawning a
  // second renderer process; otherwise make a throwaway one (GUI export).
  const win = existingWin || new BrowserWindow({
    show: false,
    webPreferences: { sandbox: false, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  try {
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 200)); // let fonts/SVG settle
    return await win.webContents.printToPDF({ printBackground: true });
  } finally {
    if (!existingWin) win.destroy();
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

// ---- Menu ---------------------------------------------------------------

function sendToFocused(channel, payload) {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win) win.webContents.send(channel, payload);
}

function buildMenu() {
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToFocused('menu:new'),
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: (_i, win) => handleOpenDialog(win || mainWindow),
        },
        {
          role: 'recentDocuments',
          submenu: [{ role: 'clearRecentDocuments' }],
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToFocused('menu:save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendToFocused('menu:save-as'),
        },
        { type: 'separator' },
        {
          label: 'Export as HTML…',
          click: () => sendToFocused('menu:export-html'),
        },
        {
          label: 'Export as PDF…',
          click: () => sendToFocused('menu:export-pdf'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find & Replace…',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendToFocused('menu:find'),
        },
        { type: 'separator' },
        {
          label: 'Bold',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendToFocused('menu:format', 'bold'),
        },
        {
          label: 'Italic',
          accelerator: 'CmdOrCtrl+I',
          click: () => sendToFocused('menu:format', 'italic'),
        },
        {
          label: 'Insert Link',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendToFocused('menu:format', 'link'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette…',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendToFocused('menu:palette'),
        },
        { type: 'separator' },
        {
          label: 'Editor Only',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendToFocused('menu:view-mode', 'editor'),
        },
        {
          label: 'Split',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendToFocused('menu:view-mode', 'split'),
        },
        {
          label: 'Preview Only',
          accelerator: 'CmdOrCtrl+3',
          click: () => sendToFocused('menu:view-mode', 'preview'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Outline',
          accelerator: 'CmdOrCtrl+\\',
          click: () => sendToFocused('menu:outline'),
        },
        {
          label: 'Focus Mode',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => sendToFocused('menu:zen'),
        },
        {
          label: 'Cycle Theme (Dark / Light / Sepia)',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => sendToFocused('menu:toggle-theme'),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Markdown Guide',
          click: () => shell.openExternal('https://www.markdownguide.org/basic-syntax/'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC ----------------------------------------------------------------

ipcMain.handle('dialog:open', (e) => {
  return handleOpenDialog(BrowserWindow.fromWebContents(e.sender));
});

ipcMain.handle('file:save', (e, payload) => {
  return saveContent(BrowserWindow.fromWebContents(e.sender), payload);
});

ipcMain.handle('file:export-html', (e, payload) => {
  return exportHtml(BrowserWindow.fromWebContents(e.sender), payload);
});

ipcMain.handle('file:export-pdf', async (e, { html, title }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export as PDF',
    defaultPath: (title || 'export') + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  try {
    fs.writeFileSync(filePath, await htmlToPdf(html));
    return { filePath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('file:read', (e, filePath) => {
  try {
    return readFileSafe(filePath);
  } catch (err) {
    return { error: err.message };
  }
});

// Renderer reports whether the current doc has unsaved changes so we can
// prompt before the window/app closes.
ipcMain.on('doc:dirty-state', (e, isDirty) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.__isDirty = isDirty;
});

ipcMain.handle('dialog:confirm-discard', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: 'Do you want to save the changes you made?',
    detail: "Your changes will be lost if you don't save them.",
  });
  return ['save', 'discard', 'cancel'][response];
});

// Document events forwarded to the control-API event stream (no-op if off).
ipcMain.on('doc:event', (_e, evt) => {
  if (apiServer) apiServer.broadcast(evt);
});

// Renderer tells us the full set of open files to watch for external changes
// (one per tab). We reconcile the watcher set to match.
ipcMain.on('doc:set-watched-paths', (e, paths) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) setWatchedPaths(win, paths);
});

// Renderer pushes its tab snapshot; merged with window bounds and persisted.
ipcMain.on('session:tabs', (_e, snapshot) => { rendererTabs = snapshot; scheduleSessionWrite(); });

// Asked when the file changed on disk while the user has unsaved edits.
ipcMain.handle('dialog:confirm-reload', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Reload', 'Keep My Changes'],
    defaultId: 0,
    cancelId: 1,
    message: 'This file changed on disk',
    detail: 'Reload it and lose your unsaved changes, or keep what you have?',
  });
  return response === 0; // true = reload from disk
});

// ---- Auto update --------------------------------------------------------

// Checks GitHub Releases (see build.publish in package.json) for a newer
// version, downloads it in the background, and offers to restart & install.
function setupAutoUpdate() {
  // Only meaningful in a packaged build.
  if (!app.isPackaged) return;
  // macOS auto-update requires code signing (Squirrel.Mac rejects unsigned
  // updates). Skip while unsigned so Mac users don't get a confusing error;
  // they update by re-downloading the .dmg until a signing cert is added.
  if (isMac) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (_) {
    return; // dependency missing — never crash the app over updates
  }

  autoUpdater.autoDownload = true;

  autoUpdater.on('error', (err) => {
    // Non-fatal: log and move on (e.g. offline, no release yet).
    console.error('[updater]', err == null ? 'unknown error' : (err.stack || err).toString());
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: 'A new version is ready',
      detail: `Version ${info.version} has been downloaded. Restart to install it.`,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] check failed:', err && err.message);
  });
}

// ---- App lifecycle ------------------------------------------------------

// File opened from OS on Windows/Linux via argv.
function firstMarkdownArg(argv) {
  return argv.slice(1).find((a) => /\.(md|markdown|mdown|mkd|txt)$/i.test(a) && fs.existsSync(a));
}

// Enable the opt-in local control API with `--serve [port]`, or MDV_API=1
// (optional MDV_API_PORT). Off by default.
function serveConfig(argv) {
  const idx = argv.indexOf('--serve');
  const envOn = !!process.env.MDV_API && process.env.MDV_API !== '0';
  if (idx === -1 && !envOn) return { enabled: false, port: 0 };
  let port = 0;
  if (idx !== -1 && argv[idx + 1] && /^\d+$/.test(argv[idx + 1])) port = parseInt(argv[idx + 1], 10);
  else if (process.env.MDV_API_PORT && /^\d+$/.test(process.env.MDV_API_PORT)) port = parseInt(process.env.MDV_API_PORT, 10);
  return { enabled: true, port };
}

function startServer(serve) {
  if (apiServer || !serve.enabled) return;
  apiServer = startApiServer({
    port: serve.port,
    version: app.getVersion(),
    userDataDir: app.getPath('userData'),
    getWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    rendererRequest,
    htmlToPdf,
    openPath: openPathInWindow,
  });
}

// ---- Headless mode (CLI export/render, no visible window) ---------------

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function performHeadless(cli) {
  const { command, out } = cli;
  const to = cli.to;

  let content;
  let srcPath = cli.file;
  if (cli.file === '-' || (!cli.file && command === 'render')) {
    content = await readStdin();
    srcPath = null;
  } else if (cli.file) {
    content = fs.readFileSync(cli.file, 'utf8');
  } else {
    throw new Error(`${command}: missing input file`);
  }

  if (command === 'export' && to !== 'pdf' && to !== 'html') {
    throw new Error("export: --to must be 'pdf' or 'html'");
  }
  if (command === 'render' && to !== 'html') {
    throw new Error('render: only --to html is supported');
  }

  // Render in a hidden app window so the full pipeline (incl. Mermaid + KaTeX)
  // produces the standalone HTML, then export.
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    const html = await rendererRequest(win, 'renderForExport', content);

    if (command === 'render') {
      if (out) { fs.writeFileSync(out, html); process.stdout.write(`Wrote ${out}\n`); }
      else process.stdout.write(html);
      return 0;
    }

    const base = srcPath ? srcPath.replace(/\.[^.]+$/, '') : 'export';
    if (to === 'html') {
      const target = out || `${base}.html`;
      fs.writeFileSync(target, html);
      process.stdout.write(`Exported ${target}\n`);
    } else {
      const target = out || `${base}.pdf`;
      fs.writeFileSync(target, await htmlToPdf(html, win)); // reuse this window
      process.stdout.write(`Exported ${target}\n`);
    }
    return 0;
  } finally {
    win.destroy();
  }
}

// The argv needed to relaunch THIS app with the control API enabled — passed to
// the MCP server so its auto-launch works in both packaged and dev contexts.
function serveLaunchArgv() {
  return app.isPackaged
    ? [process.execPath, '--serve']
    : [process.execPath, app.getAppPath(), '--serve'];
}

// `md-viewer mcp`: run the bundled MCP stdio server as a plain Node process
// (ELECTRON_RUN_AS_NODE) so its JSON-RPC stdio is clean — no Chromium, no window.
function runMcp() {
  const server = app.isPackaged
    ? path.join(process.resourcesPath, 'mcp-server.cjs')
    : path.join(__dirname, '..', '..', 'mcp', 'dist', 'server.cjs');
  const child = require('child_process').spawn(process.execPath, [server], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MDV_SERVE_ARGV: JSON.stringify(serveLaunchArgv()) },
  });
  child.on('exit', (code) => process.exit(code == null ? 0 : code));
  child.on('error', (err) => { process.stderr.write(`md-viewer mcp: ${err.message}\n`); process.exit(1); });
}

function runHeadless(cli) {
  app.whenReady().then(async () => {
    if (isMac && app.dock) app.dock.hide();
    let code = 0;
    try {
      code = await performHeadless(cli);
    } catch (err) {
      process.stderr.write(`md-viewer: ${err && err.message ? err.message : err}\n`);
      code = 1;
    }
    app.exit(code);
  });
}

// ---- Dispatch: headless CLI vs. the interactive GUI ---------------------

const cli = parseCli(process.argv, app.isPackaged);

if (cli && cli.command === 'mcp') {
  runMcp();
} else if (cli && cli.headless) {
  runHeadless(cli);
} else {
  // macOS: file opened via Finder / "open with".
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      openPathInWindow(mainWindow, filePath);
    } else {
      pendingOpenPath = filePath;
    }
  });

  // Single-instance: focus existing window & open the file passed on 2nd launch.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', (_e, argv) => {
      // A `md-viewer --serve` relaunch (e.g. the MCP server auto-starting us)
      // should bring the control API up even if this instance opened without it.
      if (argv.includes('--serve')) startServer(serveConfig(argv));
      const filePath = firstMarkdownArg(argv);
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        if (filePath) openPathInWindow(mainWindow, filePath);
      }
    });

    app.whenReady().then(() => {
      const argPath = (cli && cli.file && fs.existsSync(cli.file) ? cli.file : null) || firstMarkdownArg(process.argv);
      if (argPath) pendingOpenPath = argPath;

      buildMenu();
      mainWindow = createWindow((readSession() || {}).windowBounds);
      setupAutoUpdate();

      startServer(serveConfig(process.argv));

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createWindow((readSession() || {}).windowBounds);
        }
      });
    });

    app.on('will-quit', () => {
      if (apiServer) { apiServer.close(); apiServer = null; }
    });

    app.on('window-all-closed', () => {
      if (!isMac) app.quit();
    });
  }
}
