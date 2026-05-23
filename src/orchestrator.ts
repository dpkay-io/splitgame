import { PtyManager } from './pty-manager';
import { TerminalEmulator } from './terminal-emulator';
import { InputRouter } from './input-router';
import { Renderer } from './renderer';
import { GameEngine } from './game-engine';
import { GameMenu } from './games/game-menu';
import { StateMachine } from './state';
import { HighScoreManager } from './high-scores';
import { ConfigManager, ConfigKey } from './config';
import { createGame, findGame, getDefaultGameId, getGameList } from './game-registry';
import { AppState, StateTransition, IGame, GameRenderState } from './types';
import { IpcServer, GameBridge, CompactGameState, MoveResult } from './ipc-server';
import * as ansi from './utils/ansi';

export interface OrchestratorOptions {
  command: string;
  args: string[];
  gameId?: string;
}

export class Orchestrator {
  private stateMachine: StateMachine;
  private ptyManager: PtyManager;
  private emulator: TerminalEmulator;
  private renderer: Renderer;
  private inputRouter: InputRouter;
  private gameEngine: GameEngine;
  private gameMenu: GameMenu;
  private highScores: HighScoreManager;
  private configManager: ConfigManager;
  private renderTimer: NodeJS.Timeout | null = null;
  private readonly RENDER_INTERVAL_MS = 33;
  private cleanedUp = false;
  private shuttingDown = false;
  private inMenu = true;
  private currentGameId: string | null = null;
  private lastScoreSubmitted = false;
  private celebrationEndTime = 0;
  private ipcServer: IpcServer;
  private turnWaiters: Array<(state: CompactGameState | null) => void> = [];
  private claudeOpponent = false;
  private cachedGameInfo: Array<{ id: string; name: string; supportsExternalMoves: boolean }> | null = null;
  private passthrough = false;
  private scrolledBack = false;
  private helpVisible = false;
  private signalHandlersRegistered = false;
  private boundOnSignal: (() => void) | null = null;
  private boundOnExit: (() => void) | null = null;
  private boundOnUncaught: ((err: Error) => void) | null = null;
  private boundOnResize: (() => void) | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastToggleTime: number = 0;
  private readonly TOGGLE_DEBOUNCE_MS = 200;

  constructor(private options: OrchestratorOptions, configManager?: ConfigManager) {
    this.stateMachine = new StateMachine();
    this.highScores = new HighScoreManager();
    this.configManager = configManager || new ConfigManager();

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    this.ptyManager = new PtyManager(
      (data) => this.onPtyData(data),
      (code) => this.onPtyExit(code),
    );

    this.emulator = new TerminalEmulator(cols, rows, this.configManager.get('scrollbackLines'));
    this.renderer = new Renderer(this.emulator, this.configManager.get('gameWidthPercent'));

    this.inputRouter = new InputRouter(
      () => this.onToggle(),
      (data) => this.onChildInputData(data),
      (key) => this.onGameInput(key),
      () => this.stateMachine.snapshot.inputFocus,
      (delta) => this.onScroll(delta),
      () => !this.passthrough,
      this.configManager.get('toggleKey'),
      this.configManager.get('modifierKey'),
    );

    this.gameMenu = new GameMenu(
      this.highScores,
      this.configManager,
      (key) => this.onConfigChanged(key),
    );

    if (options.gameId) {
      const game = createGame(options.gameId);
      this.gameEngine = new GameEngine(game);
      this.currentGameId = options.gameId;
      this.inMenu = false;
      this.stateMachine.transition(StateTransition.TOGGLE); // Start visible if game requested
    } else {
      this.gameEngine = new GameEngine(this.gameMenu);
      this.inMenu = true;
    }

    this.ipcServer = new IpcServer(this.createGameBridge(), {
      onConnect: () => this.onMcpClientConnect(),
      onDisconnect: () => this.onMcpClientDisconnect(),
    });
  }

