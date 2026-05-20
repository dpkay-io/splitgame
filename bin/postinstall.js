#!/usr/bin/env node
// Runs automatically on `npm install -g splitgame` to configure the user's terminal.
// Silently ignored on failure — the user can always run `splitgame install` manually.
try {
  if (process.platform === 'win32') {
    const { TerminalInstaller } = require('../dist/installer');
    const result = new TerminalInstaller().install();
    if (!result.alreadyInstalled) {
      process.stdout.write('\nsplitgame: auto-configured Windows Terminal profiles.\n');
      process.stdout.write('Open a new tab to start. Press F12 to toggle the game panel.\n');
      process.stdout.write('To undo: splitgame uninstall\n\n');
    }
  } else {
    const { ShellProfileInstaller } = require('../dist/shell-installer');
    const result = new ShellProfileInstaller().install();
    if (!result.alreadyInstalled) {
      process.stdout.write('\nsplitgame: auto-configured shell profile.\n');
      process.stdout.write('Open a new terminal to start. Press F12 to toggle the game panel.\n');
      process.stdout.write('To undo: splitgame uninstall\n\n');
    }
  }
} catch (e) {
  // Silently ignore — never block npm install
}
