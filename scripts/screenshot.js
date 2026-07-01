// Dev-only: render the renderer offscreen and save a PNG via capturePage().
// Usage: electron scripts/screenshot.js [outfile] [theme] [viewmode]
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const out = process.argv[2] || '/tmp/shot.png';
const theme = process.argv[3] || '';
const view = process.argv[4] || '';

// Minimal stubs so the renderer's preload IPC calls resolve.
ipcMain.handle('dialog:open', () => null);
ipcMain.handle('file:save', () => null);
ipcMain.handle('file:export-html', () => null);
ipcMain.handle('file:read', () => ({ error: 'n/a' }));
ipcMain.handle('dialog:confirm-discard', () => 'discard');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src/main/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message);
  });

  await win.loadFile(path.join(ROOT, 'src/renderer/index.html'));

  if (theme) await win.webContents.executeJavaScript(
    `document.documentElement.setAttribute('data-theme','${theme}');`
  );
  if (view) await win.webContents.executeJavaScript(
    `document.querySelector('.seg-btn[data-view="${view}"]').click();`
  );
  const js = process.argv[5];
  if (js) await win.webContents.executeJavaScript(js);

  await new Promise((r) => setTimeout(r, 3500)); // let mermaid/katex settle
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('WROTE', out);
  app.quit();
});
