#!/usr/bin/env node
// Runs before npm installs splitgame's dependencies.
// On Windows, kill running splitgame processes so conpty.node isn't file-locked.
// This helps with `npm install -g splitgame` when the user doesn't use `splitgame update`.
// Best-effort — npm may have already started file operations before this runs.
'use strict';
if (process.platform !== 'win32') process.exit(0);

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  const myPid = process.pid;
  const result = execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'splitgame' -and $_.CommandLine -notmatch 'npm|preinstall' -and $_.ProcessId -ne ${myPid} } | Select-Object -ExpandProperty ProcessId"`,
    { encoding: 'utf8', timeout: 15000 }
  ).trim();

  const pids = result.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(Number);
  if (pids.length > 0) {
    process.stderr.write(`splitgame: stopping ${pids.length} running instance(s) for upgrade...\n`);
    for (const pid of pids) {
      try { process.kill(pid); } catch (e) {}
    }
    execSync('powershell -NoProfile -Command "Start-Sleep -Milliseconds 2000"', { stdio: 'ignore' });
  }
} catch (e) {
  // Silently ignore — never block npm install
}

// Clean up leftover staging dirs from previous failed installs
try {
  const nodeModulesDir = path.resolve(__dirname, '..', '..');
  for (const entry of fs.readdirSync(nodeModulesDir)) {
    if (entry.startsWith('.splitgame-')) {
      try { fs.rmSync(path.join(nodeModulesDir, entry), { recursive: true, force: true }); } catch (e) {}
    }
  }
} catch (e) {}
