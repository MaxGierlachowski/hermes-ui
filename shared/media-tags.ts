// Hides MEDIA:<path> tags while a reply streams in. The grammar mirrors src/media-tags.mjs (and Hermes'
// MEDIA_TAG_CLEANUP_RE); the finished message comes from the backend with the tags already turned into
// attachments.

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
].sort((a, b) => b.length - a.length).join('|')
const BOUNDARY = '[\\s`"\'*_,;:)\\]}\\[（）〈〉《》：，。；！？、\u201c\u201d\u2018\u2019【】]'
const MEDIA_TAG_RE = new RegExp(
  '[`"\'*_]{0,3}MEDIA:\\s*'
  + '(?:`[^`\\n]+?`|"[^"\\n]+?"|\'[^\'\\n]+?\'|'
  + `(?:~/|/)\\S+?(?:[^\\S\\n]+\\S+?)*?\\.(?:${EXTS}))`
  + `(?:(?=${BOUNDARY}|MEDIA:|\\.(?:\\s|$)|$)[\`"'*_]{0,3}\\.?|(?:\\\\[nrt])+(?=${BOUNDARY}|MEDIA:|$))`,
  'gi',
)

/** Text without MEDIA tags; tags inside code and blockquotes stay. A tag still arriving at the end is hidden too. */
export function stripMediaTags(text: string) {
  if (!/MEDIA:/i.test(text)) return text
  const spans: [number, number][] = [...text.matchAll(/```[^\n]*\n[\s\S]*?```/g)].map((m) => [m.index, m.index + m[0].length])
  for (const m of text.matchAll(/`[^`\n]+`/g)) {
    if (!/MEDIA:\s*$/i.test(text.slice(Math.max(0, m.index - 20), m.index))) spans.push([m.index, m.index + m[0].length])
  }
  for (const m of text.matchAll(/^>.*$/gm)) spans.push([m.index, m.index + m[0].length])
  const masked = spans.reduce((s, [a, b]) => s.slice(0, a) + s.slice(a, b).replace(/[^\n]/g, ' ') + s.slice(b), text)
  let out = ''
  let at = 0
  for (const m of masked.matchAll(MEDIA_TAG_RE)) { out += text.slice(at, m.index); at = m.index + m[0].length }
  return (out + text.slice(at)).replace(/[`"'*_]{0,3}MEDIA:[^\n]*$/i, '').replace(/\n{3,}/g, '\n\n')
}
