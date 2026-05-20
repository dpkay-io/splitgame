import { Orchestrator } from './orchestrator';
import { findGame, getGameList } from './game-registry';
import { ConfigManager, CONFIG_KEYS, ConfigKey } from './config';
import { handleInstallCommand, handleUninstallCommand } from './install-command';

function handleConfigCommand(args: string[]): void {
  const config = new ConfigManager();
  const sub = args[0] || 'list';

  switch (sub) {
    case 'list': {
      const all = config.getAll();
      const defaults = ConfigManager.defaults();
      process.stdout.write('\n  gamecli configuration\n\n');
      for (const key of CONFIG_KEYS) {
        const val = String(all[key]);
        const def = String(defaults[key]);
        const suffix = val === def ? ' (default)' : '';
        process.stdout.write(`  ${key.padEnd(20)} ${val.padEnd(12)} ${suffix}\n`);
      }
      process.stdout.write('\n');
      process.stdout.write('  Valid toggleKey:        esc+esc, ctrl+g, ctrl+]\n');
      process.stdout.write('  Valid modifierKey:      ctrl, alt\n');
      process.stdout.write('  Valid gameWidthPercent: 40–80\n\n');
      break;
    }
    case 'get': {
      const key = args[1] as ConfigKey;
      if (!key || !CONFIG_KEYS.includes(key)) {
        process.stderr.write(`gamecli config get: unknown key "${args[1] || ''}". Valid: ${CONFIG_KEYS.join(', ')}\n`);
        process.exit(1);
      }
      process.stdout.write(`${config.get(key)}\n`);
      break;
    }
    case 'set': {
      const key = args[1] as ConfigKey;
      const value = args[2];
      if (!key || !CONFIG_KEYS.includes(key)) {
        process.stderr.write(`gamecli config set: unknown key "${args[1] || ''}". Valid: ${CONFIG_KEYS.join(', ')}\n`);
        process.exit(1);
      }
      if (value === undefined) {
        process.stderr.write(`gamecli config set: missing value for "${key}"\n`);
        process.exit(1);
      }
      try {
        const parsed = key === 'gameWidthPercent' ? Number(value) : value;
        config.set(key, parsed as any);
        process.stdout.write(`${key} = ${config.get(key)}\n`);
      } catch (e: any) {
        process.stderr.write(`gamecli config set: ${e.message}\n`);
        process.exit(1);
      }
      break;
    }
    case 'reset': {
      const key = args[1] as ConfigKey | undefined;
      if (key) {
        if (!CONFIG_KEYS.includes(key)) {
          process.stderr.write(`gamecli config reset: unknown key "${key}". Valid: ${CONFIG_KEYS.join(', ')}\n`);
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
      process.stderr.write(`gamecli config: unknown subcommand "${sub}"\n`);
      process.stderr.write('Usage: gamecli config [list|get|set|reset]\n');
      process.exit(1);
  }
}

function printVersion(): void {
  const pkg = require('../package.json');
  process.stdout.write(`${pkg.version}\n`);
}

function printHelp(): void {
  process.stdout.write('\n  gamecli — wrap any command in a split-terminal with a game panel\n\n');
  process.stdout.write('  Usage:\n');
  process.stdout.write('    gamecli [-g <game>] [--] <command> [args...]   Run a command with game panel\n');
  process.stdout.write('    gamecli install                                Auto-launch gamecli in new terminals\n');
  process.stdout.write('    gamecli uninstall                              Remove auto-launch integration\n');
  process.stdout.write('    gamecli config [list|get|set|reset]            Manage settings\n');
  process.stdout.write('    gamecli --list-games                           Show available games\n\n');
  process.stdout.write('  Options:\n');
  process.stdout.write('    -g, --game <game>    Start with a specific game\n');
  process.stdout.write('    -h, --help           Show this help message\n');
  process.stdout.write('    -V, --version        Show version number\n\n');
  process.stdout.write('  Quick start:\n');
  process.stdout.write('    gamecli install       One-time setup: every new terminal auto-launches\n');
  process.stdout.write('                          inside gamecli.\n');
  process.stdout.write('    Double-tap Escape     Toggle the game panel during any session.\n\n');
}

function main(): void {
  const rawArgs = process.argv.slice(2);

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

  let gameId: string | undefined;
  const args: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    if ((rawArgs[i] === '--game' || rawArgs[i] === '-g') && i + 1 < rawArgs.length) {
      const candidate = rawArgs[i + 1];
      const found = findGame(candidate);
      if (!found) {
        const names = getGameList().map(g => g.id).join(', ');
        process.stderr.write(`gamecli: unknown game "${candidate}". Available: ${names}\n`);
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
    printHelp();
    process.exit(0);
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write('gamecli requires a TTY. Pipe or redirect is not supported.\n');
    process.exit(1);
  }

  const configManager = new ConfigManager();
  const orchestrator = new Orchestrator({ command, args: commandArgs, gameId }, configManager);
  orchestrator.start();
}

main();
