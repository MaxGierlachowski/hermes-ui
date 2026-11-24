// Files a chat mentions (shared/file-refs.ts): what counts as a reference, what never does, and how
// confirmed references become file links for the Markdown renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeLanguage, fileKey, fileRefKeys, findFileRefs, formatBytes, linkFileRefs, parseCsv, previewKind } from '../../shared/file-refs.ts';

const keys = (text) => findFileRefs(text).map((r) => [r.via, r.key]);

test('paths in prose, inline code, Markdown links and file:// URLs', () => {
  assert.deepEqual(keys('Saved to /Users/me/site/README.md.'), [['path', '/Users/me/site/README.md']]);
  assert.deepEqual(keys('See `~/notes/plan.txt` first'), [['code', '~/notes/plan.txt']]);
  assert.deepEqual(keys('Open [the report](/Users/me/Reports/q3.pdf)'), [['link', '/Users/me/Reports/q3.pdf']]);
  assert.deepEqual(keys('Open [it](<~/My Docs/q3 final.pdf>)'), [['link', '~/My Docs/q3 final.pdf']]);
  assert.deepEqual(keys('[x](file:///Users/me/a%20b.csv)'), [['link', '/Users/me/a b.csv']]);
  assert.deepEqual(keys('here: file:///Users/me/My%20Docs/a.csv, done'), [['url', '/Users/me/My Docs/a.csv']]);
  assert.deepEqual(keys('(/home/me/out/chart.png)'), [['path', '/home/me/out/chart.png']]);
  assert.deepEqual(keys('Pfad /Users/me/Übersicht.md:12 ok'), [['path', '/Users/me/Übersicht.md']]);
  assert.deepEqual(keys('in `/Users/me/src/app.ts:42:7`'), [['code', '/Users/me/src/app.ts']]);
  // Inline code may name files without an extension.
  assert.deepEqual(keys('`/Users/me/site/Makefile`'), [['code', '/Users/me/site/Makefile']]);
});

test('no false positives: routes, URLs, relative paths, commands, code blocks, MEDIA tags', () => {
  assert.deepEqual(keys('call /api/sessions or GET /api/sessions/abc/messages'), []);
  assert.deepEqual(keys('see https://example.com/docs/guide.pdf and //cdn.example.com/a.js'), []);
  assert.deepEqual(keys('edit src/app.ts and and/or.txt'), []);
  assert.deepEqual(keys('run `npm run build` or `rm -rf /tmp/x.txt` or `cat /a/b.txt | wc`'), []);
  assert.deepEqual(keys('`ls /Users/me/*.md`'), []);
  assert.deepEqual(keys('```bash\ncat /Users/me/notes/a.txt\n```\n'), []);
  assert.deepEqual(keys('~~~\n/Users/me/notes/a.txt\n~~~'), []);
  assert.deepEqual(keys('MEDIA:/Users/me/out/report.pdf'), []);
  assert.deepEqual(keys('a directory /Users/me/Projects/ and /x.txt and /tmp'), []);
  assert.deepEqual(keys('[docs](https://example.com/a.md) [rel](./a.md)'), []);
  assert.deepEqual(keys('../../etc/passwd and /Users/me/../../etc/passwd.txt'), []);
});

test('fileKey: normalises and rejects', () => {
  assert.equal(fileKey('file:///Users/me/a%C3%BC.txt'), '/Users/me/aü.txt');
  assert.equal(fileKey('file://localhost/Users/me/a.txt'), '/Users/me/a.txt');
  assert.equal(fileKey('/Users/me/a.txt:10'), '/Users/me/a.txt');
  assert.equal(fileKey('~/a.txt'), '~/a.txt');
  assert.equal(fileKey('~/'), null);
  assert.equal(fileKey('/a.txt'), null);
  assert.equal(fileKey('//host/a.txt'), null);
  assert.equal(fileKey('/Users/me/dir/'), null);
  assert.equal(fileKey('file://host/a/b.txt'), null);
});

test('fileRefKeys: unique, in order, capped', () => {
  assert.deepEqual(fileRefKeys('/Users/a/x.md and `/Users/a/x.md` and /Users/a/y.md'), ['/Users/a/x.md', '/Users/a/y.md']);
  const many = Array.from({ length: 80 }, (_, i) => `/Users/a/f${i}.txt`).join(' ');
  assert.equal(findFileRefs(many).length, 50);
});

test('linkFileRefs: only confirmed references become links; labels are escaped', () => {
  const text = 'Wrote `/Users/me/a_b.md`, see [the *plan*](~/notes/plan.txt) and /Users/me/missing.txt.';
  assert.equal(
    linkFileRefs(text, ['/Users/me/a_b.md', '~/notes/plan.txt']),
    'Wrote [a\\_b.md](hermes-file:0), see [the \\*plan\\*](hermes-file:1) and /Users/me/missing.txt.',
  );
  assert.equal(linkFileRefs(text, []), text);
  // Code blocks stay untouched even when the same path is confirmed elsewhere.
  const block = '```\n/Users/me/a.md\n```\n/Users/me/a.md';
  assert.equal(linkFileRefs(block, ['/Users/me/a.md']), '```\n/Users/me/a.md\n```\n[a.md](hermes-file:0)');
});

test('previewKind / codeLanguage: by extension; HTML and SVG are text, never rendered', () => {
  assert.equal(previewKind('/a/b.PNG'), 'image');
  assert.equal(previewKind('/a/b.pdf'), 'pdf');
  assert.equal(previewKind('/a/b.md'), 'markdown');
  assert.equal(previewKind('/a/b.tsv'), 'csv');
  assert.equal(previewKind('/a/page.html'), 'text');
  assert.equal(previewKind('/a/logo.svg'), 'text');
  assert.equal(previewKind('/a/Dockerfile'), 'text');
  assert.equal(previewKind('/a/b.mov'), 'video');
  assert.equal(previewKind('/a/archive.zip'), 'other');
  assert.equal(codeLanguage('/a/b.tsx'), 'tsx');
  assert.equal(codeLanguage('/a/b.unknown'), undefined);
});

test('parseCsv: quotes, separators, ragged input', () => {
  assert.deepEqual(parseCsv('a,b\n1,"x, ""y"""\n')?.rows, [['a', 'b'], ['1', 'x, "y"']]);
  assert.deepEqual(parseCsv('a;b;c\n1;2;3')?.rows, [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2', { tab: true })?.rows, [['a', 'b'], ['1', '2']]);
  assert.equal(parseCsv('just one column\nmore'), null);
  assert.equal(parseCsv('a,b\n1,2,3'), null);
  const big = parseCsv(`a,b\n${'1,2\n'.repeat(20)}`, { maxRows: 5 });
  assert.equal(big?.rows.length, 5);
  assert.equal(big?.more, true);
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(25 * 1024 * 1024), '25 MB');
});
