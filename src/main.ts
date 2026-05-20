import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { Orchestrator } from './orchestrator';
import { findGame, getGameList } from './game-registry';
import { ConfigManager, CONFIG_KEYS, ConfigKey } from './config';
import { handleInstallCommand, handleUninstallCommand } from './install-command';

function handleMcpSetup(): void {
  const mcpServerPath = path.resolve(__dirname, '../bin/mcp-server.js');
  if (!fs.existsSync(mcpServerPath)) {
    process.stderr.write(`splitgame mcp-setup: MCP server not found at ${mcpServerPath}\n`);
    process.stderr.write('Run "npm run build" first.\n');
    process.exit(1);
  }

  const configs = [
    // Claude Code (CLI) Global Config
    {
      path: path.join(os.homedir(), '.claude.json'),
      name: 'Claude Code'
    },
    // Claude Desktop (macOS/Windows)
    {
      path: process.platform === 'win32'
        ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
        : path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      name: 'Claude Desktop'
    }
  ];

  let configuredCount = 0;

  for (const config of configs) {
    // For Desktop config, we only write if the parent directory exists (Claude is installed)
    if (config.name === 'Claude Desktop' && !fs.existsSync(path.dirname(config.path))) {
      continue;
    }

    let data: any = {};
    if (fs.existsSync(config.path)) {
      try {
        data = JSON.parse(fs.readFileSync(config.path, 'utf-8'));
      } catch {
        process.stderr.write(`splitgame mcp-setup: could not parse ${config.path}, skipping\n`);
        continue;
      }
    }

    if (!data.mcpServers) data.mcpServers = {};
    data.mcpServers['splitgame'] = {
      command: 'node',
      args: [mcpServerPath],
    };

    try {
      const dir = path.dirname(config.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Atomic write: write to temp file then rename over the original
      const tmpPath = config.path + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      fs.renameSync(tmpPath, config.path);
      process.stdout.write(`MCP server configured for ${config.name} in ${config.path}\n`);
      configuredCount++;
    } catch (e: any) {
      process.stderr.write(`splitgame mcp-setup: failed to write ${config.path}: ${e.message}\n`);
    }
  }

  if (configuredCount > 0) {
    process.stdout.write('\nRestart Claude Code or Claude Desktop to activate the splitgame tools.\n');
  } else {
    process.stderr.write('\nNo Claude configuration found. Ensure Claude Code or Claude Desktop is installed.\n');
  }
}

function handleConfigCommand(args: string[]): void {
  const config = new ConfigManager();
  const sub = args[0] || 'list';

  switch (sub) {
    case 'list': {
      const all = config.getAll();
      const defaults = ConfigManager.defaults();
      process.stdout.write('\n  splitgame configuration\n\n');
      for (const key of CONFIG_KEYS) {
        const val = String(all[key]);
        const def = String(defaults[key]);
        const suffix = val === def ? ' (default)' : '';
        process.stdout.write(`  ${key.padEnd(20)} ${val.padEnd(12)} ${suffix}\n`);
      }
      process.stdout.write('\n');
      process.stdout.write('  Valid toggleKey:        esc+esc, f12, ctrl+]\n');
      process.stdout.write('  Valid modifierKey:      ctrl, alt\n');
      process.stdout.write('  Valid gameWidthPercent: 20–80\n\n');
      break;
    }
    case 'get': {
      const key = args[1] as ConfigKey;
      if (!key || !CONFIG_KEYS.includes(key)) {
        process.stderr.write(`splitgame config get: unknown key "${args[1] || ''}". Valid: ${CONFIG_KEYS.join(', ')}\n`);
        process.exit(1);
      }
      process.stdout.write(`${config.get(key)}\n`);
      break;
    }
    case 'set': {
      const key = args[1] as ConfigKey;
      const value = args[2];
      if (!key || !CONFIG_KEYS.includes(key)) {
        process.stderr.write(`splitgame config set: unknown key "${args[1] || ''}". Valid: ${CONFIG_KEYS.join(', ')}\n`);
        process.exit(1);
      }
      if (value === undefined) {
        process.stderr.write(`splitgame config set: missing value for "${key}"\n`);
        process.exit(1);
      }
      try {
        const parsed = key === 'gameWidthPercent' ? Number(value) : value;
        config.set(key, parsed as any);
        process.stdout.write(`${key} = ${config.get(key)}\n`);
      } catch (e: any) {
        process.stderr.write(`splitgame config set: ${e.message}\n`);
        process.exit(1);
      }
      break;
    }
    case 'reset': {
      const key = args[1] as ConfigKey | undefined;
      if (key) {
        if (!CONFIG_KEYS.includes(key)) {
          process.stderr.write(`splitgame config reset: unknown key "${key}". Valid: ${CONFIG_KEYS.join(', ')}\n`);
          process.exit(1);
        }
        config.resetKey(key);
        process.stdout.write(`${key} reset to ${config.get(key)}\n`);
      } else {
        config.reset();
        process.stdout.write('All settings reset to defaults.\n');
      }
      break;
    }
    default:
      process.stderr.write(`splitgame config: unknown subcommand "${sub}"\n`);
      process.stderr.write('Usage: splitgame config [list|get|set|reset]\n');
      process.exit(1);
  }
}

function printVersion(): void {
  const pkg = require('../package.json');
  process.stdout.write(`${pkg.version}\n`);
}

function printHelp(): void {
  process.stdout.write('\n  splitgame — wrap any command in a split-terminal with a game panel\n\n');
  process.stdout.write('  Usage:\n');
  process.stdout.write('    splitgame [-g <game>] [--] <command> [args...]   Run a command with game panel\n');
  process.stdout.write('    splitgame install                                Auto-launch splitgame in new terminals\n');
  process.stdout.write('    splitgame uninstall                              Remove auto-launch integration\n');
  process.stdout.write('    splitgame config [list|get|set|reset]            Manage settings\n');
  process.stdout.write('    splitgame mcp-setup                              Configure Claude Code MCP integration\n');
  process.stdout.write('    splitgame --list-games                           Show available games\n\n');
  process.stdout.write('  Options:\n');
  process.stdout.write('    -g, --game <game>    Start with a specific game\n');
  process.stdout.write('    -h, --help           Show this help message\n');
  process.stdout.write('    -V, --version        Show version number\n\n');
  process.stdout.write('  Quick start:\n');
  process.stdout.write('    splitgame install       One-time setup: every new terminal auto-launches\n');
  process.stdout.write('                          inside splitgame.\n');
  process.stdout.write('    Ctrl+]                Toggle the game panel during any session.\n\n');
}

function main(): void {
  const rawArgs = process.argv.slice(2);

  // Nesting detection: if already running inside splitgame, skip wrapping
  // Subcommands (config, install, etc.) are allowed even when nested
  const SUBCOMMANDS = ['config', 'install', 'uninstall', 'mcp-setup', '--version', '-V', '--help', '-h', '--list-games'];
  const isSubcommand = rawArgs.length > 0 && SUBCOMMANDS.includes(rawArgs[0]);
  if (!isSubcommand && process.env.SPLITGAME_ACTIVE === '1') {
    process.stderr.write('splitgame: already running in this session, launching child directly\n');
    // Strip splitgame-specific flags (-g/--game and --) to extract the child command
    const childArgs: string[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
      if ((rawArgs[i] === '-g' || rawArgs[i] === '--game') && i + 1 < rawArgs.length) {
        i++; // skip flag and its value
      } else if (rawArgs[i] === '--') {
        continue;
      } else {
        childArgs.push(rawArgs[i]);
      }
    }
    const cmd = childArgs[0] || (process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh'));
    const rest = childArgs.length > 0 ? childArgs.slice(1) : [];
    const result = spawnSync(cmd, rest, { stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }

  if (rawArgs.includes('--version') || rawArgs.includes('-V')) {
    printVersion();
    process.exit(0);
  }

  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Check for subcommands first
  if (rawArgs[0] === 'config') {
    handleConfigCommand(rawArgs.slice(1));
    process.exit(0);
  }

  if (rawArgs[0] === 'install') {
    handleInstallCommand(rawArgs.slice(1));
    process.exit(0);
  }

  if (rawArgs[0] === 'uninstall') {
    handleUninstallCommand(rawArgs.slice(1));
    process.exit(0);
  }

  if (rawArgs[0] === 'mcp-setup') {
    handleMcpSetup();
    process.exit(0);
  }

  let gameId: string | undefined;
  const args: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    if ((rawArgs[i] === '--game' || rawArgs[i] === '-g') && i + 1 < rawArgs.length) {
      const candidate = rawArgs[i + 1];
      const found = findGame(candidate);
      if (!found) {
        const names = getGameList().map(g => g.id).join(', ');
        process.stderr.write(`splitgame: unknown game "${candidate}". Available: ${names}\n`);
        process.exit(1);
      }
      gameId = found.id;
      i++;
    } else if (rawArgs[i] === '--list-games') {
      const games = getGameList();
      for (const g of games) {
        process.stdout.write(`  ${g.id.padEnd(14)} ${g.name}\n`);
      }
      process.exit(0);
    } else {
      args.push(rawArgs[i]);
    }
  }

  const dashDashIndex = args.indexOf('--');

  let command: string;
  let commandArgs: string[];

  if (dashDashIndex !== -1 && dashDashIndex < args.length - 1) {
    command = args[dashDashIndex + 1];
    commandArgs = args.slice(dashDashIndex + 2);
  } else if (dashDashIndex === -1 && args.length > 0) {
    command = args[0];
    commandArgs = args.slice(1);
  } else {
    // Default to a shell if no command provided
    command = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh');
    commandArgs = [];
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write('splitgame requires a TTY. Pipe or redirect is not supported.\n');
    process.exit(1);
  }

  const configManager = new ConfigManager();
  const orchestrator = new Orchestrator({ command, args: commandArgs, gameId }, configManager);
  orchestrator.start();
}

main();
