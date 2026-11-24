// Which files a chat may open (src/file-access.mjs): roots, hidden directories, symlinks, the denylist,
// MEDIA files outside the roots, limits, text previews.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attachmentHeader, createFileAccess, denied, inlineType } from '../src/file-access.mjs';

// <base>/home is "home" (the default root), <base>/outside is not below it.
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ui-files-')));
const home = path.join(base, 'home');
const outside = path.join(base, 'outside');
const put = (rel, body = 'x') => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };

const report = put('home/Reports/q3.pdf', '%PDF-1.4');
const notes = put('home/notes/plan.md', '# Plan\n');
put('home/.config/app/settings.json', '{}');
put('home/project/.git/config', '[core]');
put('home/.ssh/id_ed25519', 'KEY');
put('home/project/.env', 'A=1');
put('home/project/.env.local', 'A=1');
put('home/project/server.pem', 'PEM');
put('home/project/tls.key', 'KEY');
put('home/project/id_rsa.pub', 'PUB');
put('home/project/api-token.txt', 't');
put('home/project/Secrets.md', 's');
put('home/project/aws-credentials.json', '{}');
put('home/Library/Keychains/login.keychain-db', 'k');
put('home/Library/Application Support/App/store.sqlite', 'db');
put('home/project/data/test.db', 'db');
const outsideFile = put('outside/report.txt', 'hello');
const tmpMedia = put('outside/render.mp4', 'mp4');
fs.symlinkSync(outsideFile, path.join(home, 'notes', 'link.txt'));
fs.symlinkSync(path.join(home, '.ssh', 'id_ed25519'), path.join(home, 'notes', 'key.txt'));
fs.mkdirSync(path.join(home, 'folder.md'));

const access = createFileAccess({ home, maxPreviewBytes: 10, maxDownloadBytes: 100, maxTextBytes: 4 });
const ok = (key, o) => access.resolve(key, o)?.file ?? null;
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

test('files below home, by absolute path, ~/ and file://', () => {
  assert.equal(ok(report), report);
  assert.equal(ok('~/notes/plan.md'), notes);
  assert.equal(ok(`file://${encodeURI(notes)}`), notes);
  const f = access.resolve('~/Reports/q3.pdf');
  assert.equal(f.name, 'q3.pdf');
  assert.equal(f.mime, 'application/pdf');
  assert.equal(f.path, report);
});

test('not: outside the roots, missing, directories, relative paths, ".."', () => {
  assert.equal(ok(outsideFile), null);
  assert.equal(ok(path.join(home, 'notes', 'nope.md')), null);
  assert.equal(ok(path.join(home, 'folder.md')), null);
  assert.equal(ok('notes/plan.md'), null);
  assert.equal(ok(`${home}/notes/../../outside/report.txt`), null);
});

test('symlinks count by their target', () => {
  assert.equal(ok(path.join(home, 'notes', 'link.txt')), null); // points outside home
  assert.equal(ok(path.join(home, 'notes', 'key.txt')), null); // points into .ssh
  assert.equal(ok(path.join(home, 'notes', 'key.txt'), { explicit: true }), null);
});

test('hidden directories and files below the root are refused', () => {
  assert.equal(ok('~/.config/app/settings.json'), null);
  assert.equal(ok('~/project/.git/config'), null);
});

test('denylist, also for MEDIA files and inside allowed roots', () => {
  for (const rel of ['.ssh/id_ed25519', 'project/.env', 'project/.env.local', 'project/server.pem', 'project/tls.key', 'project/id_rsa.pub',
    'project/api-token.txt', 'project/Secrets.md', 'project/aws-credentials.json', 'Library/Keychains/login.keychain-db',
    'Library/Application Support/App/store.sqlite']) {
    assert.equal(ok(path.join(home, rel)), null, rel);
    assert.equal(ok(path.join(home, rel), { explicit: true }), null, `${rel} (MEDIA)`);
  }
  // A database in a project is no app data.
  assert.equal(ok('~/project/data/test.db'), path.join(home, 'project', 'data', 'test.db'));
});

test('denied(): reasons', () => {
  assert.equal(denied('/Users/me/.ssh/config'), 'directory .ssh');
  assert.equal(denied('/Users/me/.gnupg/pubring.kbx'), 'directory .gnupg');
  assert.equal(denied('/Users/me/.aws/config'), 'directory .aws');
  assert.equal(denied('/Users/me/Library/Keychains/x.db'), 'directory keychains');
  assert.equal(denied('/Users/me/work/.env.production'), 'name');
  assert.equal(denied('/Users/me/work/client_secret.json'), 'name');
  assert.equal(denied('/Users/me/work/.npmrc'), 'name');
  assert.equal(denied('/Users/me/.local/share/app/data.db'), 'app database');
  assert.equal(denied('/Users/me/work/report.pdf'), null);
  assert.equal(denied('/Users/me/work/tokenizer.py'), 'name'); // conservative on purpose
});

test('MEDIA files may come from outside the roots', () => {
  assert.equal(ok(tmpMedia, { explicit: true }), tmpMedia);
  assert.equal(ok(tmpMedia), null);
});

test('previewable: inline types within the preview limit, text always (cut), the rest never', () => {
  const r = (key, o) => access.resolve(key, o);
  assert.equal(access.previewable(r(report)), true); // 8 bytes ≤ 10
  put('home/Reports/big.pdf', '%PDF-1.4 and more than ten bytes');
  assert.equal(access.previewable(r('~/Reports/big.pdf')), false);
  assert.equal(access.previewable(r(notes)), true);
  put('home/out/archive.zip', 'PK');
  assert.equal(access.previewable(r('~/out/archive.zip')), false);
  assert.equal(access.previewable(r(tmpMedia, { explicit: true })), true); // videos up to the download limit
});

test('readText: first maxTextBytes, truncated flag, binary refused', () => {
  assert.deepEqual(access.readText(access.resolve(notes)), { text: '# Pl', truncated: true, size: 7 });
  put('home/notes/short.txt', 'ok');
  assert.deepEqual(access.readText(access.resolve('~/notes/short.txt')), { text: 'ok', truncated: false, size: 2 });
  put('home/notes/blob.txt', Buffer.from([1, 0, 2]));
  assert.equal(access.readText(access.resolve('~/notes/blob.txt')).binary, true);
  put('home/notes/umlaut.txt', 'aaaü'); // ü is 2 bytes: the cut after its first one drops it
  assert.equal(access.readText(access.resolve('~/notes/umlaut.txt')).text, 'aaa');
});

test('inline types: never HTML or SVG', () => {
  assert.equal(inlineType('/a/b.pdf'), 'application/pdf');
  assert.equal(inlineType('/a/b.png'), 'image/png');
  assert.equal(inlineType('/a/b.svg'), null);
  assert.equal(inlineType('/a/b.html'), null);
  assert.equal(inlineType('/a/b.md'), null);
});

test('attachmentHeader: ASCII fallback plus UTF-8 name', () => {
  assert.equal(attachmentHeader('Übersicht "Q3".pdf'), `attachment; filename="_bersicht _Q3_.pdf"; filename*=UTF-8''%C3%9Cbersicht%20%22Q3%22.pdf`);
});
