import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createImageResolver, real } from '../src/local-files.mjs';

// Layout: <base>/cache (a root), <base>/Documents/{shots,other} outside every root.
const base = real(fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-test-')));
const cache = path.join(base, 'cache');
const shots = path.join(base, 'Documents', 'Claude outputs', 'shots');
const other = path.join(base, 'Documents', 'other');
for (const d of [cache, shots, other]) fs.mkdirSync(d, { recursive: true });
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const write = (f) => { fs.writeFileSync(f, png); return f; };
const referenced = write(path.join(shots, '00 button.png'));
const voice = write(path.join(shots, 'reply.mp3'));
const unreferenced = write(path.join(shots, '01-other.png'));
const secret = write(path.join(other, 'secret.png'));
const cached = write(path.join(cache, 'img.png'));
fs.symlinkSync(secret, path.join(shots, 'link.png'));
fs.writeFileSync(path.join(shots, 'notes.txt'), 'x');
fs.symlinkSync(path.join(shots, 'notes.txt'), path.join(shots, 'notes.png'));

const files = new Set([referenced, voice, path.join(shots, 'notes.txt')]);
const resolve = createImageResolver({ roots: [cache], files });
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

test('referenced MEDIA files are served', () => {
  assert.equal(resolve(referenced)?.type, 'image/png');
  assert.equal(resolve(`file://${encodeURI(referenced)}`)?.file, referenced);
  assert.equal(resolve(voice)?.type, 'audio/mpeg');
});

test('existing roots still work, audio stays limited to MEDIA files', () => {
  assert.equal(resolve(cached)?.file, cached);
  const cachedAudio = path.join(cache, 'a.mp3');
  fs.writeFileSync(cachedAudio, 'x');
  assert.equal(resolve(cachedAudio), null);
});

test('unreferenced files next to or outside the referenced ones are refused', () => {
  assert.equal(resolve(unreferenced), null);
  assert.equal(resolve(secret), null);
});

test('.. and symlink escapes are refused', () => {
  assert.equal(resolve(path.join(shots, '..', '..', 'other', 'secret.png')), null);
  assert.equal(resolve(path.join(shots, 'link.png')), null);
  // A referenced non-media file never becomes readable, not even through an image-named symlink.
  assert.equal(resolve(path.join(shots, 'notes.png')), null);
  assert.equal(resolve(path.join(shots, 'notes.txt')), null);
});

test('MEDIA videos are served up to 500 MB, never from roots', () => {
  const clip = path.join(shots, 'clip.mp4');
  const big = path.join(shots, 'big.mov');
  const huge = path.join(shots, 'huge.webm');
  const longVoice = path.join(shots, 'long.mp3');
  for (const [f, size] of [[clip, 1024], [big, 400 * 1024 * 1024], [huge, 501 * 1024 * 1024], [longVoice, 26 * 1024 * 1024]]) {
    fs.writeFileSync(f, '');
    fs.truncateSync(f, size); // sparse: no real disk use
  }
  const cachedVideo = path.join(cache, 'v.mp4');
  fs.writeFileSync(cachedVideo, 'x');
  const r = createImageResolver({ roots: [cache], files: new Set([clip, big, huge, longVoice, cachedVideo].map(real)) });
  assert.deepEqual([r(clip)?.type, r(clip)?.size], ['video/mp4', 1024]);
  assert.equal(r(big)?.type, 'video/quicktime');
  assert.equal(r(huge), null);
  assert.equal(r(longVoice), null); // audio and images keep the 25 MB cap
  assert.equal(resolve(cachedVideo), null); // a root alone does not make a video readable
  assert.equal(r(cachedVideo)?.type, 'video/mp4');
});
