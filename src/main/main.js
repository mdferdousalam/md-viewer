'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';

/** Files queued from the OS (double-click / "open with") before a window exists. */
let pendingOpenPath = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
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
    if (pendingOpenPath) {
      openPathInWindow(win, pendingOpenPath);
      pendingOpenPath = null;
    }
  });

  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

function readFileSafe(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return { filePath, content };
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
    const filePath = firstMarkdownArg(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (filePath) openPathInWindow(mainWindow, filePath);
    }
  });

  app.whenReady().then(() => {
    const argPath = firstMarkdownArg(process.argv);
    if (argPath) pendingOpenPath = argPath;

    buildMenu();
    mainWindow = createWindow();
    setupAutoUpdate();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
