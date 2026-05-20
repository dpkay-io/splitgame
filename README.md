# splitgame

Play games in a split-terminal overlay alongside your CLI tools. The child process runs on the left; the game renders on the right. Toggle the game panel with a hotkey and get back to work instantly.

## Get Started

```bash
# 1. Install globally
npm install -g splitgame

# 2. One-time setup: auto-launch in every new terminal
splitgame install

# 3. Press F12 to toggle the game panel
```

Every new terminal starts with splitgame in the background — **F12** to play, **F12** to get back to work.

Requires Node.js >= 18. Use `splitgame uninstall` to remove.

## Quick Start (without install)

```bash
# Wrap any command with a game panel
splitgame node server.js
splitgame npm run dev
splitgame python train.py

# Start with a specific game
splitgame -g tetris npm run dev
```

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
| F12 | Toggle game panel (configurable) |
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
splitgame config list                    # Show all settings
splitgame config set toggleKey ctrl+]    # Change toggle key
splitgame config set modifierKey alt     # Change modifier key (ctrl or alt)
splitgame config set gameWidthPercent 60 # Change game panel width (20-80)
splitgame config reset                   # Reset all to defaults
```

### Settings

| Setting | Default | Options |
|---------|---------|---------|
| `toggleKey` | `f12` | `f12`, `esc+esc`, `ctrl+]` |
| `modifierKey` | `ctrl` | `ctrl`, `alt` |
| `gameWidthPercent` | `50` | `20` - `80` |

Settings are stored in `~/.splitgame/config.json`.

## CLI Reference

```bash
splitgame [options] [--] <command> [args...]
splitgame install          # Auto-launch in new terminals
splitgame uninstall        # Remove auto-launch
splitgame config <sub>     # Manage settings
splitgame --list-games     # List available games
splitgame --version        # Show version
splitgame --help           # Show help
```

| Option | Description |
|--------|-------------|
| `-g, --game <id>` | Start with a specific game |
| `-h, --help` | Show help message |
| `-V, --version` | Show version number |
| `--list-games` | List available games |

## Platform Support

### Windows
`splitgame install` patches Windows Terminal's `settings.json` to wrap each profile's command with splitgame. Supports standard profiles, Visual Studio developer prompts, and specialized toolchains. Skips Azure Cloud Shell, WSL, and VS Debug Console.

### Linux / macOS
`splitgame install` appends a guarded auto-launch snippet to your shell profile (`.bashrc`, `.zshrc`, or `config.fish`). Prevents recursion via `SPLITGAME_ACTIVE` env var and skips non-TTY sessions.

Both platforms create backups in `~/.splitgame/backups/` before modifying anything. `splitgame uninstall` restores the original state.

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
