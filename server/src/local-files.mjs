// Read-only access to local image files that transcripts reference by path (file:///…, /Users/…).
// Only image types, only below allowed roots, checked on the real path (symlinks and ".." resolved).
// Plus exactly the files assistant replies attached with MEDIA:<path> (images and audio, any directory).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
export const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac' };
const MAX_BYTES = 25 * 1024 * 1024;

export const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

/**
 * @param {object} o
 * @param {string[]} o.roots        directories whose whole subtree is allowed
 * @param {string[]} o.tempPrefixes directory names directly below the temp dir that are allowed (e.g. "paseo-attachments-")
 * @param {Set<string>} [o.files]   real paths allowed one by one (MEDIA attachments); images and audio
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

  /** Returns { file, type, size } for an allowed image, otherwise null. */
  return function resolveImage(raw) {
    let p = String(raw || '').trim();
    if (p.startsWith('file:')) { try { p = fileURLToPath(p); } catch { return null; } }
    if (!path.isAbsolute(p) || p.includes('\0')) return null;
    const file = real(p);
    if (!file) return null;
    const ext = path.extname(file).toLowerCase();
    const type = files.has(file) ? IMAGE_TYPES[ext] || AUDIO_TYPES[ext] : allowed(file) && IMAGE_TYPES[ext];
    if (!type) return null;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return { file, type, size: st.size };
  };
}

/** Local path or file:// URL → backend URL that serves it (null for anything else). */
export function localImageUrl(src) {
  if (typeof src !== 'string') return null;
  if (src.startsWith('file:') || (src.startsWith('/') && !src.startsWith('/api/') && !src.startsWith('//'))) return `/api/file?path=${encodeURIComponent(src)}`;
  return null;
}
