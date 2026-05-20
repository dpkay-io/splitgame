#!/usr/bin/env node
// Runs automatically on `npm install -g splitgame` to configure the user's terminal
// and Claude Code MCP integration. Silently ignored on failure — the user can always
// run `splitgame install` or `splitgame mcp-setup` manually.
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

try {
  const { setupMcp } = require('../dist/mcp-setup');
  const result = setupMcp(require('path').resolve(__dirname, '..'));
  const configured = result.configs.filter(c => c.status === 'configured');
  if (configured.length > 0) {
    process.stdout.write('splitgame: configured MCP server for ' + configured.map(c => c.name).join(', ') + '.\n');
    process.stdout.write('Restart Claude Code to enable game tools.\n\n');
  }
} catch (e) {
  // Silently ignore — user can run `splitgame mcp-setup` manually
}
