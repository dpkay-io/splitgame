#!/usr/bin/env node
// Self-update splitgame without EBUSY errors on Windows.
// This file must NOT require anything that loads node-pty (conpty.node),
// because the whole point is to run without locking that file.
'use strict';
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(3); // after "splitgame update"
const dryRun = args.includes('--dry-run');
const version = args.find(a => !a.startsWith('-')) || 'latest';

function log(msg) {
  process.stdout.write(msg + '\n');
}

function killSplitgameProcesses() {
  if (process.platform !== 'win32') return;

  const myPid = process.pid;
  let pids = [];
  try {
    const result = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'splitgame' -and $_.ProcessId -ne ${myPid} } | Select-Object -ExpandProperty ProcessId"`,
      { encoding: 'utf8', timeout: 15000 }
    ).trim();
    pids = result.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(Number);
  } catch (e) {
    return;
  }

  if (pids.length === 0) return;

  log(`Stopping ${pids.length} running splitgame process(es)...`);
  for (const pid of pids) {
    try { process.kill(pid); } catch (e) {}
  }

  // Wait for processes to exit and release file locks
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const alive = pids.filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
    if (alive.length === 0) break;
    execSync('powershell -NoProfile -Command "Start-Sleep -Milliseconds 500"', { stdio: 'ignore' });
  }

  // Force-kill any survivors
  for (const pid of pids) {
    try { process.kill(pid, 'SIGKILL'); } catch (e) {}
  }
}

function cleanupStagingDirs() {
  try {
    const nodeModulesDir = path.resolve(__dirname, '..', '..');
    const entries = fs.readdirSync(nodeModulesDir);
    for (const entry of entries) {
      if (entry.startsWith('.splitgame-')) {
        const fullPath = path.join(nodeModulesDir, entry);
        log(`Cleaning up leftover staging dir: ${entry}`);
        if (!dryRun) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      }
    }
  } catch (e) {}
}

log('splitgame: preparing update...');
killSplitgameProcesses();
cleanupStagingDirs();

if (dryRun) {
  log(`Dry run: would run npm install -g splitgame@${version}`);
  process.exit(0);
}

log(`Installing splitgame@${version}...`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['install', '-g', `splitgame@${version}`], { stdio: 'inherit' });
child.on('exit', (code) => {
  if (code === 0) {
    log('\nsplitgame: updated. Open a new terminal tab to use the new version.');
  }
  process.exit(code ?? 1);
});
