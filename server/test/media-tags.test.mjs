import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMediaTags, mediaKind } from '../src/media-tags.mjs';

const home = '/Users/max';
const x = (text) => extractMediaTags(text, { home });

test('path with spaces', () => {
  const r = x('Hier der Screenshot:\nMEDIA:/Users/max/Claude outputs/report/screenshots/00 first step.png\nFertig.');
  assert.deepEqual(r.paths, ['/Users/max/Claude outputs/report/screenshots/00 first step.png']);
  assert.equal(r.text, 'Hier der Screenshot:\n\nFertig.');
});

test('several tags, one per line and glued', () => {
  const r = x('Zwei Bilder:\nMEDIA:/tmp/a.png\nMEDIA:/tmp/b c.jpg\nMEDIA:/tmp/d.pngMEDIA:/tmp/e.webp');
  assert.deepEqual(r.paths, ['/tmp/a.png', '/tmp/b c.jpg', '/tmp/d.png', '/tmp/e.webp']);
  assert.equal(r.text, 'Zwei Bilder:');
});

test('tags in fenced code, inline code and quotes are ignored', () => {
  const text = 'So sieht ein Tag aus:\n```\nMEDIA:/tmp/example.png\n```\nInline `MEDIA:/tmp/inline.png` auch.\n> MEDIA:/tmp/quoted.png';
  const r = x(text);
  assert.deepEqual(r.paths, []);
  assert.equal(r.text, text);
});

test('~/ expands to home', () => {
  assert.deepEqual(x('MEDIA:~/Pictures/shot.png').paths, ['/Users/max/Pictures/shot.png']);
});

test('punctuation, quotes and emphasis around the tag', () => {
  assert.deepEqual(x('Siehe MEDIA:/tmp/a.png.').paths, ['/tmp/a.png']);
  assert.deepEqual(x('(MEDIA:/tmp/b.png), danach').paths, ['/tmp/b.png']);
  assert.deepEqual(x('**MEDIA:/tmp/c.png**').paths, ['/tmp/c.png']);
  assert.deepEqual(x('MEDIA:`/tmp/d e.png`').paths, ['/tmp/d e.png']);
  assert.deepEqual(x('MEDIA:"/tmp/f.pdf"').paths, ['/tmp/f.pdf']);
  assert.deepEqual(x('MEDIA:/tmp/archive.tar.gz').paths, ['/tmp/archive.tar.gz']);
  assert.equal(x('Siehe MEDIA:/tmp/a.png.').text, 'Siehe');
});

test('duplicates are listed once', () => {
  const r = x('MEDIA:/tmp/a.png\nNochmal: MEDIA:/tmp/a.png\nMEDIA:~/a.png\nMEDIA:/Users/max/a.png');
  assert.deepEqual(r.paths, ['/tmp/a.png', '/Users/max/a.png']);
});

test('no tag, relative path or unknown extension leaves the text alone', () => {
  for (const text of ['Nur Text', 'MEDIA:./rel.png', 'MEDIA:/tmp/script.py']) {
    assert.deepEqual(x(text), { text, paths: [] });
  }
});

test('mediaKind', () => {
  assert.equal(mediaKind('/a/b.PNG'), 'image');
  assert.equal(mediaKind('/a/b.m4a'), 'audio');
  assert.equal(mediaKind('/a/b.pdf'), 'file');
  assert.equal(mediaKind('/a/b.svg'), 'file');
});
