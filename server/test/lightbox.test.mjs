// The app's image viewer: size of the image on screen and what its error state shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitImage, imageLabel } from '../../app/src/lib/lightbox.ts';

test('fitImage: fits the box at the aspect ratio, never upscales, box until the size is known', () => {
  assert.deepEqual(fitImage({ width: 880, height: 520 }, { width: 1392, height: 780 }), { width: 880, height: 520 });
  assert.deepEqual(fitImage({ width: 4000, height: 3000 }, { width: 1000, height: 600 }), { width: 800, height: 600 });
  assert.deepEqual(fitImage({ width: 1000, height: 4000 }, { width: 1000, height: 800 }), { width: 200, height: 800 });
  assert.deepEqual(fitImage(null, { width: 300, height: 200 }), { width: 300, height: 200 });
  assert.deepEqual(fitImage({ width: 0, height: 0 }, { width: 300, height: 200 }), { width: 300, height: 200 });
});

test('imageLabel: the file path, never the access token', () => {
  assert.equal(imageLabel('/api/hermes-file?path=%2Ftmp%2Fshot.png'), '/tmp/shot.png');
  assert.equal(imageLabel('http://127.0.0.1:8787/api/hermes-file?path=%2Ftmp%2Fa.png&token=secret'), '/tmp/a.png');
  assert.doesNotMatch(imageLabel('http://127.0.0.1:8787/api/media/x.png?token=secret'), /secret/);
  assert.equal(imageLabel('https://example.org/a/b.png?x=1'), 'https://example.org/a/b.png');
  assert.match(imageLabel('data:image/png;base64,AAAA'), /^data:image\/png/);
  assert.equal(imageLabel('blob:http://localhost/123'), 'blob:http://localhost/123');
});