  start(): void {
    if (this.stateMachine.state === AppState.GAME_ACTIVE) {
      process.stdout.write(ansi.alternateScreen());
      process.stdout.write(ansi.clearScreen());
    } else {
      this.passthrough = true;
    }
    if (!this.passthrough) {
      process.stdout.write(ansi.enableMouseMode());
    }

    if (!this.signalHandlersRegistered) {
      this.signalHandlersRegistered = true;
      this.boundOnSignal = () => this.shutdown(0);
      this.boundOnExit = () => this.cleanup();
      this.boundOnUncaught = (err: Error) => {
        this.cleanup();
        process.stderr.write(`splitgame fatal: ${err.message}\n`);
        process.exit(1);
      };
      this.boundOnResize = () => this.onResize();

      process.on('SIGINT', this.boundOnSignal);
      process.on('SIGTERM', this.boundOnSignal);
      process.on('exit', this.boundOnExit);
      process.on('uncaughtException', this.boundOnUncaught);
      process.stdout.on('resize', this.boundOnResize);
    }

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    this.ptyManager.spawn(this.options.command, this.options.args, cols, rows);

    const geo = this.renderer.calculateGeometry();
    this.gameEngine.init(geo.rightWidth, geo.height - 1);

    this.ipcServer.start().catch((err) => {
      process.stderr.write(`splitgame: IPC server failed to start: ${err instanceof Error ? err.message : err}\n`);
    });

    this.inputRouter.start();
    this.startRenderLoop();
  }

  private onPtyData(data: string): void {
    this.emulator.write(data);
    if (this.passthrough && !this.scrolledBack) {
      process.stdout.write(data);
    }
  }

  private onChildInputData(data: Buffer): void {
    if (this.scrolledBack) {
      this.exitScrollback();
    }
    this.ptyManager.write(data.toString());
  }

  private onPtyExit(code: number): void {
    this.stateMachine.transition(StateTransition.CHILD_EXIT);
    this.shutdown(code);
  }

  private onScroll(delta: number): void {
    if (this.stateMachine.state !== AppState.GAME_MINIMIZED) return;

    if (delta < 0) {
      this.emulator.scrollUp(Math.abs(delta));
      this.scrolledBack = true;
      this.emulator.markDirty();
    } else {
      this.emulator.scrollDown(delta);
      if (!this.emulator.isScrolledBack) {
        this.exitScrollback();
      } else {
        this.emulator.markDirty();
      }
    }
  }

  private exitScrollback(): void {
    this.scrolledBack = false;
    this.emulator.scrollToBottom();
    this.emulator.markDirty();
    this.renderer.renderFullscreen();
  }

  private onToggle(): void {
    const now = performance.now();
    if (now - this.lastToggleTime < this.TOGGLE_DEBOUNCE_MS) return;
    this.lastToggleTime = now;
    this.stateMachine.transition(StateTransition.TOGGLE);
    this.applyState();
  }

  private onGameInput(key: string): void {
    if (this.helpVisible) {
      this.helpVisible = false;
      return;
    }
    if (key === 'escape') {
      this.handleEscape();
      return;
    }
    if (key === 'minimize') {
      this.stateMachine.transition(StateTransition.MINIMIZE);
      this.applyState();
      return;
    }
    if (key === 'pause') {
      if (this.inMenu) return;
      if (this.stateMachine.state === AppState.ESC_PAUSED) {
        this.stateMachine.transition(StateTransition.RESUME);
        this.gameEngine.resume();
        return;
      }
      if (this.stateMachine.state === AppState.GAME_ACTIVE) {
        this.stateMachine.transition(StateTransition.MANUAL_PAUSE);
      } else if (this.stateMachine.state === AppState.GAME_PAUSED) {
        this.stateMachine.transition(StateTransition.RESUME);
      }
      this.applyState();
      return;
    }
    if (key === 'ctrl-c') {
      this.stateMachine.transition(StateTransition.MINIMIZE);
      this.applyState();
      return;
    }
    if (key === 'next-game') {
      this.switchToMenu();
      return;
    }
    if (key === 'resize-left' || key === 'resize-right') {
      this.handleResize(key === 'resize-right' ? -5 : 5);
      return;
    }
    if (key === 'help' && !this.inMenu) {
      this.helpVisible = true;
      return;
    }
    if (key === 'reset' && !this.inMenu) {
      this.restartGame();
      return;
    }

    if (this.stateMachine.state === AppState.ESC_PAUSED) {
      const resumeKeys = new Set(['space', 'enter']);
      if (!resumeKeys.has(key)) return;
      this.stateMachine.transition(StateTransition.RESUME);
      this.gameEngine.resume();
      return;
    }

    if (this.inMenu) {
      this.gameMenu.handleInput(key);
      const selected = this.gameMenu.selectedGame;
      if (selected) {
        this.launchGame(selected.id);
      }
      return;
    }

    this.checkAndSubmitScore();
    this.gameEngine.handleInput(key);
    this.checkAndSubmitScore();
    this.notifyTurnWaiters();
  }

