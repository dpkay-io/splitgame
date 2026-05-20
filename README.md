# gamecli

Play games in a split-terminal overlay alongside your CLI tools. The child process runs on the left; the game renders on the right. Toggle the game panel with a hotkey and get back to work instantly.

## Install

```bash
npm install -g gamecli
```

Requires Node.js >= 18.

## Quick Start

```bash
# Wrap any command with a game panel
gamecli node server.js
gamecli npm run dev
gamecli python train.py

# Start with a specific game
gamecli -g tetris npm run dev

# One-time setup: auto-launch in every new terminal
gamecli install
```

After `gamecli install`, every new terminal session starts inside gamecli automatically. Double-tap Escape to toggle the game panel. Use `gamecli uninstall` to remove.

## Games

| Game | ID | Description |
|------|----|-------------|
| Snake | `snake` | Classic snake - eat food, grow longer |
| 2048 | `2048` | Slide and merge tiles to reach 2048 |
| Tetris | `tetris` | Stack and clear lines with falling pieces |
| Tic-Tac-Toe | `tictactoe` | Play against an unbeatable minimax AI |
| Breakout | `breakout` | Bounce the ball to break all bricks |
| Minesweeper | `minesweeper` | Flag mines and reveal safe cells |
| Flappy Bird | `flappy` | Tap to fly through pipe gaps |

## Key Bindings

### Toggle & Navigation
| Key | Action |
|-----|--------|
| Double-tap Escape | Toggle game panel (configurable) |
| N | Return to game menu |
| M | Minimize (hide game panel) |

### Gameplay
| Key | Action |
|-----|--------|
| Arrow keys / WASD | Move / navigate |
| Space / Enter | Action (flap, reveal, place) |
| F | Flag (Minesweeper) |
| R | Restart current game |
| Ctrl+Space | Pause / resume |
| Modifier+Left/Right | Resize game panel |

## Configuration

```bash
gamecli config list                    # Show all settings
gamecli config set toggleKey ctrl+g    # Change toggle key
gamecli config set modifierKey alt     # Change modifier key (ctrl or alt)
gamecli config set gameWidthPercent 60 # Change game panel width (40-80)
gamecli config reset                   # Reset all to defaults
```

### Settings

| Setting | Default | Options |
|---------|---------|---------|
| `toggleKey` | `esc+esc` | `esc+esc`, `ctrl+g`, `ctrl+]` |
| `modifierKey` | `ctrl` | `ctrl`, `alt` |
| `gameWidthPercent` | `50` | `40` - `80` |

Settings are stored in `~/.gamecli/config.json`.

## CLI Reference

```bash
gamecli [options] [--] <command> [args...]
gamecli install          # Auto-launch in new terminals
gamecli uninstall        # Remove auto-launch
gamecli config <sub>     # Manage settings
gamecli --list-games     # List available games
gamecli --version        # Show version
gamecli --help           # Show help
```

| Option | Description |
|--------|-------------|
| `-g, --game <id>` | Start with a specific game |
| `-h, --help` | Show help message |
| `-V, --version` | Show version number |
| `--list-games` | List available games |

## Platform Support

### Windows
`gamecli install` patches Windows Terminal's `settings.json` to wrap each profile's command with gamecli. Supports standard profiles, Visual Studio developer prompts, and specialized toolchains. Skips Azure Cloud Shell, WSL, and VS Debug Console.

### Linux / macOS
`gamecli install` appends a guarded auto-launch snippet to your shell profile (`.bashrc`, `.zshrc`, or `config.fish`). Prevents recursion via `GAMECLI_ACTIVE` env var and skips non-TTY sessions.

Both platforms create backups in `~/.gamecli/backups/` before modifying anything. `gamecli uninstall` restores the original state.

## Requirements

- A real TTY terminal (Windows Terminal, iTerm2, native console)
- Will not run in piped/redirected contexts or non-TTY terminals (e.g., VS Code integrated terminal)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm test` to verify
5. Submit a pull request

### Adding a New Game

1. Create `src/games/yourgame.ts` implementing `IGame` from `src/types.ts`
2. `init(width, height)` sets up the board; `tick(deltaMs)` advances state; `getState()` returns a `GameRenderState`
3. Add an entry to the registry in `src/game-registry.ts`

## License

[MIT](LICENSE)
