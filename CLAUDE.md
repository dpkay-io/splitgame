# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

splitgame — a Node.js CLI that wraps any command in a split-terminal with a game panel. **Primary target: Claude Code CLI** (`splitgame claude`), but works with any command. The child process runs on the left; the game renders on the right. Toggle key (default: F12) shows/hides the game panel. Starts in minimized mode (fullscreen child terminal). Running `splitgame` with no arguments prints usage help and exits.

**Toggle key choice:** Default is `f12` because it doesn't conflict with Claude Code CLI keybindings. `ctrl+]` is also available. Both are safe — neither conflicts with Claude Code CLI or standard readline shortcuts.

**Available games:** Snake, 2048, Tetris, Tic-Tac-Toe (vs AI or vs Claude), Breakout, Minesweeper, Flappy Bird.

**Key bindings (during gameplay):** Esc=progressive back (pause→menu→hide), M=Menu, X=Hide, R=Restart, P or Ctrl+Space=Pause (focus to CLI), Ctrl+C=Hide, Modifier+←→=Resize panel. Toggle key, modifier key, and game panel width are all configurable.

**Escape key UX:** Esc acts as a context-aware "back" action. Playing → Esc → soft pause (focus stays on game, any gameplay key resumes). Esc-paused → Esc → menu. Menu → Esc → minimize. Game over → Esc → menu. This is separate from P-pause, which transitions to GAME_PAUSED and routes focus to the child terminal for CLI interaction.

