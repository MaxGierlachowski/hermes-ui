// Read-only access to local image files that transcripts reference by path (file:///…, /home/…).
// Only image types, only below allowed roots, checked on the real path (symlinks and ".." resolved).
// Plus exactly the files assistant replies attached with MEDIA:<path> (images, audio and video, any directory).
// sendFile() streams them with HTTP Range support (Safari/iOS only play video from 206 responses; seeking).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
export const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac' };
export const VIDEO_TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // streamed in ranges, never read into memory

export const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

/**
 * @param {object} o
 * @param {string[]} o.roots        directories whose whole subtree is allowed
 * @param {string[]} o.tempPrefixes directory names directly below the temp dir that are allowed (e.g. "paseo-attachments-")
 * @param {Set<string>} [o.files]   real paths allowed one by one (MEDIA attachments); images, audio and video
 */
export function createImageResolver({ roots = [], tempPrefixes = [], files = new Set() }) {
  const tempDirs = [...new Set([os.tmpdir(), '/tmp'].map(real).filter(Boolean))];
  const allowed = (file) => {
    // Roots are resolved per call: they may appear after start (e.g. a new Paseo temp dir).
    for (const r of roots.map(real).filter(Boolean)) if (file.startsWith(r + path.sep)) return true;
    for (const t of tempDirs) {
      if (!file.startsWith(t + path.sep)) continue;
      const first = file.slice(t.length + 1).split(path.sep)[0];
      if (tempPrefixes.some((pre) => first.startsWith(pre))) return true;
    }
    return false;
  };

  /** Returns { file, type, size, mtimeMs } for an allowed file, otherwise null. */
  return function resolveImage(raw) {
    let p = String(raw || '').trim();
    if (p.startsWith('file:')) { try { p = fileURLToPath(p); } catch { return null; } }
    if (!path.isAbsolute(p) || p.includes('\0')) return null;
    const file = real(p);
    if (!file) return null;
    const ext = path.extname(file).toLowerCase();
    const type = files.has(file) ? IMAGE_TYPES[ext] || AUDIO_TYPES[ext] || VIDEO_TYPES[ext] : allowed(file) && IMAGE_TYPES[ext];
    if (!type) return null;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > (type.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_BYTES)) return null;
    return { file, type, size: st.size, mtimeMs: st.mtimeMs };
  };
}

/**
 * One "bytes=" range of a Range header → { start, end } (inclusive), 'unsatisfiable', or null to send
 * the whole file (no header, a malformed one, or several ranges, which a server may answer with 200).
 */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start; let end;
  if (!m[1]) { // suffix: the last n bytes
    const n = Number(m[2]);
    if (!n) return 'unsatisfiable';
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (m[2] && Number(m[2]) < start) return null;
  }
  return start >= size ? 'unsatisfiable' : { start, end };
}

/**
 * Streams a resolved file (GET/HEAD) with Range support: 206 + Content-Range for one range, 416 for an
 * unsatisfiable one, 200 otherwise. If-Range with a stale validator gets the whole (new) file.
 */
export function sendFile(req, res, { file, type, size, mtimeMs = 0 }, headers = {}) {
  const etag = `"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;
  const lastModified = new Date(mtimeMs).toUTCString();
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', ETag: etag, 'Last-Modified': lastModified, ...headers };
  const ifRange = req.headers['if-range'];
  const fresh = !ifRange || ifRange === etag || ifRange === lastModified;
  const range = fresh ? parseRange(req.headers.range, size) : null;
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
    return res.end();
  }
  const { start, end } = range || { start: 0, end: size - 1 };
  res.writeHead(range ? 206 : 200, { ...base, 'Content-Length': size ? end - start + 1 : 0, ...(range && { 'Content-Range': `bytes ${start}-${end}/${size}` }) });
  if (req.method === 'HEAD' || !size) return res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  return stream.pipe(res);
}

/** Local path or file:// URL → backend URL that serves it (null for anything else). */
export function localImageUrl(src) {
  if (typeof src !== 'string') return null;
  if (src.startsWith('file:') || (src.startsWith('/') && !src.startsWith('/api/') && !src.startsWith('//'))) return `/api/file?path=${encodeURIComponent(src)}`;
  return null;
}
