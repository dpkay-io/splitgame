#!/usr/bin/env node
// Runs automatically on `npm uninstall -g splitgame` to restore terminal/shell profiles.
try {
  if (process.platform === 'win32') {
    const { TerminalInstaller } = require('../dist/installer');
    new TerminalInstaller().uninstall();
  } else {
    const { ShellProfileInstaller } = require('../dist/shell-installer');
    new ShellProfileInstaller().uninstall();
  }
} catch (e) {
  // Silently ignore — never block npm uninstall
}