**Paused-state focus (P-pause):** When the game is paused via P/Ctrl+Space, input routes to the child terminal (not the game). The game panel remains visible in split view but the user can interact with their CLI. Only the toggle key resumes the game and switches focus back.

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
splitgame config set toggleKey ctrl+]    # change toggle key
splitgame config set modifierKey alt     # change modifier key
splitgame config set gameWidthPercent 60 # change game panel width
splitgame config reset   # reset all to defaults
splitgame mcp-setup      # configure Claude Code MCP integration (one-time)
```

The CLI requires a real TTY — it will refuse to run in piped/redirected contexts or non-TTY terminals (e.g. VS Code integrated terminal). To test manually, use Windows Terminal or a real console.

## Install flow

`splitgame install` auto-configures the user's terminal so every new session launches inside splitgame. Platform-specific:

**Windows:** `TerminalInstaller` (`src/installer.ts`) patches Windows Terminal's `settings.json` to wrap each profile's commandline. PowerShell profiles (`powershell.exe`, `pwsh.exe`) are wrapped natively: `<exe> -NoProfile -Command "splitgame <exe>; if ($LASTEXITCODE -ne 0) { <exe> }"`. All other profiles use `cmd.exe /c splitgame <cmd> || <cmd>` (the `cmd.exe /c` prefix is needed because Windows Terminal uses `CreateProcess` which cannot resolve `.cmd` shims directly). Both formats include a fallback that launches the original shell if splitgame is not installed. For source-based profiles (no explicit `commandline`), it resolves the actual command: VS dev profiles via `vswhere.exe` to find VsDevCmd.bat/DevShell.dll paths, ESP-IDF via `C:\Espressif\esp_idf.json` to find export.bat. Skips only profiles that would genuinely break: Azure Cloud Shell (remote VM), WSL (cross-boundary PTY), and VS Debug Console (programmatic). Hidden profiles, VS dev environments, and specialized toolchains are all included.

**Linux/macOS:** `ShellProfileInstaller` (`src/shell-installer.ts`) appends a guarded auto-launch snippet to the user's shell profile (`.bashrc`, `.zshrc`, or `config.fish`). The snippet checks `SPLITGAME_ACTIVE` env var (set by splitgame's PTY spawn) to prevent recursion, `[ -t 1 ]` / `status is-interactive` to skip non-TTY sessions, and `command -v splitgame` / `command -q splitgame` to gracefully skip if splitgame is not installed.

**Postinstall automation:** The npm `postinstall` hook (`bin/postinstall.js`) auto-configures both the terminal integration and Claude Code MCP server. The MCP setup logic lives in `src/mcp-setup.ts` (shared with the `splitgame mcp-setup` CLI command). Both steps silently ignore failures — the user can always run `splitgame install` or `splitgame mcp-setup` manually.

**Uninstall safety:** An npm `preuninstall` hook (`bin/preuninstall.js`) automatically restores terminal/shell profiles when the package is removed via `npm uninstall`. Both platforms' wrappers also fail-safe — if splitgame is missing, the original shell launches normally.

Both platforms: backs up the original to `~/.splitgame/backups/`, writes an install manifest to `~/.splitgame/install-manifest.json` for idempotency and uninstall. `splitgame uninstall` restores the original state. Backups remain for manual recovery.

**State files:** `~/.splitgame/config.json` (settings), `~/.splitgame/scores.json` (high scores), `~/.splitgame/install-manifest.json` (install state), `~/.splitgame/backups/` (originals), `~/.splitgame/ipc-port` (active IPC port for MCP bridge, transient).

## Architecture

**Data flow:** Two modes depending on game visibility. When minimized (passthrough mode): PTY output → stdout directly (preserves terminal scrollback) + fed to `TerminalEmulator` for state sync. When game is visible: PTY output → `TerminalEmulator` (xterm headless) → `Renderer` → stdout (alternate screen buffer). stdin → `InputRouter` → (child PTY or game) in both modes.

**Screen buffer strategy:** splitgame only uses the alternate screen buffer when the game panel is visible (GAME_ACTIVE or GAME_PAUSED). When the game is minimized (default state), it stays on the main screen buffer with raw PTY passthrough so terminal scrollback works normally. Toggling the game panel switches between main ↔ alternate screen (`?1049h`/`?1049l`).

**Mouse mode strategy:** SGR mouse mode (`?1000h`/`?1006h`) is only enabled when the game panel is visible (GAME_ACTIVE or GAME_PAUSED). When minimized/passthrough, mouse mode is disabled so the terminal retains full native behavior: text selection, copy/paste, right-click context menus, URL clicking, and native scrollback all work normally. Mouse events are only intercepted by `InputRouter` when mouse mode is active (`isMouseIntercepted` callback). This also means child apps that enable their own mouse mode (vim, htop) receive mouse events correctly in minimized mode.

**Scroll handling:** When the game panel is visible, SGR mouse wheel events are parsed in `InputRouter` and routed to `onScroll` in the orchestrator for scrolling the child panel's xterm-headless viewport. When minimized, the terminal's native scrollback handles scrolling directly (since we're on the main screen buffer with direct passthrough).

**Orchestrator** (`src/orchestrator.ts`) is the central coordinator. It owns all components and wires them together. It manages the render loop (33ms interval), signal handling, resize events, screen lifecycle, game selection, and high score submission. Accepts `OrchestratorOptions` with optional `gameId` to skip the menu.

**StateMachine** (`src/state.ts`) governs app state via a transition table. States: `GAME_MINIMIZED` (default) → `GAME_ACTIVE` ↔ `GAME_PAUSED` → `EXITING`. Input focus (`CHILD` vs `GAME`) is derived from state — only `GAME_ACTIVE` routes input to the game. `GAME_PAUSED` keeps the game panel visible but routes input to the child, allowing CLI interaction while paused. Toggle key resumes the game.

**ConfigManager** (`src/config.ts`) persists user settings to `~/.splitgame/config.json`. Configurable: `toggleKey` (f12, ctrl+]), `modifierKey` (ctrl, alt), `gameWidthPercent` (20–80). Default toggle is `f12`. Silently falls back to defaults on missing/corrupt file.

**Install system:** `install-command.ts` dispatches by platform. On Windows, `installer.ts` (`TerminalInstaller`) patches Windows Terminal's `settings.json` profile commandlines. On Linux/macOS, `shell-installer.ts` (`ShellProfileInstaller`) appends a guarded auto-launch snippet to the user's shell profile. Both write a manifest to `~/.splitgame/install-manifest.json` and create backups. `jsonc.ts` parses JSONC (Windows Terminal settings contain comments).

**InputRouter** (`src/input-router.ts`) handles raw stdin. Toggle key is configurable — supports F12 (default) or Ctrl+]. When focus is CHILD, raw bytes go to the PTY. When focus is GAME, bytes are parsed into named keys (arrows, WASD, enter, escape, flag, next-game, resize-left, resize-right, tab, etc.). Standalone Esc (single 0x1b byte) is parsed as `'escape'`. Modifier+arrow keys emit resize commands.

**Renderer** (`src/renderer.ts`) has two modes: `renderFullscreen()` for minimized state (passes through terminal emulator buffer) and `renderSplit()` for game-visible states (left panel = child, vertical border, right panel = game grid, bottom status bar). Game panel width is configurable (20–80% via `gameWidthPercent`). Status bar shows context-aware action hints (keys vary by playing/paused/gameover state). Uses dirty-checking to skip unchanged rows.

**TerminalEmulator** (`src/terminal-emulator.ts`) wraps `@xterm/headless` to parse ANSI output from the child process into a cell grid that the Renderer reads.

**Game system:** `IGame` interface (`src/types.ts`) defines the contract all games implement. `GameEngine` (`src/game-engine.ts`) runs the game tick loop at 16ms. Games produce a `GameRenderState` (2D grid of `GameCell` + score + status) consumed by the Renderer.

**Game Registry** (`src/game-registry.ts`) maps game IDs to constructors. Used by the CLI (`--game` flag), game menu, and orchestrator.

**Game Menu** (`src/games/game-menu.ts`) implements `IGame` as a tabbed in-app menu with three sections: Games (select a game), High Scores (all-games summary), and Config (interactive settings editor). Tab/Shift+Tab switches sections. In Config tab, Up/Down navigates settings, Left/Right cycles values, R resets. Press M during gameplay to return to the menu.

**High Scores** (`src/high-scores.ts`) persists per-game high scores to `~/.splitgame/scores.json`. Top 10 scores per game. High score is shown in the status bar during gameplay.

**MCP Bridge** enables Claude Code to play games with the user. Architecture: splitgame starts an IPC server (`src/ipc-server.ts`, TCP on localhost, random port written to `~/.splitgame/ipc-port`). A separate MCP server (`src/mcp-server.ts`, entry: `bin/mcp-server.js`) is spawned by Claude Code via MCP config and connects to this IPC port. It exposes five tools: `get_game_state` (compact board string + score + turn + valid moves), `make_move` (inject a move into the active game), `wait_for_turn` (long-polls up to 30s until it's Claude's turn — enables seamless auto-play loops), `get_game_info` (list games), and `select_game` (opens the game panel and launches a specific game — allows Claude to start games when none is active). The orchestrator implements a `GameBridge` interface that translates between the game engine and compact IPC state. When an MCP client connects, games that support it (currently Tic-Tac-Toe) switch from AI opponent to "waiting for Claude" mode and the game menu shows a "vs Claude" tag next to supported games. Board state uses a compact string format for token efficiency (e.g., `"XO_|_X_|__O"` for tic-tac-toe). Setup: `splitgame mcp-setup` writes the MCP server config to `~/.claude.json` (for Claude Code) and Claude Desktop's configuration file.

**IGame external move support** (`src/types.ts`): Games can optionally implement `supportsExternalMoves`, `getCompactState()`, `externalMove(move)`, and `setOpponentMode(mode)` to enable MCP-driven play. Only turn-based games are suitable — real-time games (Snake, Tetris, etc.) don't implement these.

## Known issues and incomplete work

- **Unix runtime untested** — uses ConPTY on Windows via node-pty. Unix PTY support exists in code but hasn't been verified at runtime. Shell profile install (`ShellProfileInstaller`) is tested but not on actual Linux/macOS systems.
- **No CI pipeline** or lint setup.
- **No npm publish config** — `package.json` has `bin` and `files` fields ready but no publish workflow.

## Adding a new game

1. Create `src/games/yourgame.ts` implementing `IGame` from `src/types.ts`.
2. `init(width, height)` sets up the board; `tick(deltaMs)` advances state; `getState()` returns a `GameRenderState` with a 2D `GameCell` grid.
3. Add an entry to the `registry` array in `src/game-registry.ts`.
