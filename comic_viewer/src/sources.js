// 이미지 소스(압축 파일 / 디렉토리) 로딩 모듈
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.svg']);
const ARCHIVE_EXTS = new Set(['.zip', '.cbz', '.7z', '.cb7', '.rar', '.cbr']);

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
};

const isImage = (p) => IMAGE_EXTS.has(path.extname(p).toLowerCase());
const isArchive = (p) => ARCHIVE_EXTS.has(path.extname(p).toLowerCase());
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const naturalSort = (a, b) => collator.compare(a, b);

// 압축 내부 경로 중 숨김/메타 파일 제외 (__MACOSX, ._xxx 등)
function isJunk(entryPath) {
  const parts = entryPath.split(/[\\/]/);
  return parts.some((p) => p === '__MACOSX' || p.startsWith('.'));
}

/* ---------- 디렉토리 ---------- */
class DirectorySource {
  constructor(dir, files, title) {
    this.dir = dir;
    this.pages = files; // 파일명 목록
    this.title = title;
  }
  static async open(dir, title = dir) {
    const names = (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isFile() && isImage(d.name) && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort(naturalSort);
    return new DirectorySource(dir, names, title);
  }
  async read(i) {
    const name = this.pages[i];
    return { data: await fsp.readFile(path.join(this.dir, name)), mime: mimeOf(name), name };
  }
  async close() {}
}

/* ---------- 임시 디렉토리로 전부 풀어서 보는 소스 (7z / rar) ---------- */
class ExtractedSource {
  constructor(tmpDir, files, title) {
    this.tmpDir = tmpDir;
    this.pages = files; // tmpDir 기준 상대 경로
    this.title = title;
  }
  async read(i) {
    const rel = this.pages[i];
    return { data: await fsp.readFile(path.join(this.tmpDir, rel)), mime: mimeOf(rel), name: rel };
  }
  async close() {
    await fsp.rm(this.tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function walkImages(root) {
  const out = [];
  async function walk(rel) {
    const entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true });
    for (const e of entries) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (isJunk(r)) continue;
      if (e.isDirectory()) await walk(r);
      else if (e.isFile() && isImage(e.name)) out.push(r);
    }
  }
  await walk('');
  return out.sort(naturalSort);
}

const makeTmp = () => fsp.mkdtemp(path.join(os.tmpdir(), 'comic-viewer-'));

function get7zaPath() {
  // 패키징 시 asar 밖으로 빠진 바이너리를 사용
  const p = require('7zip-bin').path7za.replace('app.asar', 'app.asar.unpacked');
  try {
    fs.accessSync(p, fs.constants.X_OK);
  } catch {
    try { fs.chmodSync(p, 0o755); } catch {}
  }
  return p;
}

async function open7z(file) {
  const tmp = await makeTmp();
  try {
    await new Promise((resolve, reject) => {
      execFile(get7zaPath(), ['x', file, `-o${tmp}`, '-y', '-bd', '-p-'], { maxBuffer: 64 * 1024 * 1024 },
        (err, _stdout, stderr) => (err ? reject(new Error(`7z 압축 해제 실패: ${stderr || err.message}`)) : resolve()));
    });
    return new ExtractedSource(tmp, await walkImages(tmp), path.basename(file));
  } catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

async function openRar(file) {
  const { createExtractorFromFile } = require('node-unrar-js');
  const tmp = await makeTmp();
  try {
    const extractor = await createExtractorFromFile({
      filepath: file,
      targetPath: tmp,
      // 경로 탈출(../) 방지
      filenameTransform: (name) =>
        name.split(/[\\/]/).filter((p) => p && p !== '.' && p !== '..').join(path.sep),
    });
    const { files } = extractor.extract({
      files: (h) => !h.flags.directory && isImage(h.name) && !isJunk(h.name),
    });
    for (const _ of files); // 제너레이터를 소진해야 실제로 압축이 풀림
    return new ExtractedSource(tmp, await walkImages(tmp), path.basename(file));
  } catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw new Error(`RAR 압축 해제 실패: ${e.message}`);
  }
}

/* ---------- ZIP (메모리에서 필요한 엔트리만 읽음) ---------- */
class ZipSource {
  constructor(zip, entries, title) {
    this.zip = zip;
    this.entries = entries;
    this.pages = entries.map((e) => e.entryName);
    this.title = title;
  }
  static async open(file) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(file);
    const entries = zip
      .getEntries()
      .filter((e) => !e.isDirectory && isImage(e.entryName) && !isJunk(e.entryName))
      .sort((a, b) => naturalSort(a.entryName, b.entryName));
    return new ZipSource(zip, entries, path.basename(file));
  }
  async read(i) {
    const e = this.entries[i];
    const data = await new Promise((resolve, reject) =>
      e.getDataAsync((buf, err) => (err ? reject(new Error(err)) : resolve(buf))));
    return { data, mime: mimeOf(e.entryName), name: e.entryName };
  }
  async close() {}
}

/**
 * 경로를 받아 소스와 시작 페이지를 돌려준다.
 * - 압축 파일: 해당 압축 파일 내부 이미지, 0페이지부터
 * - 이미지 파일: 같은 디렉토리 내 이미지, 해당 파일부터
 * - 디렉토리: 디렉토리 내 이미지, 0페이지부터
 */
async function openPath(target) {
  const r = await openPathInner(target);
  // 압축 파일이면 원본 경로를 기억 (이름 변경 / 삭제 대상)
  if (isArchive(target) && !r.source.dir) r.source.archivePath = target;
  return r;
}

async function openPathInner(target) {
  const stat = await fsp.stat(target);
  if (stat.isDirectory()) {
    return { source: await DirectorySource.open(target, path.basename(target)), start: 0 };
  }
  const ext = path.extname(target).toLowerCase();
  if (ext === '.zip' || ext === '.cbz') return { source: await ZipSource.open(target), start: 0 };
  if (ext === '.7z' || ext === '.cb7') return { source: await open7z(target), start: 0 };
  if (ext === '.rar' || ext === '.cbr') return { source: await openRar(target), start: 0 };
  if (isImage(target)) {
    const dir = path.dirname(target);
    const source = await DirectorySource.open(dir, path.basename(dir));
    const start = Math.max(0, source.pages.indexOf(path.basename(target)));
    return { source, start };
  }
  throw new Error(`지원하지 않는 파일 형식입니다: ${path.basename(target)}`);
}

module.exports = { openPath, isImage, isArchive, naturalSort, IMAGE_EXTS, ARCHIVE_EXTS };
