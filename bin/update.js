#!/usr/bin/env node
// Self-update splitgame without killing running terminal sessions.
// This file must NOT require anything that loads node-pty (conpty.node),
// because the whole point is to run without locking that file.
//
// On Windows, `npm install -g` fails with EBUSY when conpty.node is locked
// by running splitgame sessions. `npm update -g` handles this gracefully,
// so we use that for the default (latest) case.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const args = process.argv.slice(3); // after "splitgame update"
const dryRun = args.includes('--dry-run');
const forceMode = args.includes('--force');
const version = args.find(a => !a.startsWith('-')) || 'latest';
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

function log(msg) {
  process.stdout.write(msg + '\n');
}

function getCurrentVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version;
  } catch { return null; }
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

function runUpdate(npmArgs, onFail) {
  const child = spawn(npm, npmArgs, { stdio: 'inherit' });
  child.on('exit', (code) => {
    if (code === 0) {
      log('');
      log('Updated successfully. Open a new terminal tab to use the new version.');
      process.exit(0);
    }
    onFail(code);
  });
}

function showWindowsError(code) {
  log('');
  log('Update failed — Windows locks files used by running programs.');
  log('splitgame uses a native module (conpty.node) that gets locked while');
  log('any terminal session running splitgame is open.');
  log('');
  log('Try one of these:');
  log('');
  log('  1. Close other terminal tabs/windows running splitgame, then retry:');
  log('       splitgame update');
  log('');
  log('  2. Force update (opens a new window, stops running sessions):');
  log('       splitgame update --force');
  log('');
  log('  3. Update manually after closing all terminals:');
  log(`       npm install -g splitgame@${version}`);
  process.exit(code ?? 1);
}

function showUnixError(code) {
  log('');
  log('Update failed. You may need elevated permissions:');
  log(`  sudo npm install -g splitgame@${version}`);
  process.exit(code ?? 1);
}

// --- main ---

cleanupStagingDirs();

if (isWindows && forceMode) {
  forceUpdateWindows();
}

const currentVersion = getCurrentVersion();

if (dryRun) {
  const cmd = version === 'latest'
    ? 'npm update -g splitgame'
    : `npm install -g splitgame@${version}`;
  log(`Dry run: would run ${cmd}`);
  if (currentVersion) log(`Current version: v${currentVersion}`);
  process.exit(0);
}

if (currentVersion) {
  log(`Current version: v${currentVersion}`);
}

if (version === 'latest') {
  log('Checking for updates...');
  // npm update handles locked files better than npm install on Windows
  runUpdate(['update', '-g', 'splitgame'], (code) => {
    if (isWindows) {
      showWindowsError(code);
    } else {
      showUnixError(code);
    }
  });
} else {
  log(`Installing splitgame@${version}...`);
  runUpdate(['install', '-g', `splitgame@${version}`], (code) => {
    if (isWindows) {
      showWindowsError(code);
    } else {
      showUnixError(code);
    }
  });
}