  private handleEscape(): void {
    if (this.inMenu) {
      this.stateMachine.transition(StateTransition.MINIMIZE);
      this.applyState();
      return;
    }
    if (this.gameEngine.currentGame.isGameOver()) {
      this.switchToMenu();
      return;
    }
    if (this.stateMachine.state === AppState.ESC_PAUSED) {
      this.switchToMenu();
      return;
    }
    this.gameEngine.pause();
    this.stateMachine.transition(StateTransition.ESC_PAUSE);
  }

  private handleResize(delta: number): void {
    const current = this.configManager.get('gameWidthPercent');
    const next = Math.max(
      ConfigManager.minGameWidth(),
      Math.min(ConfigManager.maxGameWidth(), current + delta),
    );
    if (next === current) return;

    this.configManager.set('gameWidthPercent', next);
    this.applyWidthChange();
  }

  private applyWidthChange(): void {
    const pct = this.configManager.get('gameWidthPercent');
    this.renderer.setGameWidthPercent(pct);
    const geo = this.renderer.updateGeometry();

    const state = this.stateMachine.state;
    if (state === AppState.GAME_ACTIVE || state === AppState.GAME_PAUSED) {
      this.emulator.resize(geo.leftWidth, geo.height);
      this.ptyManager.resize(geo.leftWidth, geo.height);
      this.gameEngine.resize(geo.rightWidth, geo.height - 1);
      process.stdout.write(ansi.clearScreen());
      this.renderer.invalidate();
    }
  }

  private restartGame(): void {
    if (!this.currentGameId) return;
    if (this.stateMachine.state === AppState.ESC_PAUSED) {
      this.stateMachine.transition(StateTransition.RESUME);
    }
    this.celebrationEndTime = 0;
    this.checkAndSubmitScore();
    this.gameEngine.stop();
    const game = createGame(this.currentGameId);
    if (this.claudeOpponent && game.setOpponentMode) {
      game.setOpponentMode('claude');
    }
    this.gameEngine = new GameEngine(game);
    this.lastScoreSubmitted = false;

    const geo = this.renderer.calculateGeometry();
    this.gameEngine.init(geo.rightWidth, geo.height - 1);
    this.gameEngine.start();
    this.renderer.invalidate();
  }

  private onConfigChanged(key: ConfigKey): void {
    switch (key) {
      case 'toggleKey':
        this.inputRouter.setToggleKey(this.configManager.get('toggleKey'));
        break;
      case 'modifierKey':
        this.inputRouter.setModifierKey(this.configManager.get('modifierKey'));
        break;
      case 'gameWidthPercent':
        this.applyWidthChange();
        break;
    }
  }

  private launchGame(gameId: string): void {
    this.gameEngine.stop();
    let game: IGame;
    try {
      game = createGame(gameId);
    } catch (err) {
      process.stderr.write(`splitgame: failed to launch game "${gameId}": ${err instanceof Error ? err.message : err}\n`);
      this.switchToMenu();
      return;
    }
    this.gameEngine = new GameEngine(game);
    this.currentGameId = gameId;
    this.inMenu = false;
    this.claudeOpponent = false;
    this.lastScoreSubmitted = false;
    this.celebrationEndTime = 0;

    const geo = this.renderer.calculateGeometry();
    this.gameEngine.init(geo.rightWidth, geo.height - 1);
    this.gameEngine.start();
    this.renderer.invalidate();
  }

