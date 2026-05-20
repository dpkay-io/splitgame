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
  private ipcServer: IpcServer;
  private turnWaiters: Array<(state: CompactGameState | null) => void> = [];
  private claudeOpponent = false;
  private cachedGameInfo: Array<{ id: string; name: string; supportsExternalMoves: boolean }> | null = null;
  private signalHandlersRegistered = false;
  private boundOnSignal: (() => void) | null = null;
  private boundOnExit: (() => void) | null = null;
  private boundOnUncaught: ((err: Error) => void) | null = null;
  private boundOnResize: (() => void) | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

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

    this.emulator = new TerminalEmulator(cols, rows);
    this.renderer = new Renderer(this.emulator, this.configManager.get('gameWidthPercent'));

    this.inputRouter = new InputRouter(
      () => this.onToggle(),
      (data) => this.ptyManager.write(data.toString()),
      (key) => this.onGameInput(key),
      () => this.stateMachine.snapshot.inputFocus,
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
    process.stdout.write(ansi.alternateScreen());
    process.stdout.write(ansi.clearScreen());

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
  }

  private onPtyExit(code: number): void {
    this.stateMachine.transition(StateTransition.CHILD_EXIT);
    this.shutdown(code);
  }

  private onToggle(): void {
    this.stateMachine.transition(StateTransition.TOGGLE);
    this.applyState();
  }

  private onGameInput(key: string): void {
    if (key === 'minimize') {
      this.stateMachine.transition(StateTransition.MINIMIZE);
      this.applyState();
      return;
    }
    if (key === 'pause') {
      if (this.inMenu) return;
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
    if (key === 'reset' && !this.inMenu) {
      this.restartGame();
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

    this.gameEngine.handleInput(key);
    this.checkAndSubmitScore();
    this.notifyTurnWaiters();
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

    const geo = this.renderer.calculateGeometry();
    this.gameEngine.init(geo.rightWidth, geo.height - 1);
    this.gameEngine.start();
    this.renderer.invalidate();
  }

  private switchToMenu(): void {
    this.checkAndSubmitScore();
    this.flushTurnWaiters();
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
      this.highScores.submit(this.currentGameId, state.score);
      this.lastScoreSubmitted = true;
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
        this.gameEngine.pause();
        this.gameEngine.stop();
        this.emulator.resize(cols, rows);
        this.ptyManager.resize(cols, rows);
        process.stdout.write(ansi.clearScreen());
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
    if (this.cleanedUp) return;
    const state = this.stateMachine.state;

    if (state === AppState.GAME_MINIMIZED) {
      if (this.emulator.consumeDirty()) {
        this.renderer.renderFullscreen();
      }
    } else if (state === AppState.GAME_ACTIVE || state === AppState.GAME_PAUSED) {
      const gameState = this.gameEngine.getState();
      const statusBar = this.buildStatusBar(gameState);
      this.renderer.renderSplit(gameState, statusBar);
    }
  }

  private buildStatusBar(gameState: GameRenderState): string {
    if (this.inMenu) {
      return ' Tab: switch sections';
    }

    const mod = this.configManager.get('modifierKey') === 'ctrl' ? '^' : 'M-';
    const hi = this.currentGameId ? this.highScores.getHighScore(this.currentGameId) : 0;
    const hiStr = hi > 0 ? ` Hi:${hi}` : '';

    if (gameState.status === 'gameover') {
      return ` N:Menu R:New | OVER ${gameState.score}${hiStr}`;
    }
    if (gameState.status === 'paused') {
      const toggleLabel = this.toggleKeyLabel();
      return ` ${toggleLabel}: Resume game | ⏸ ${gameState.score}${hiStr}`;
    }
    return ` N:Menu M:Hide ${mod}←→:Size P:Pause | ${gameState.score}${hiStr}`;
  }

  private toggleKeyLabel(): string {
    const key = this.configManager.get('toggleKey');
    if (key === 'esc+esc') return 'Esc+Esc';
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
    process.stdout.write(ansi.resetAttributes());
    process.stdout.write(ansi.showCursor());
    process.stdout.write(ansi.mainScreen());
  }
}
