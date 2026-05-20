import { PtyManager } from './pty-manager';
import { TerminalEmulator } from './terminal-emulator';
import { InputRouter } from './input-router';
import { Renderer } from './renderer';
import { GameEngine } from './game-engine';
import { GameMenu } from './games/game-menu';
import { StateMachine } from './state';
import { HighScoreManager } from './high-scores';
import { ConfigManager, ConfigKey } from './config';
import { createGame, findGame, getDefaultGameId } from './game-registry';
import { AppState, StateTransition, IGame, GameRenderState } from './types';
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
  private inMenu = true;
  private currentGameId: string | null = null;
  private lastScoreSubmitted = false;

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
    } else {
      this.gameEngine = new GameEngine(this.gameMenu);
      this.inMenu = true;
    }
  }

  start(): void {
    process.stdout.write(ansi.alternateScreen());
    process.stdout.write(ansi.clearScreen());

    const onSignal = () => this.shutdown(0);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('exit', () => this.cleanup());
    process.on('uncaughtException', (err) => {
      this.cleanup();
      process.stderr.write(`gamecli fatal: ${err.message}\n`);
      process.exit(1);
    });

    process.stdout.on('resize', () => this.onResize());

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    this.ptyManager.spawn(this.options.command, this.options.args, cols, rows);

    const geo = this.renderer.calculateGeometry();
    this.gameEngine.init(geo.rightWidth, geo.height - 1);

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
    if (key === 'quit' || key === 'ctrl-c') {
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
    const game = createGame(gameId);
    this.gameEngine = new GameEngine(game);
    this.currentGameId = gameId;
    this.inMenu = false;
    this.lastScoreSubmitted = false;

    const geo = this.renderer.calculateGeometry();
    this.gameEngine.init(geo.rightWidth, geo.height - 1);
    this.gameEngine.start();
    this.renderer.invalidate();
  }

  private switchToMenu(): void {
    this.checkAndSubmitScore();
    this.gameEngine.stop();
    this.gameMenu.clearSelection();
    this.gameMenu.reset();
    this.gameEngine = new GameEngine(this.gameMenu);
    this.inMenu = true;
    this.currentGameId = null;
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
      return ` N:Menu M:Hide R:New P:Play | ⏸ ${gameState.score}${hiStr}`;
    }
    return ` N:Menu M:Hide ${mod}←→:Size P:Pause | ${gameState.score}${hiStr}`;
  }

  private shutdown(code: number): void {
    this.checkAndSubmitScore();
    this.cleanup();
    process.exit(code);
  }

  private cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    this.inputRouter.stop();
    this.gameEngine.stop();
    if (this.renderTimer) clearInterval(this.renderTimer);
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
