#!/usr/bin/env node
// Runs automatically on `npm uninstall -g splitgame` to restore terminal/shell profiles.
// During upgrades (npm install -g splitgame@new), npm runs the OLD package's preuninstall
// before installing the new one. Skip in that case — unpatching settings.json mid-upgrade
// breaks F12, causes "command not found", and disrupts running terminal sessions.
if (process.env.npm_command !== 'uninstall') process.exit(0);

try {
  if (process.platform === 'win32') {
    const { TerminalInstaller } = require('../dist/installer');
    new TerminalInstaller().uninstall();
  } else {
    const { ShellProfileInstaller } = require('../dist/shell-installer');
    new ShellProfileInstaller().uninstall();
  }
} catch (e) {
  // Never block npm uninstall, but log the error for debugging
  console.error('splitgame preuninstall warning:', e && e.message ? e.message : e);
}
