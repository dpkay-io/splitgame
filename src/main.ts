import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { Orchestrator } from './orchestrator';
import { findGame, getGameList } from './game-registry';
import { ConfigManager, CONFIG_KEYS, ConfigKey } from './config';
import { handleInstallCommand, handleUninstallCommand } from './install-command';
import { setupMcp } from './mcp-setup';

function handleMcpSetup(force: boolean): void {
  const result = setupMcp(path.resolve(__dirname, '..'), { force });

  if (!result.mcpServerFound) {
    process.stderr.write(`splitgame mcp-setup: MCP server not found at ${result.mcpServerPath}\n`);
    process.stderr.write('Run "npm run build" first.\n');
    process.exit(1);
  }

  for (const config of result.configs) {
    if (config.status === 'configured') {
      process.stdout.write(`MCP server configured for ${config.name} in ${config.path}\n`);
    } else if (config.status === 'exists') {
      process.stdout.write(`${config.name} already configured (use --force to overwrite)\n`);
    } else if (config.status === 'parse-error') {
      process.stderr.write(`splitgame mcp-setup: could not parse ${config.path}, skipping\n`);
      process.stderr.write(`  Check ${config.path} for syntax errors, or run 'splitgame mcp-setup --force' to regenerate.\n`);
    }
  }

  const configured = result.configs.filter(c => c.status === 'configured');
  if (configured.length > 0) {
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
      process.stdout.write('  Valid toggleKey:        f12, ctrl+]\n');
      process.stdout.write('  Valid modifierKey:      ctrl, alt\n');
      process.stdout.write('  Valid gameWidthPercent: 20–80\n');
      process.stdout.write('  Valid scrollbackLines:  100–100000\n\n');
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
        const parsed = (key === 'gameWidthPercent' || key === 'scrollbackLines') ? Number(value) : value;
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
        try {
          config.resetKey(key);
          process.stdout.write(`${key} reset to ${config.get(key)}\n`);
        } catch (e: any) {
          process.stderr.write(`splitgame config reset: ${e.message}\n`);
          process.exit(1);
        }
      } else {
        try {
          config.reset();
          process.stdout.write('All settings reset to defaults.\n');
        } catch (e: any) {
          process.stderr.write(`splitgame config reset: ${e.message}\n`);
          process.exit(1);
        }
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
  process.stdout.write('    splitgame update                                 Self-update (avoids Windows file lock issues)\n');
  process.stdout.write('    splitgame --list-games                           Show available games\n\n');
  process.stdout.write('  Options:\n');
  process.stdout.write('    -g, --game <game>    Start with a specific game\n');
  process.stdout.write('    -h, --help           Show this help message\n');
  process.stdout.write('    -V, --version        Show version number\n\n');
  process.stdout.write('  Quick start:\n');
  process.stdout.write('    splitgame install       One-time setup: every new terminal auto-launches\n');
  process.stdout.write('                          inside splitgame.\n');
  process.stdout.write('    F12 (default)         Toggle the game panel (configurable via splitgame config).\n\n');
}

let orchestratorInstance: Orchestrator | null = null;

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`splitgame: unhandled promise rejection: ${msg}\n`);
  if (orchestratorInstance) {
    orchestratorInstance.destroy();
  }
  process.exit(1);
});

function main(): void {
  const rawArgs = process.argv.slice(2);

  // Nesting detection: if already running inside splitgame, skip wrapping
  // Subcommands (config, install, etc.) are allowed even when nested
  const SUBCOMMANDS = ['config', 'install', 'uninstall', 'update', 'mcp-setup', '--version', '-V', '--help', '-h', '--list-games'];
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
    handleMcpSetup(rawArgs.includes('--force'));
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
      process.stdout.write('\n  Available games:\n\n');
      for (const g of games) {
        let tag = '';
        try {
          const instance = g.create();
          if (instance.supportsExternalMoves) tag = '  (Claude)';
        } catch {}
        process.stdout.write(`    ${g.id.padEnd(14)} ${g.name}${tag}\n`);
      }
      process.stdout.write('\n');
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
  const toggleLabel = configManager.get('toggleKey') === 'f12' ? 'F12' : 'Ctrl+]';

  const firstRunMarker = path.join(os.homedir(), '.splitgame', '.first-run-shown');
  let isFirstRun = false;
  try {
    fs.accessSync(firstRunMarker);
  } catch {
    isFirstRun = true;
  }

  if (isFirstRun) {
    process.stderr.write('\n');
    process.stderr.write('  splitgame is ready!\n');
    process.stderr.write(`  Press ${toggleLabel} to open the game panel.\n`);
    process.stderr.write('  Use arrow keys to pick a game, Enter to start.\n');
    process.stderr.write('  Esc to pause/back, P to pause and use CLI.\n');
    process.stderr.write('  splitgame --help for all options.\n');
    process.stderr.write('\n');
    try {
      fs.mkdirSync(path.dirname(firstRunMarker), { recursive: true });
      fs.writeFileSync(firstRunMarker, '', 'utf-8');
    } catch {}
  } else {
    process.stderr.write(`splitgame: press ${toggleLabel} to play | splitgame --help for more\n`);
  }

  const orchestrator = new Orchestrator({ command, args: commandArgs, gameId }, configManager);
  orchestratorInstance = orchestrator;
  orchestrator.start();
}

main();
