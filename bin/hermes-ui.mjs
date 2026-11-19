#!/usr/bin/env node
// The CLI lives in server/bin/. This entry point stays so that `node bin/hermes-ui.mjs serve` in the
// repository root (LaunchAgents, systemd units, scripts) keeps working.
import '../server/bin/hermes-ui.mjs';
