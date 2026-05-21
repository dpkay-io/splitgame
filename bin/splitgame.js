#!/usr/bin/env node
// Handle "update" before loading main.ts — main.ts transitively loads node-pty's
// conpty.node native binary, which locks the file on Windows and prevents npm from
// replacing it during upgrades. The update script kills running splitgame processes
// first, then runs npm install.
if (process.argv[2] === 'update') {
  require('./update.js');
} else {
  require('../dist/main.js');
}
