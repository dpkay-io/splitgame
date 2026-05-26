#!/usr/bin/env node
// Runs before npm installs splitgame's dependencies.
// Clean up leftover staging dirs from previous failed installs.
// NOTE: We intentionally do NOT kill running splitgame processes here.
// Killing processes terminates all open terminal sessions — unacceptable UX.
// If conpty.node is file-locked, npm will fail with EBUSY; the user can
// close other terminals and retry, or use `splitgame update --force`.
'use strict';
if (process.platform !== 'win32') process.exit(0);

const fs = require('fs');
const path = require('path');

// Clean up leftover staging dirs from previous failed installs
try {
  const nodeModulesDir = path.resolve(__dirname, '..', '..');
  for (const entry of fs.readdirSync(nodeModulesDir)) {
    if (entry.startsWith('.splitgame-')) {
      try { fs.rmSync(path.join(nodeModulesDir, entry), { recursive: true, force: true }); } catch (e) {}
    }
  }
} catch (e) {}
