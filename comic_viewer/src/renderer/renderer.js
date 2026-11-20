const img = document.getElementById('page');
const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');

const FIT_MODES = [
  ['fit-screen', '화면에 맞춤'],
  ['fit-width', '너비에 맞춤'],
  ['original', '원본 크기'],
];
let fitIndex = 0;

let pages = [];
let index = 0;
let title = '';
let generation = 0; // 새 파일을 열 때마다 증가 → 이전 요청 결과 무시
const cache = new Map(); // index -> Promise<blobURL>
const PRELOAD = 2;

function toast(msg, isError = false, ms = 1800) {
  toastEl.textContent = msg;
  toastEl.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toast.t);
  if (ms) toast.t = setTimeout(() => (toastEl.className = ''), ms);
}

function showStatus() {
  if (!pages.length) return;
  statusEl.textContent = `${title}  ·  ${index + 1} / ${pages.length}  ·  ${pages[index]}`;
  statusEl.classList.add('show');
  clearTimeout(showStatus.t);
  showStatus.t = setTimeout(() => statusEl.classList.remove('show'), 1500);
}

function getUrl(i) {
  if (!cache.has(i)) {
    const gen = generation;
    const p = window.viewer.readPage(i).then((r) => {
      if (!r || gen !== generation) return null;
      return URL.createObjectURL(new Blob([r.data], { type: r.mime }));
    });
    p.catch(() => cache.delete(i));
    cache.set(i, p);
  }
  return cache.get(i);
}

function pruneCache() {
  for (const [i, p] of cache) {
    if (i < index - PRELOAD || i > index + PRELOAD) {
      cache.delete(i);
      p.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
    }
  }
}

function clearCache() {
  for (const p of cache.values()) p.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
  cache.clear();
}

function updateTitle() {
  document.title = pages.length
    ? `${title} (${index + 1} / ${pages.length}) - Comic Viewer`
    : 'Comic Viewer';
}

async function render() {
  const i = index;
  const gen = generation;
  updateTitle();
  try {
    const url = await getUrl(i);
    if (gen !== generation || i !== index || !url) return;
    img.src = url;
    stage.scrollTo(0, 0);
  } catch (e) {
    if (i === index) toast(`이미지를 읽지 못했습니다: ${e.message}`, true);
  }
  showStatus();
  pruneCache();
  for (let d = 1; d <= PRELOAD; d++) {
    if (index + d < pages.length) getUrl(index + d);
    if (index - d >= 0) getUrl(index - d);
  }
}

function go(to) {
  if (!pages.length) return;
  const next = Math.max(0, Math.min(pages.length - 1, to));
  if (next === index) {
    toast(to > index ? '마지막 페이지입니다' : '첫 페이지입니다', false, 1000);
    return;
  }
  index = next;
  render();
}

window.viewer.on('loading', (name) => toast(`여는 중… ${name}`, false, 0));

window.viewer.on('error', (msg) => toast(msg, true, 4000));

window.viewer.on('notice', (msg) => toast(msg, false, 2000));

window.viewer.on('opened', (info) => {
  if (!info.keepCache) {
    generation++;
    clearCache();
  }
  pages = info.pages;
  title = info.title;
  index = info.start;
  toastEl.className = '';
  if (!pages.length) {
    document.body.classList.remove('has-pages');
    img.removeAttribute('src');
    updateTitle();
    toast('이미지가 없습니다', true, 3000);
    return;
  }
  document.body.classList.add('has-pages');
  render();
});

// Alt 조합: 파일명 태그 / 삭제 (맥에서 Alt+문자는 특수문자가 되므로 e.code로 판별)
const TAG_KEYS = {
  'KeyA:': 'J', // Alt+A
  'KeyS:': 'S', // Alt+S
  'KeyS:shift': 'SS', // Alt+Shift+S
  'KeyS:ctrl+shift': 'SSS', // Alt+Ctrl+Shift+S
};
let busy = false;

async function fileAction(fn) {
  if (busy || !pages.length) return;
  busy = true;
  try { await fn(); } finally { busy = false; }
}

function handleAltKey(e) {
  if (e.metaKey) return false;
  const mods = [e.ctrlKey && 'ctrl', e.shiftKey && 'shift'].filter(Boolean).join('+');
  const combo = `${e.code}:${mods}`;
  if (TAG_KEYS[combo]) {
    if (!e.repeat) fileAction(() => window.viewer.tagFile(index, TAG_KEYS[combo]));
    return true;
  }
  if (combo === 'KeyD:shift') { // Alt+Shift+D: 확인 없이 삭제
    if (!e.repeat) fileAction(() => window.viewer.deleteFile(index));
    return true;
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  if (e.altKey) {
    if (handleAltKey(e)) e.preventDefault();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  switch (e.key) {
    case ' ':
      go(index + (e.shiftKey ? -1 : 1));
      break;
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      go(index + 1);
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
    case 'Backspace':
      go(index - 1);
      break;
    case 'Home':
      go(0);
      break;
    case 'End':
      go(pages.length - 1);
      break;
    case 'f':
    case 'F':
    case 'Enter':
      window.viewer.toggleFullscreen();
      break;
    case 'Escape':
      window.viewer.quit();
      break;
    case 'o':
    case 'O':
      window.viewer.openDialog();
      break;
    case 'w':
    case 'W':
      stage.classList.remove(FIT_MODES[fitIndex][0]);
      fitIndex = (fitIndex + 1) % FIT_MODES.length;
      stage.classList.add(FIT_MODES[fitIndex][0]);
      toast(FIT_MODES[fitIndex][1], false, 1000);
      break;
    default:
      return;
  }
  e.preventDefault();
});

// 마우스: 왼쪽 절반 클릭 = 이전, 오른쪽 절반 = 다음
stage.addEventListener('click', (e) => {
  go(index + (e.clientX < window.innerWidth / 2 ? -1 : 1));
});

// 드래그 앤 드롭
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragover'); });
document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) document.body.classList.remove('dragover');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) window.viewer.openFile(file);
});
