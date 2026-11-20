const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const { openPath, isArchive, naturalSort, IMAGE_EXTS, ARCHIVE_EXTS } = require('./sources');

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
  // 너비는 화면의 절반, 높이는 화면 전체, 가운데 정렬 (메뉴바·독 제외한 작업 영역 기준)
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.round(area.width / 2);
  win = new BrowserWindow({
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y,
    width,
    height: area.height,
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

/* ---------- 파일명 태그 / 삭제 ---------- */
const TAGS = ['J', 'S', 'SS', 'SSS'];
const TAG_RE = /^\[(?:J|S|SS|SSS)\]\s*/;

// 지금 보고 있는 "파일": 압축 파일이면 압축 파일 자체, 아니면 현재 이미지
function currentFilePath(i) {
  if (!current) return null;
  if (current.archivePath) return current.archivePath;
  if (current.dir && current.pages[i] != null) return path.join(current.dir, current.pages[i]);
  return null;
}

function sendOpened(start, keepCache) {
  win.setTitle(`${current.title} - Comic Viewer`);
  win.webContents.send('opened', { title: current.title, pages: current.pages, start, keepCache });
}

ipcMain.handle('tag-file', async (_e, i, tag) => {
  if (!TAGS.includes(tag)) return;
  const file = currentFilePath(i);
  if (!file) return;
  const base = path.basename(file);
  const newBase = `[${tag}]${base.replace(TAG_RE, '')}`; // 기존 태그는 교체
  if (newBase === base) { win.webContents.send('notice', `이미 [${tag}] 입니다`); return; }
  const target = path.join(path.dirname(file), newBase);
  try {
    await fsp.access(target);
    win.webContents.send('error', `같은 이름의 파일이 이미 있습니다: ${newBase}`);
    return;
  } catch {}
  try {
    await fsp.rename(file, target);
  } catch (e) {
    win.webContents.send('error', `이름 변경 실패: ${e.message}`);
    return;
  }
  if (current.archivePath) {
    current.archivePath = target;
    current.title = newBase;
  } else {
    current.pages[i] = newBase;
  }
  sendOpened(i, true); // 내용은 같으므로 캐시 유지
  win.webContents.send('notice', `→ ${newBase}`);
});

async function nextArchiveAfter(deletedPath) {
  const dir = path.dirname(deletedPath);
  const name = path.basename(deletedPath);
  const list = (await fsp.readdir(dir)).filter((n) => isArchive(n) && !n.startsWith('.')).sort(naturalSort);
  const next = list.find((n) => naturalSort(n, name) > 0) || list[list.length - 1];
  return next ? path.join(dir, next) : null;
}

ipcMain.handle('delete-file', async (_e, i) => {
  const file = currentFilePath(i);
  if (!file) return;
  try {
    await shell.trashItem(file); // 휴지통으로 이동 (확인 없음)
  } catch (e) {
    win.webContents.send('error', `삭제 실패: ${e.message}`);
    return;
  }
  const name = path.basename(file);
  if (current.archivePath) {
    // 압축 파일을 지웠으면 같은 폴더의 다음 압축 파일을 연다
    await current.close();
    current = null;
    const next = await nextArchiveAfter(file);
    if (next) {
      await loadPath(next);
    } else {
      win.setTitle('Comic Viewer');
      win.webContents.send('opened', { title: '', pages: [], start: 0 });
    }
  } else {
    current.pages.splice(i, 1);
    sendOpened(Math.min(i, current.pages.length - 1), false);
  }
  win.webContents.send('notice', `삭제됨: ${name}`);
});

ipcMain.on('quit', () => app.quit());

ipcMain.on('toggle-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

let cleaned = false;
app.on('before-quit', (e) => {
  if (cleaned || !current) return;
  e.preventDefault();
  current.close().finally(() => { cleaned = true; current = null; app.quit(); });
});

app.on('window-all-closed', () => app.quit());
