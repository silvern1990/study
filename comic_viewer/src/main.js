const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { openPath, IMAGE_EXTS, ARCHIVE_EXTS } = require('./sources');

let win = null;
let current = null; // 현재 열린 소스
let pendingPath = null; // 창이 준비되기 전에 요청된 경로 (macOS open-file, 명령행 인자)

function pathFromArgv(argv) {
  // 개발 모드: electron . <file>, 패키징: app <file>
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.find((a) => !a.startsWith('-')) || null;
}

async function loadPath(p) {
  if (!win) { pendingPath = p; return; }
  win.webContents.send('loading', path.basename(p));
  try {
    const { source, start } = await openPath(path.resolve(p));
    if (current) await current.close();
    current = source;
    win.setTitle(`${source.title} - Comic Viewer`);
    win.webContents.send('opened', { title: source.title, pages: source.pages, start });
  } catch (e) {
    win.webContents.send('error', e.message);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 1200,
    backgroundColor: '#111111',
    title: 'Comic Viewer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    if (pendingPath) { const p = pendingPath; pendingPath = null; loadPath(p); }
  });
  win.on('closed', () => { win = null; });
}

// 이미 실행 중이면 기존 창에서 열기
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const p = pathFromArgv(argv);
    if (p) loadPath(p);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  // macOS: Finder에서 "다음으로 열기" / 독 아이콘에 드롭
  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (win && !win.webContents.isLoading()) loadPath(p);
    else pendingPath = p;
  });

  app.whenReady().then(() => {
    pendingPath = pendingPath || pathFromArgv(process.argv);
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });
}

ipcMain.handle('read-page', async (_e, i) => {
  if (!current || i < 0 || i >= current.pages.length) return null;
  return current.read(i);
});

ipcMain.handle('open-dialog', async () => {
  const exts = [...ARCHIVE_EXTS, ...IMAGE_EXTS].map((e) => e.slice(1));
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: '이미지 / 압축 파일', extensions: exts }, { name: '모든 파일', extensions: ['*'] }],
  });
  if (!r.canceled && r.filePaths[0]) loadPath(r.filePaths[0]);
});

ipcMain.on('open-path', (_e, p) => { if (p) loadPath(p); });

ipcMain.on('toggle-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

let cleaned = false;
app.on('before-quit', (e) => {
  if (cleaned || !current) return;
  e.preventDefault();
  current.close().finally(() => { cleaned = true; current = null; app.quit(); });
});

app.on('window-all-closed', () => app.quit());
