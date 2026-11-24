// Which local files a chat may open (file chips, MEDIA attachments of any type, preview, download).
// Rules (docs/security.md "Files in chats"):
//
//   1. The chat itself mentions the file: a MEDIA:<path> tag, or a path / file:// URL in its transcript
//      (shared/file-refs.ts). server.mjs checks that per session; this module checks the file.
//   2. The real path (symlinks and ".." resolved) is a regular file below an allowed root (default: the
//      home directory) and no directory or file on the way below that root is hidden (".name"). Files
//      attached with MEDIA:<path> are allowed outside the roots too (Hermes chose to send them).
//   3. The denylist wins over both: keys, certificates, .env files, SSH/GPG/cloud credentials, the
//      Keychain, app databases, and names with secret / token / credential / password in them.
//   4. Size limits: previews up to `maxPreviewBytes`, text previews read at most `maxTextBytes`,
//      downloads up to `maxDownloadBytes`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { previewKind } from '../../shared/file-refs.ts';

const MB = 1024 * 1024;

// Directories never served, wherever they are (matched as path segments, case-insensitive).
const DENY_DIRS = ['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.password-store', '.1password', 'keychains'];
// File names never served.
const DENY_NAMES = [
  /^\.env(\..*)?$/i, /^\.envrc$/i, /\.env$/i,
  /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|csr|kdbx|gpg|asc|ovpn|mobileprovision)$/i,
  /^id_[a-z0-9_-]+(\.pub)?$/i,
  /^\.?(netrc|npmrc|pypirc|pgpass|git-credentials|htpasswd|my\.cnf)$/i,
  /secret|token|credential|passw(or)?d|private[-_]?key/i,
];
// App databases: SQLite and friends inside app data (Library, AppData, hidden directories).
const DB_FILE = /\.(sqlite3?|db|db-wal|db-shm|sqlite-wal|sqlite-shm|ldb|realm)$/i;
const APP_DATA = /(^|\/)(Library|AppData|Application Support)(\/|$)|(^|\/)\.[^/]+\//;

/** Why a real path is refused (a short reason for logs and tests), or null if the denylist lets it pass. */
export function denied(file) {
  const segs = file.split(path.sep).filter(Boolean);
  const name = segs.at(-1) || '';
  const lower = segs.map((s) => s.toLowerCase());
  for (const d of DENY_DIRS) if (lower.slice(0, -1).includes(d)) return `directory ${d}`;
  if (lower.includes('library') && lower[lower.indexOf('library') + 1] === 'keychains') return 'keychain';
  for (const re of DENY_NAMES) if (re.test(name)) return 'name';
  if (DB_FILE.test(name) && APP_DATA.test(file)) return 'app database';
  return null;
}

// Served inline only as these types; everything else is text (JSON endpoint) or a download.
const INLINE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
};
const OTHER_TYPES = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.json': 'application/json',
  '.html': 'text/html', '.htm': 'text/html', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.gz': 'application/gzip', '.tgz': 'application/gzip',
};

/** The type a file is described with (UI only; what is served is decided by inlineType). */
export const mimeOf = (file) => {
  const ext = path.extname(file).toLowerCase();
  return INLINE_TYPES[ext] || OTHER_TYPES[ext] || (previewKind(file) === 'text' ? 'text/plain' : 'application/octet-stream');
};
/** Content-Type for an inline (preview) response, or null: only images (not SVG), audio, video, PDF. */
export const inlineType = (file) => INLINE_TYPES[path.extname(file).toLowerCase()] || null;

const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

/**
 * @param {object} o
 * @param {string[]} [o.roots]          allowed directories (default: the home directory)
 * @param {string}   [o.home]           what ~/ means
 * @param {number}   [o.maxPreviewBytes]
 * @param {number}   [o.maxDownloadBytes]
 * @param {number}   [o.maxTextBytes]
 */
export function createFileAccess({ roots, home = os.homedir(), maxPreviewBytes = 25 * MB, maxDownloadBytes = 200 * MB, maxTextBytes = 1 * MB } = {}) {
  const rootList = roots?.length ? roots : [home];

  /** A key as written (~/…, /…, file://…) → absolute path (not resolved), or null. */
  const expand = (key) => {
    let p = String(key || '').trim();
    if (p.startsWith('file:')) { try { p = decodeURIComponent(new URL(p).pathname); } catch { return null; } }
    if (p.startsWith('~/')) p = path.join(home, p.slice(2));
    if (!path.isAbsolute(p) || p.includes('\0')) return null;
    return path.normalize(p);
  };

  const underRoot = (file) => {
    for (const r of rootList.map(real).filter(Boolean)) {
      if (!file.startsWith(r + path.sep)) continue;
      // Nothing hidden on the way down from the root (~/.config, ~/project/.git/…, ~/.zshrc).
      if (file.slice(r.length + 1).split(path.sep).some((s) => s.startsWith('.'))) continue;
      return true;
    }
    return false;
  };

  /**
   * Checks a referenced file. `explicit`: attached with MEDIA:<path> (allowed outside the roots).
   * @returns {{ file: string, path: string, name: string, size: number, mtimeMs: number, mime: string } | null}
   */
  function resolve(key, { explicit = false } = {}) {
    const abs = expand(key);
    if (!abs) return null;
    const file = real(abs);
    if (!file) return null;
    if (denied(file) || denied(abs)) return null;
    if (!explicit && !underRoot(file)) return null;
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    if (!st.isFile()) return null;
    return { file, path: abs, name: path.basename(abs), size: st.size, mtimeMs: st.mtimeMs, mime: mimeOf(file) };
  }

  /** Can the preview show it from the backend (inline response or text JSON) within the limits? */
  function previewable(f) {
    const kind = previewKind(f.file);
    if (kind === 'video') return !!inlineType(f.file) && f.size <= maxDownloadBytes;
    if (inlineType(f.file)) return f.size <= maxPreviewBytes;
    return ['text', 'markdown', 'csv'].includes(kind); // text previews are cut at maxTextBytes
  }

  /** First maxTextBytes as UTF-8; binary content (NUL bytes) is refused. */
  function readText(f) {
    const n = Math.min(f.size, maxTextBytes);
    const buf = Buffer.alloc(n);
    const fd = fs.openSync(f.file, 'r');
    try { fs.readSync(fd, buf, 0, n, 0); } finally { fs.closeSync(fd); }
    if (buf.subarray(0, 8192).includes(0)) return { binary: true, size: f.size };
    let text = buf.toString('utf8');
    // A cut in the middle of a multi-byte character leaves a replacement character at the end.
    if (f.size > n) text = text.replace(/\uFFFD$/, '');
    return { text, truncated: f.size > n, size: f.size };
  }

  return { resolve, expand, previewable, readText, limits: { maxPreviewBytes, maxDownloadBytes, maxTextBytes } };
}

/** Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266). */
export function attachmentHeader(name) {
  const ascii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
