import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseArgs, renderUnit } from '../scripts/systemd-unit.mjs';

test('system unit with user, env file, working dir and node path', () => {
  const unit = renderUnit(parseArgs([
    '--user', 'agentbox', '--group', 'agentbox', '--environment-file', '/etc/agentbox/hermes-ui.env',
    '--working-dir', '/opt/agentbox/vendor/hermes-ui/0.3.0/hermes-ui', '--node', '/opt/agentbox/vendor/node/24.22.3/bin/node',
    '--set', 'HERMES_UI_BASE_PATH=/hermes', '--', '--port', '8787',
  ]));
  const lines = unit.split('\n');
  for (const l of [
    'User=agentbox', 'Group=agentbox', 'EnvironmentFile=/etc/agentbox/hermes-ui.env',
    'WorkingDirectory=/opt/agentbox/vendor/hermes-ui/0.3.0/hermes-ui',
    'Environment=HERMES_UI_BASE_PATH=/hermes',
    'ExecStart=/opt/agentbox/vendor/node/24.22.3/bin/node /opt/agentbox/vendor/hermes-ui/0.3.0/hermes-ui/bin/hermes-ui.mjs serve --port 8787',
    'WantedBy=multi-user.target', 'Restart=on-failure',
  ]) assert.ok(lines.includes(l), l);
  assert.match(unit, /^\[Unit\]\n/);
});

test('quoting: spaces, % and $ are escaped for systemd', () => {
  const unit = renderUnit({ user: 'u', 'working-dir': '/srv/hermes ui', node: '/usr/bin/node', set: ['X=a b%c$d'] });
  assert.ok(unit.includes('WorkingDirectory="/srv/hermes ui"'));
  assert.ok(unit.includes('ExecStart=/usr/bin/node "/srv/hermes ui/bin/hermes-ui.mjs" serve'));
  assert.ok(unit.includes('Environment="X=a b%%c$$d"'));
});

test('bad input is refused', () => {
  assert.throws(() => parseArgs(['--nope', 'x']), /unknown option/);
  assert.throws(() => parseArgs(['--set', 'not-a-pair']), /KEY=VALUE/);
  assert.throws(() => renderUnit({ 'working-dir': 'relative/dir' }), /absolute/);
  assert.throws(() => execFileSync(process.execPath, ['scripts/systemd-unit.mjs', '--user'], { stdio: 'pipe' }));
});

test('CLI prints the unit', () => {
  const out = execFileSync(process.execPath, ['scripts/systemd-unit.mjs', '--user', 'svc', '--node', '/usr/bin/node', '--working-dir', '/srv/h'], { encoding: 'utf8' });
  assert.match(out, /ExecStart=\/usr\/bin\/node \/srv\/h\/bin\/hermes-ui.mjs serve\n/);
});
