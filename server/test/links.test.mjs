// Where a link in the app goes (app/src/lib/links.ts): the desktop shell opens external links in the
// default browser and drops dangerous schemes; desktop-app/src-tauri/src/external.rs mirrors the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLink } from '../../app/src/lib/links.ts';

const APP = 'tauri://localhost';

test('the app\'s own pages and relative links stay inside', () => {
  assert.equal(classifyLink('/thread/abc', APP), 'internal');
  assert.equal(classifyLink('#m-12', APP), 'internal');
  assert.equal(classifyLink('tauri://localhost/inbox', APP), 'internal');
  assert.equal(classifyLink('http://tauri.localhost/', 'http://tauri.localhost'), 'internal');
  assert.equal(classifyLink('/settings', 'http://localhost:8081'), 'internal'); // dev server / browser
});

test('http(s) and mailto: open outside', () => {
  assert.equal(classifyLink('https://github.com/MaxGierlachowski/hermes-ui/pull/12', APP), 'external');
  assert.equal(classifyLink('http://example.com/a?b=1', APP), 'external');
  assert.equal(classifyLink('mailto:someone@example.com', APP), 'external');
  // In a browser tab the backend's own origin is internal, any other one external.
  assert.equal(classifyLink('http://127.0.0.1:8787/x', 'http://127.0.0.1:8787'), 'internal');
  assert.equal(classifyLink('http://127.0.0.1:8787/x', APP), 'external');
});

test('javascript:, file:, data:, custom schemes and garbage are blocked', () => {
  for (const href of ['javascript:alert(1)', 'JavaScript:void(0)', 'file:///etc/passwd', 'data:text/html,<b>x</b>', 'vscode://file/x', 'tel:+49123', 'tauri://evil/', 'http://[bad']) {
    assert.equal(classifyLink(href, APP), 'blocked', href);
  }
});
