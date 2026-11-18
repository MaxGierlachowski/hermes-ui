// Read-only access to local image files that transcripts reference by path (file:///…, /Users/…).
// Only image types, only below allowed roots, checked on the real path (symlinks and ".." resolved).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
const MAX_BYTES = 25 * 1024 * 1024;

const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

/**
 * @param {object} o
 * @param {string[]} o.roots        directories whose whole subtree is allowed
 * @param {string[]} o.tempPrefixes directory names directly below the temp dir that are allowed (e.g. "paseo-attachments-")
 */
export function createImageResolver({ roots = [], tempPrefixes = [] }) {
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
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!type || !allowed(file)) return null;
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
