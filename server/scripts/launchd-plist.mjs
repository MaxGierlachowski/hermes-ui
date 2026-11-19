#!/usr/bin/env node
// Prints a macOS LaunchAgent plist for the backend with this machine's paths. Nothing is installed:
//   node server/scripts/launchd-plist.mjs > ~/Library/LaunchAgents/io.github.hermes-ui.plist
//   launchctl load ~/Library/LaunchAgents/io.github.hermes-ui.plist
// Extra args are passed to `hermes-ui serve`, e.g. `--remote iroh`.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repository root: `node bin/hermes-ui.mjs` there runs the backend with the repo's .env and data/.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const args = [process.execPath, path.join(root, 'bin', 'hermes-ui.mjs'), 'serve', ...process.argv.slice(2)];
const log = path.join(os.homedir(), 'Library', 'Logs', 'hermes-ui.log');
process.stdout.write(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>io.github.hermes-ui</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${esc(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(process.env.PATH || '/usr/bin:/bin')}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict>
</plist>
`);
