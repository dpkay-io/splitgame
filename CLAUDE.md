# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

splitgame — a Node.js CLI that wraps any command in a split-terminal with a game panel. The child process runs on the left; the game renders on the right. Toggle key (default: double-tap Escape) shows/hides the game panel. Starts in minimized mode (fullscreen child terminal). Running `splitgame` with no arguments prints usage help and exits.

**Available games:** Snake, 2048, Tetris, Tic-Tac-Toe (vs AI), Breakout, Minesweeper, Flappy Bird.

**Key bindings (during gameplay):** N=Menu, M=Hide, R=Restart, Ctrl+Space=Pause, Modifier+←→=Resize panel. Toggle key, modifier key, and game panel width are all configurable.

## Commands

```bash
npm run build          # tsc → dist/
npm run start          # node bin/splitgame.js
npm test               # vitest run (all tests)
npx vitest run test/state.test.ts   # single test file
splitgame install        # one-time: patch Windows Terminal profiles to auto-launch inside splitgame
splitgame uninstall      # remove the Windows Terminal integration
splitgame --list-games   # show available games
splitgame -g tetris      # start with a specific game
splitgame config list    # show all settings
splitgame config set toggleKey ctrl+g    # change toggle key
splitgame config set modifierKey alt     # change modifier key
splitgame config set gameWidthPercent 60 # change game panel width
splitgame config reset   # reset all to defaults
```

The CLI requires a real TTY — it will refuse to run in piped/redirected contexts or non-TTY terminals (e.g. VS Code integrated terminal). To test manually, use Windows Terminal or a real console.

## Install flow

`splitgame install` auto-configures the user's terminal so every new session launches inside splitgame. Platform-specific:

**Windows:** `TerminalInstaller` (`src/installer.ts`) patches Windows Terminal's `settings.json` to wrap each profile's commandline with `cmd.exe /c splitgame` (the `cmd.exe /c` prefix is required because Windows Terminal uses `CreateProcess` which cannot resolve `.cmd` shims directly). For source-based profiles (no explicit `commandline`), it resolves the actual command: VS dev profiles via `vswhere.exe` to find VsDevCmd.bat/DevShell.dll paths, ESP-IDF via `C:\Espressif\esp_idf.json` to find export.bat. Skips only profiles that would genuinely break: Azure Cloud Shell (remote VM), WSL (cross-boundary PTY), and VS Debug Console (programmatic). Hidden profiles, VS dev environments, and specialized toolchains are all included.

**Linux/macOS:** `ShellProfileInstaller` (`src/shell-installer.ts`) appends a guarded auto-launch snippet to the user's shell profile (`.bashrc`, `.zshrc`, or `config.fish`). The snippet checks `SPLITGAME_ACTIVE` env var (set by splitgame's PTY spawn) to prevent recursion, and `[ -t 1 ]` / `status is-interactive` to skip non-TTY sessions.

Both platforms: backs up the original to `~/.splitgame/backups/`, writes an install manifest to `~/.splitgame/install-manifest.json` for idempotency and uninstall. `splitgame uninstall` restores the original state. Backups remain for manual recovery.

**State files:** `~/.splitgame/config.json` (settings), `~/.splitgame/scores.json` (high scores), `~/.splitgame/install-manifest.json` (install state), `~/.splitgame/backups/` (originals).

## Architecture

**Data flow:** stdin → `InputRouter` → (child PTY or game) | PTY output → `TerminalEmulator` (xterm headless) → `Renderer` → stdout

**Orchestrator** (`src/orchestrator.ts`) is the central coordinator. It owns all components and wires them together. It manages the render loop (33ms interval), signal handling, resize events, screen lifecycle, game selection, and high score submission. Accepts `OrchestratorOptions` with optional `gameId` to skip the menu.

**StateMachine** (`src/state.ts`) governs app state via a transition table. States: `GAME_MINIMIZED` (default) → `GAME_ACTIVE` ↔ `GAME_PAUSED` → `EXITING`. Input focus (`CHILD` vs `GAME`) is derived from state — only `GAME_ACTIVE` routes input to the game.

**ConfigManager** (`src/config.ts`) persists user settings to `~/.splitgame/config.json`. Configurable: `toggleKey` (esc+esc, ctrl+g, ctrl+]), `modifierKey` (ctrl, alt), `gameWidthPercent` (40–80). Silently falls back to defaults on missing/corrupt file.

**Install system:** `install-command.ts` dispatches by platform. On Windows, `installer.ts` (`TerminalInstaller`) patches Windows Terminal's `settings.json` profile commandlines. On Linux/macOS, `shell-installer.ts` (`ShellProfileInstaller`) appends a guarded auto-launch snippet to the user's shell profile. Both write a manifest to `~/.splitgame/install-manifest.json` and create backups. `jsonc.ts` parses JSONC (Windows Terminal settings contain comments).

**InputRouter** (`src/input-router.ts`) handles raw stdin. Toggle key is configurable — supports double-tap Escape (300ms window), Ctrl+G, or Ctrl+]. When focus is CHILD, raw bytes go to the PTY. When focus is GAME, bytes are parsed into named keys (arrows, WASD, enter, flag, next-game, resize-left, resize-right, tab, etc.). Modifier+arrow keys emit resize commands.

**Renderer** (`src/renderer.ts`) has two modes: `renderFullscreen()` for minimized state (passes through terminal emulator buffer) and `renderSplit()` for game-visible states (left panel = child, vertical border, right panel = game grid, bottom status bar). Game panel width is configurable (40–80% via `gameWidthPercent`). Status bar shows context-aware action hints (keys vary by playing/paused/gameover state). Uses dirty-checking to skip unchanged rows.

**TerminalEmulator** (`src/terminal-emulator.ts`) wraps `@xterm/headless` to parse ANSI output from the child process into a cell grid that the Renderer reads.

**Game system:** `IGame` interface (`src/types.ts`) defines the contract all games implement. `GameEngine` (`src/game-engine.ts`) runs the game tick loop at 16ms. Games produce a `GameRenderState` (2D grid of `GameCell` + score + status) consumed by the Renderer.

**Game Registry** (`src/game-registry.ts`) maps game IDs to constructors. Used by the CLI (`--game` flag), game menu, and orchestrator.

**Game Menu** (`src/games/game-menu.ts`) implements `IGame` as a tabbed in-app menu with three sections: Games (select a game), High Scores (all-games summary), and Config (interactive settings editor). Tab/Shift+Tab switches sections. In Config tab, Up/Down navigates settings, Left/Right cycles values, R resets. Press N during gameplay to return to the menu.

**High Scores** (`src/high-scores.ts`) persists per-game high scores to `~/.splitgame/scores.json`. Top 10 scores per game. High score is shown in the status bar during gameplay.

## Known issues and incomplete work

- **Unix runtime untested** — uses ConPTY on Windows via node-pty. Unix PTY support exists in code but hasn't been verified at runtime. Shell profile install (`ShellProfileInstaller`) is tested but not on actual Linux/macOS systems.
- **No CI pipeline** or lint setup.
- **No npm publish config** — `package.json` has `bin` and `files` fields ready but no publish workflow.

## Adding a new game

1. Create `src/games/yourgame.ts` implementing `IGame` from `src/types.ts`.
2. `init(width, height)` sets up the board; `tick(deltaMs)` advances state; `getState()` returns a `GameRenderState` with a 2D `GameCell` grid.
3. Add an entry to the `registry` array in `src/game-registry.ts`.