  private switchToMenu(): void {
    if (this.stateMachine.state === AppState.ESC_PAUSED) {
      this.stateMachine.transition(StateTransition.RESUME);
    }
    this.checkAndSubmitScore();
    this.flushTurnWaiters();
    this.helpVisible = false;
    this.gameEngine.stop();
    this.gameMenu.clearSelection();
    this.gameMenu.reset();
    this.gameEngine = new GameEngine(this.gameMenu);
    this.inMenu = true;
    this.currentGameId = null;
    this.claudeOpponent = false;
    this.lastScoreSubmitted = false;

    const geo = this.renderer.calculateGeometry();
    this.gameEngine.init(geo.rightWidth, geo.height - 1);
    this.gameEngine.start();
    this.renderer.invalidate();
  }

  private checkAndSubmitScore(): void {
    if (this.inMenu || !this.currentGameId || this.lastScoreSubmitted) return;
    const state = this.gameEngine.getState();
    if (state.status === 'gameover' && state.score > 0) {
      const isNewHigh = this.highScores.submit(this.currentGameId, state.score);
      this.lastScoreSubmitted = true;
      if (isNewHigh) {
        this.celebrationEndTime = Date.now() + 3000;
      }
    }
  }

  private onResize(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.applyResize();
    }, 50);
  }

  private applyResize(): void {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const state = this.stateMachine.state;
    const geo = this.renderer.updateGeometry();

    if (state === AppState.GAME_MINIMIZED) {
      this.emulator.resize(cols, rows);
      this.ptyManager.resize(cols, rows);
    } else {
      this.emulator.resize(geo.leftWidth, geo.height);
      this.ptyManager.resize(geo.leftWidth, geo.height);
      this.gameEngine.resize(geo.rightWidth, geo.height - 1);
      process.stdout.write(ansi.clearScreen());
    }

    this.renderer.invalidate();
  }

  private applyState(): void {
    const state = this.stateMachine.state;
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const geo = this.renderer.updateGeometry();

    switch (state) {
      case AppState.GAME_ACTIVE:
        if (this.scrolledBack) {
          this.scrolledBack = false;
          this.emulator.scrollToBottom();
        }
        if (this.passthrough) {
          this.passthrough = false;
          process.stdout.write(ansi.enableMouseMode());
          process.stdout.write(ansi.alternateScreen());
        }
        this.emulator.resize(geo.leftWidth, geo.height);
        this.ptyManager.resize(geo.leftWidth, geo.height);
        this.gameEngine.resize(geo.rightWidth, geo.height - 1);
        this.gameEngine.resume();
        this.gameEngine.start();
        this.lastScoreSubmitted = false;
        process.stdout.write(ansi.clearScreen());
        this.renderer.invalidate();
        break;

      case AppState.GAME_PAUSED:
        this.gameEngine.pause();
        break;

      case AppState.GAME_MINIMIZED:
        this.checkAndSubmitScore();
        this.helpVisible = false;
        this.gameEngine.pause();
        this.gameEngine.stop();
        this.emulator.resize(cols, rows);
        this.ptyManager.resize(cols, rows);
        if (!this.passthrough) {
          process.stdout.write(ansi.disableMouseMode());
          process.stdout.write(ansi.mainScreen());
          this.passthrough = true;
        }
        this.renderer.invalidate();
        this.emulator.markDirty();
        break;

      case AppState.EXITING:
        this.shutdown(0);
        break;
    }
  }

  private startRenderLoop(): void {
    this.renderTimer = setInterval(() => {
      this.renderFrame();
    }, this.RENDER_INTERVAL_MS);
  }

  private renderFrame(): void {
    if (this.cleanedUp || this.shuttingDown) return;
    const state = this.stateMachine.state;

    if (state === AppState.GAME_MINIMIZED) {
      if (this.passthrough && !this.scrolledBack) return;
      if (this.emulator.consumeDirty()) {
        this.renderer.renderFullscreen();
      }
    } else if (state === AppState.GAME_ACTIVE || state === AppState.GAME_PAUSED || state === AppState.ESC_PAUSED) {
      this.checkAndSubmitScore();
      const gameState = this.gameEngine.getState();
      if (state === AppState.ESC_PAUSED) {
        this.applyPauseOverlay(gameState);
      }
      if (gameState.status === 'gameover') {
        this.applyGameOverOverlay(gameState);
      }
      if (this.helpVisible) {
        this.applyHelpOverlay(gameState);
      }
      const statusBar = this.buildStatusBar(gameState);
      this.renderer.renderSplit(gameState, statusBar);
    }
  }

  private applyPauseOverlay(gameState: GameRenderState): void {
    const grid = gameState.grid;
    if (grid.length === 0 || grid[0].length === 0) return;

    const dimFg = { mode: 'palette' as const, value: 238 };
    for (const row of grid) {
      for (const cell of row) {
        if (cell.char !== ' ') cell.fg = dimFg;
      }
    }

    const label = '  PAUSED  ';
    const midRow = Math.floor(grid.length / 2);
    const midCol = Math.floor((grid[0].length - label.length) / 2);
    const labelBg = { mode: 'palette' as const, value: 236 };
    const labelFg = { mode: 'palette' as const, value: 15 };
    for (let i = 0; i < label.length; i++) {
      const col = midCol + i;
      if (col >= 0 && col < grid[midRow].length) {
        grid[midRow][col] = { char: label[i], fg: labelFg, bg: labelBg };
      }
    }
  }

  private applyGameOverOverlay(gameState: GameRenderState): void {
    const grid = gameState.grid;
    if (grid.length === 0 || grid[0].length === 0) return;

    const dimFg = { mode: 'palette' as const, value: 238 };
    for (const row of grid) {
      for (const cell of row) {
        if (cell.char !== ' ') cell.fg = dimFg;
      }
    }

    const msg = gameState.statusMessage || 'GAME OVER';
    const labelParts = msg.split(' - ');
    const line1 = labelParts[0].trim();
    const line2 = labelParts.length > 1 ? labelParts[1].trim() : 'R:Restart | Esc:Menu';

    const boxWidth = Math.max(line1.length, line2.length) + 4;
    const midRow = Math.floor(grid.length / 2);
    const midCol = Math.floor((grid[0].length - boxWidth) / 2);
    const labelBg = { mode: 'palette' as const, value: 236 };
    const titleFg = { mode: 'palette' as const, value: 15 };
    const subtitleFg = { mode: 'palette' as const, value: 250 };

    const rows = [midRow - 1, midRow, midRow + 1];
    for (const r of rows) {
      if (r < 0 || r >= grid.length) continue;
      for (let c = midCol; c < midCol + boxWidth && c < grid[r].length; c++) {
        if (c >= 0) grid[r][c] = { char: ' ', fg: titleFg, bg: labelBg };
      }
    }

    const pad1 = Math.floor((boxWidth - line1.length) / 2);
    for (let i = 0; i < line1.length; i++) {
      const col = midCol + pad1 + i;
      if (col >= 0 && midRow - 1 >= 0 && col < grid[midRow - 1].length) {
        grid[midRow - 1][col] = { char: line1[i], fg: titleFg, bg: labelBg };
      }
    }

    const scoreStr = `Score: ${gameState.score}`;
    const pad2 = Math.floor((boxWidth - scoreStr.length) / 2);
    if (midRow >= 0 && midRow < grid.length) {
      for (let i = 0; i < scoreStr.length; i++) {
        const col = midCol + pad2 + i;
        if (col >= 0 && col < grid[midRow].length) {
          grid[midRow][col] = { char: scoreStr[i], fg: subtitleFg, bg: labelBg };
        }
      }
    }

    const pad3 = Math.floor((boxWidth - line2.length) / 2);
    if (midRow + 1 >= 0 && midRow + 1 < grid.length) {
      for (let i = 0; i < line2.length; i++) {
        const col = midCol + pad3 + i;
        if (col >= 0 && col < grid[midRow + 1].length) {
          grid[midRow + 1][col] = { char: line2[i], fg: subtitleFg, bg: labelBg };
        }
      }
    }
  }

  private applyHelpOverlay(gameState: GameRenderState): void {
    const grid = gameState.grid;
    if (grid.length === 0 || grid[0].length === 0) return;

    const dimFg = { mode: 'palette' as const, value: 238 };
    for (const row of grid) {
      for (const cell of row) {
        if (cell.char !== ' ') cell.fg = dimFg;
      }
    }

    const lines = [
      '┌──── CONTROLS ─────┐',
      '│ Esc    Pause/Back  │',
      '│ M      Menu        │',
      '│ R      Restart     │',
      '│ P      Pause (CLI) │',
      '│ X      Hide panel  │',
      '│ H      This help   │',
      '│ F      Flag (Mine) │',
      '│ ↑↓←→   Move        │',
      '│ Space  Action      │',
      '│                    │',
      '│ Any key to close   │',
      '└────────────────────┘',
    ];

    const boxBg = { mode: 'palette' as const, value: 236 };
    const boxFg = { mode: 'palette' as const, value: 15 };
    const startRow = Math.max(0, Math.floor((grid.length - lines.length) / 2));

    for (let i = 0; i < lines.length; i++) {
      const row = startRow + i;
      if (row >= grid.length) break;
      const line = lines[i];
      const startCol = Math.max(0, Math.floor((grid[0].length - line.length) / 2));
      for (let j = 0; j < line.length; j++) {
        const col = startCol + j;
        if (col >= grid[row].length) break;
        grid[row][col] = { char: line[j], fg: boxFg, bg: boxBg };
      }
    }
  }

  private buildStatusBar(gameState: GameRenderState): string {
    const toggle = this.toggleKeyLabel();
    if (this.inMenu) {
      return ` ↑↓:Select | Enter:Play | Tab:Switch | Esc:Hide | ${toggle}`;
    }

    const hi = this.currentGameId ? this.highScores.getHighScore(this.currentGameId) : 0;
    const hiStr = hi > 0 ? ` Hi:${hi}` : '';

    if (gameState.status === 'gameover') {
      if (Date.now() < this.celebrationEndTime) {
        return ` ★ NEW HIGH SCORE! ★  ${gameState.score}`;
      }
      return ` Esc,M:Menu | R:New | ${toggle}:Hide | OVER ${gameState.score}${hiStr}`;
    }
    if (gameState.status === 'paused') {
      if (this.stateMachine.state === AppState.ESC_PAUSED) {
        return ` Esc:Menu | P:Resume | ${toggle}:Hide | ⏸  ${gameState.score}${hiStr}`;
      }
      return ` Focus: Terminal | ${toggle}:Resume | ⏸  ${gameState.score}${hiStr}`;
    }
    const modLabel = this.configManager.get('modifierKey') === 'ctrl' ? 'Ctrl' : 'Alt';
    return ` Esc:Pause | M:Menu | ${toggle}:Hide | ${modLabel}+←→:Resize | ${gameState.score}${hiStr}`;
  }

  private toggleKeyLabel(): string {
    const key = this.configManager.get('toggleKey');
    if (key === 'f12') return 'F12';
    return 'Ctrl+]';
  }

  private shutdown(code: number): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.checkAndSubmitScore();
    this.flushTurnWaiters();
    this.cleanup();
    process.exit(code);
  }

  private onMcpClientConnect(): void {
    this.gameMenu.setClaudeConnected(true);
  }

  private onMcpClientDisconnect(): void {
    if (this.claudeOpponent) {
      const game = this.gameEngine.currentGame;
      if (game.setOpponentMode) game.setOpponentMode('ai');
      this.claudeOpponent = false;
    }
    this.gameMenu.setClaudeConnected(false);
  }

  private notifyTurnWaiters(): void {
    if (this.turnWaiters.length === 0) return;
    const state = this.buildCompactState();
    if (!state) return;
    const isClaudeTurn = state.turn === 'claude';
    const isGameOver = state.status === 'gameover';
    if (!isClaudeTurn && !isGameOver) return;

    const waiters = this.turnWaiters.splice(0);
    for (const cb of waiters) cb(state);
  }

  private flushTurnWaiters(): void {
    const waiters = this.turnWaiters.splice(0);
    if (waiters.length === 0) return;
    const ended: CompactGameState = {
      game: 'none', board: '', score: 0, status: 'ended',
      turn: null, validMoves: [], message: 'Game ended - player returned to menu',
    };
    for (const cb of waiters) cb(ended);
  }

  private buildCompactState(): CompactGameState | null {
    if (this.inMenu) return null;
    const game = this.gameEngine.currentGame;
    const renderState = this.gameEngine.getState();

    let board = '';
    let validMoves: string[] = [];
    let turn: 'player' | 'claude' | null = null;

    if (game.getCompactState) {
      const compact = game.getCompactState();
      board = compact.board;
      validMoves = compact.validMoves;
      turn = compact.turn === 'external' ? 'claude' : compact.turn;
    }

    return {
      game: this.currentGameId || 'unknown',
      board,
      score: renderState.score,
      status: turn === 'claude' ? 'waiting_for_claude' : renderState.status,
      turn,
      validMoves,
      message: renderState.statusMessage,
    };
  }

  private createGameBridge(): GameBridge {
    return {
      getGameState: (): CompactGameState | null => {
        return this.buildCompactState();
      },

      makeMove: (move: string): MoveResult => {
        if (this.inMenu) return { success: false, error: 'No active game' };
        const game = this.gameEngine.currentGame;
        if (!game.externalMove) return { success: false, error: 'Game does not support external moves' };

        const ok = game.externalMove(move);
        if (!ok) return { success: false, error: 'Invalid move' };

        this.checkAndSubmitScore();
        const state = this.buildCompactState();
        if (!state) return { success: false, error: 'No active game' };
        return { success: true, state };
      },

      getAvailableGames: () => {
        if (!this.cachedGameInfo) {
          this.cachedGameInfo = getGameList().map(g => {
            const instance = createGame(g.id);
            return {
              id: g.id,
              name: g.name,
              supportsExternalMoves: !!instance.supportsExternalMoves,
            };
          });
        }
        return this.cachedGameInfo;
      },

      getCurrentGame: () => this.currentGameId,

      selectGame: (gameId: string) => {
        const gameInfo = findGame(gameId);
        if (!gameInfo) return { success: false, error: `Unknown game: ${gameId}` };

        if (!this.inMenu && this.currentGameId === gameId && this.claudeOpponent) {
          return { success: true, state: this.buildCompactState() || undefined };
        }

        const appState = this.stateMachine.state;
        if (appState === AppState.GAME_MINIMIZED) {
          this.stateMachine.transition(StateTransition.TOGGLE);
          this.applyState();
        } else if (appState === AppState.GAME_PAUSED) {
          this.stateMachine.transition(StateTransition.TOGGLE);
          this.applyState();
        }

        this.launchGame(gameInfo.id);
        this.claudeOpponent = true;
        const game = this.gameEngine.currentGame;
        if (game.setOpponentMode) game.setOpponentMode('claude');
        return { success: true, state: this.buildCompactState() || undefined };
      },

      waitForTurn: (timeoutMs: number): Promise<CompactGameState | null> => {
        const current = this.buildCompactState();
        if (current && (current.turn === 'claude' || current.status === 'gameover')) {
          return Promise.resolve(current);
        }

        return new Promise((resolve) => {
          let settled = false;
          const cb = (state: CompactGameState | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(state);
          };
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            const idx = this.turnWaiters.indexOf(cb);
            if (idx >= 0) this.turnWaiters.splice(idx, 1);
            resolve(null);
          }, timeoutMs);
          this.turnWaiters.push(cb);
        });
      },
    };
  }

  destroy(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }

    if (this.signalHandlersRegistered) {
      this.signalHandlersRegistered = false;
      if (this.boundOnSignal) {
        process.removeListener('SIGINT', this.boundOnSignal);
        process.removeListener('SIGTERM', this.boundOnSignal);
      }
      if (this.boundOnExit) process.removeListener('exit', this.boundOnExit);
      if (this.boundOnUncaught) process.removeListener('uncaughtException', this.boundOnUncaught);
      if (this.boundOnResize) process.stdout.removeListener('resize', this.boundOnResize);
    }

    this.ipcServer.stop();
    this.inputRouter.stop();
    this.gameEngine.stop();
    this.ptyManager.kill();
    this.emulator.dispose();

    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch {}
    }
    process.stdout.write(ansi.disableMouseMode());
    process.stdout.write(ansi.resetAttributes());
    process.stdout.write(ansi.showCursor());
    if (!this.passthrough) {
      process.stdout.write(ansi.mainScreen());
    }
  }
}
