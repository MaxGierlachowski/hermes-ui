// MEDIA:<path> tags in assistant replies: Hermes turns them into native attachments on Slack & co.
// and strips them from the text. Same grammar as Hermes (gateway/platforms/base.py,
// MEDIA_TAG_CLEANUP_RE + extract_media): optional quotes/backticks/emphasis around the tag, an
// absolute or ~/ path that may contain spaces and ends at a known extension before a boundary.
// Tags inside fenced code, inline code and blockquotes are examples, not attachments.

import os from 'node:os';
import path from 'node:path';

export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
export const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.opus', '.flac']);
export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);

// Hermes' MEDIA_DELIVERY_EXTS (+ avif, which this UI shows inline).
const EXTS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'tiff', 'svg',
  'mp4', 'mov', 'avi', 'mkv', 'webm', '3gp',
  'mp3', 'm2a', 'wav', 'ogg', 'opus', 'm4a', 'flac',
  'pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'epub',
  'xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml',
  'kmz', 'kml', 'geojson', 'gpx',
  'pptx', 'ppt', 'odp', 'key',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'apk', 'ipa',
  'html', 'htm',
].sort((a, b) => b.length - a.length).join('|');
const CJK = '（）〈〉《》：，。；！？、\u201c\u201d\u2018\u2019【】';
const BOUNDARY = `[\\s\`"'*_,;:)\\]}\\[${CJK}]`;

export const MEDIA_TAG_RE = new RegExp(
  '[`"\'*_]{0,3}MEDIA:\\s*'
  + '(?<path>`[^`\\n]+?`|"[^"\\n]+?"|\'[^\'\\n]+?\'|'
  + `(?:~/|/)\\S+?(?:[^\\S\\n]+\\S+?)*?\\.(?:${EXTS}))`
  + `(?:(?=${BOUNDARY}|MEDIA:|\\.(?:\\s|$)|$)[\`"'*_]{0,3}\\.?|(?:\\\\[nrt])+(?=${BOUNDARY}|MEDIA:|$))`,
  'gi',
);

const FENCED_CODE_RE = /```[^\n]*\n[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const QUOTE_RE = /^>.*$/gm;

/** Blank code and quotes (offset-preserving) so tags inside them are never matched. */
function mask(text) {
  const spans = [...text.matchAll(FENCED_CODE_RE)].map((m) => [m.index, m.index + m[0].length]);
  for (const m of text.matchAll(INLINE_CODE_RE)) {
    // `…` right after "MEDIA:" quotes the path; it is part of the tag, not inline code.
    if (/MEDIA:\s*$/i.test(text.slice(Math.max(0, m.index - 20), m.index))) continue;
    spans.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(QUOTE_RE)) spans.push([m.index, m.index + m[0].length]);
  let out = text;
  for (const [s, e] of spans) out = out.slice(0, s) + out.slice(s, e).replace(/[^\n]/g, ' ') + out.slice(e);
  return out;
}

function normalize(raw, home) {
  let p = String(raw || '').trim();
  if (p.length >= 2 && p[0] === p.at(-1) && '`"\''.includes(p[0])) p = p.slice(1, -1).trim();
  p = p.replace(/^[`"']+/, '').replace(/[`"',.;:)}\]]+$/, '');
  if (p.startsWith('~/')) p = path.join(home, p.slice(2));
  return p;
}

/** MEDIA path → kind for the UI. */
export function mediaKind(file) {
  const ext = path.extname(file).toLowerCase();
  return IMAGE_EXTS.has(ext) ? 'image' : AUDIO_EXTS.has(ext) ? 'audio' : VIDEO_EXTS.has(ext) ? 'video' : 'file';
}

/**
 * Pull MEDIA tags out of an assistant reply.
 * @returns {{ text: string, paths: string[] }} text without the tags, unique expanded paths in order.
 */
export function extractMediaTags(text, { home = os.homedir() } = {}) {
  const src = String(text ?? '');
  if (!/MEDIA:/i.test(src)) return { text: src, paths: [] };
  const paths = [];
  const spans = [];
  for (const m of mask(src).matchAll(MEDIA_TAG_RE)) {
    spans.push([m.index, m.index + m[0].length]);
    const p = normalize(m.groups.path, home);
    if (p && !p.includes('\0') && !paths.includes(p)) paths.push(p);
  }
  if (!spans.length) return { text: src, paths };
  let out = '';
  let at = 0;
  for (const [s, e] of spans) { out += src.slice(at, s); at = e; }
  out += src.slice(at);
  return { text: out.replace(/\n{3,}/g, '\n\n').trim(), paths };
}
