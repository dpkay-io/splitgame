#!/usr/bin/env node
// Self-update splitgame without killing running terminal sessions.
// This file must NOT require anything that loads node-pty (conpty.node),
// because the whole point is to run without locking that file.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const args = process.argv.slice(3); // after "splitgame update"
const dryRun = args.includes('--dry-run');
const forceMode = args.includes('--force');
const version = args.find(a => !a.startsWith('-')) || 'latest';

function log(msg) {
  process.stdout.write(msg + '\n');
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

function forceUpdateWindows() {
  const scriptPath = path.join(os.tmpdir(), `splitgame-update-${Date.now()}.ps1`);
  const script = [
    "$Host.UI.RawUI.WindowTitle = 'splitgame update'",
    "Write-Host ''",
    "Write-Host 'Stopping running splitgame sessions...' -ForegroundColor Yellow",
    "Write-Host ''",
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction SilentlyContinue |",
    "  Where-Object { $_.CommandLine -match 'splitgame' } |",
    "  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    "Start-Sleep -Seconds 3",
    `Write-Host "Installing splitgame@${version}..." -ForegroundColor Cyan`,
    "Write-Host ''",
    `& npm install -g splitgame@${version}`,
    "Write-Host ''",
    "if ($LASTEXITCODE -eq 0) {",
    "  Write-Host 'Updated successfully! Open a new terminal tab to use the new version.' -ForegroundColor Green",
    "} else {",
    "  Write-Host 'Update failed. Try closing ALL terminals and running:' -ForegroundColor Red",
    `  Write-Host "  npm install -g splitgame@${version}" -ForegroundColor White`,
    "}",
    "Write-Host ''",
    "Write-Host 'Press any key to close...' -ForegroundColor Gray",
    "$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')",
    "Remove-Item -Path $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue",
  ].join('\n');

  if (dryRun) {
    log(`Dry run: would launch force update script at ${scriptPath}`);
    process.exit(0);
  }

  fs.writeFileSync(scriptPath, script, 'utf-8');
  spawn('cmd.exe', ['/c', 'start', '""', 'powershell.exe', '-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', scriptPath], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  log('Force update launched in a new window.');
  log('This terminal may close. Re-open a terminal after the update completes.');
  process.exit(0);
}

cleanupStagingDirs();

if (process.platform === 'win32' && forceMode) {
  forceUpdateWindows();
}

if (dryRun) {
  log(`Dry run: would run npm install -g splitgame@${version}`);
  process.exit(0);
}

log(`Installing splitgame@${version}...`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['install', '-g', `splitgame@${version}`], { stdio: 'inherit' });
child.on('exit', (code) => {
  if (code === 0) {
    log('\nsplitgame: updated successfully. Open a new terminal tab to use the new version.');
    process.exit(0);
  }

  log('');
  if (process.platform === 'win32') {
    log('Update failed — files may be locked by running terminal sessions.');
    log('');
    log('Options:');
    log('  1. Close other terminal windows/tabs, then retry: splitgame update');
    log('  2. Force update (opens a new window, closes terminals): splitgame update --force');
  }
  process.exit(code ?? 1);
});
