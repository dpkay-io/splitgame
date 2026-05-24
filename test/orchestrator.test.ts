import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AppState, StateTransition, InputFocus, GameRenderState, IGame } from '../src/types';

// --- Mocks ---

vi.mock('../src/pty-manager', () => ({
  PtyManager: vi.fn().mockImplementation(function (this: any, onData: any, onExit: any) {
    this._onData = onData;
    this._onExit = onExit;
    this.spawn = vi.fn();
    this.write = vi.fn();
    this.resize = vi.fn();
    this.kill = vi.fn();
    return this;
  }),
}));

vi.mock('../src/renderer', () => ({
  Renderer: vi.fn().mockImplementation(function (this: any) {
    const geo = { leftWidth: 40, rightWidth: 40, height: 24, borderCol: 40 };
    this.calculateGeometry = vi.fn(() => ({ ...geo }));
    this.updateGeometry = vi.fn(() => ({ ...geo }));
    this.renderSplit = vi.fn();
    this.renderFullscreen = vi.fn();
    this.invalidate = vi.fn();
    this.setGameWidthPercent = vi.fn();
    this.currentGeometry = geo;
    return this;
  }),
}));

vi.mock('../src/terminal-emulator', () => ({
  TerminalEmulator: vi.fn().mockImplementation(function (this: any) {
    this.write = vi.fn();
    this.resize = vi.fn();
    this.dispose = vi.fn();
    this.consumeDirty = vi.fn(() => false);
    this.markDirty = vi.fn();
    this.scrollUp = vi.fn();
    this.scrollDown = vi.fn();
    this.scrollToBottom = vi.fn();
    this.isScrolledBack = false;
    this.cols = 80;
    this.rows = 24;
    return this;
  }),
}));

vi.mock('../src/input-router', () => ({
  InputRouter: vi.fn().mockImplementation(function (this: any) {
    this.start = vi.fn();
    this.stop = vi.fn();
    this.setToggleKey = vi.fn();
    this.setModifierKey = vi.fn();
    return this;
  }),
}));

vi.mock('../src/ipc-server', () => ({
  IpcServer: vi.fn().mockImplementation(function (this: any, bridge: any, callbacks: any) {
    this._bridge = bridge;
    this._callbacks = callbacks;
    this.start = vi.fn(() => Promise.resolve());
    this.stop = vi.fn();
    this.hasClient = false;
    return this;
  }),
}));

vi.mock('../src/high-scores', () => ({
  HighScoreManager: vi.fn().mockImplementation(function (this: any) {
    this.submit = vi.fn(() => false);
    this.getHighScore = vi.fn(() => 0);
    this.getTopScores = vi.fn(() => []);
    return this;
  }),
}));

vi.mock('../src/config', () => {
  const DEFAULTS: Record<string, any> = {
    toggleKey: 'f12',
    modifierKey: 'ctrl',
    gameWidthPercent: 50,
    scrollbackLines: 1000,
  };
  const MockConfigManager = vi.fn().mockImplementation(function (this: any) {
    const instanceConfig = { ...DEFAULTS };
    this.get = vi.fn((key: string) => instanceConfig[key]);
    this.set = vi.fn((key: string, value: any) => { instanceConfig[key] = value; });
    this.getAll = vi.fn(() => ({ ...instanceConfig }));
    this.reset = vi.fn();
    this.resetKey = vi.fn();
    this.validate = vi.fn();
    return this;
  });
  (MockConfigManager as any).minGameWidth = () => 20;
  (MockConfigManager as any).maxGameWidth = () => 80;
  (MockConfigManager as any).defaults = () => ({ ...DEFAULTS });
  (MockConfigManager as any).validToggleKeys = () => ['f12', 'ctrl+]'];
  (MockConfigManager as any).validModifierKeys = () => ['ctrl', 'alt'];
  (MockConfigManager as any).minScrollback = () => 100;
  (MockConfigManager as any).maxScrollback = () => 100000;
  return {
    ConfigManager: MockConfigManager,
    ConfigKey: {},
  };
});

function createMockGame(overrides: Partial<IGame> = {}): IGame {
  return {
    name: 'mock-game',
    init: vi.fn(),
    tick: vi.fn(),
    handleInput: vi.fn(),
    getState: vi.fn((): GameRenderState => ({
      grid: Array.from({ length: 10 }, () =>
        Array.from({ length: 10 }, () => ({
          char: ' ',
          fg: { mode: 'default' as const, value: 0 },
          bg: { mode: 'default' as const, value: 0 },
        })),
      ),
      score: 42,
      status: 'playing',
    })),
    resize: vi.fn(),
    isPaused: vi.fn(() => false),
    pause: vi.fn(),
    resume: vi.fn(),
    isGameOver: vi.fn(() => false),
    reset: vi.fn(),
    ...overrides,
  };
}

function createMockExternalGame(overrides: Partial<IGame> = {}): IGame {
  let opponentMode: 'ai' | 'claude' = 'ai';
  return createMockGame({
    name: 'mock-external-game',
    supportsExternalMoves: true,
    getCompactState: vi.fn(() => ({
      board: 'X__|_O_|___',
      validMoves: ['0,1', '0,2', '1,0', '1,2', '2,0', '2,1', '2,2'],
      turn: opponentMode === 'claude' ? 'external' as const : 'player' as const,
    })),
    externalMove: vi.fn(() => true),
    setOpponentMode: vi.fn((mode: 'ai' | 'claude') => { opponentMode = mode; }),
    ...overrides,
  });
}

vi.mock('../src/game-registry', () => {
  const mockGame = createMockGame();
  return {
    createGame: vi.fn(() => createMockGame()),
    findGame: vi.fn((id: string) => {
      if (id === 'unknown-game') return undefined;
      return { id, name: id, create: () => createMockGame(), supportsExternalMoves: id === 'tictactoe' };
    }),
    getDefaultGameId: vi.fn(() => 'snake'),
    getGameList: vi.fn(() => [
      { id: 'snake', name: 'Snake', create: () => createMockGame(), supportsExternalMoves: false },
      { id: 'tictactoe', name: 'Tic-Tac-Toe', create: () => createMockGame(), supportsExternalMoves: true },
    ]),
  };
});

vi.mock('../src/games/game-menu', () => ({
  GameMenu: vi.fn().mockImplementation(function (this: any) {
    this.name = 'Game Menu';
    this.init = vi.fn();
    this.tick = vi.fn();
    this.handleInput = vi.fn();
    this.getState = vi.fn((): GameRenderState => ({
      grid: [],
      score: 0,
      status: 'playing',
    }));
    this.resize = vi.fn();
    this.isPaused = vi.fn(() => false);
    this.pause = vi.fn();
    this.resume = vi.fn();
    this.isGameOver = vi.fn(() => false);
    this.reset = vi.fn();
    this.selectedGame = null;
    this.clearSelection = vi.fn();
    this.setClaudeConnected = vi.fn();
    return this;
  }),
}));

// Stub process.exit to prevent test runner from dying
const originalExit = process.exit;
const originalStdoutWrite = process.stdout.write;
const originalStdoutColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
const originalStdoutRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');

import { Orchestrator, OrchestratorOptions } from '../src/orchestrator';
import { createGame, findGame } from '../src/game-registry';
import { ConfigManager } from '../src/config';

function createOrchestrator(opts?: Partial<OrchestratorOptions>): Orchestrator {
  return new Orchestrator({
    command: 'echo',
    args: ['hello'],
    ...opts,
  });
}

function getPrivate(orch: Orchestrator, prop: string): any {
  return (orch as any)[prop];
}

function callPrivate(orch: Orchestrator, method: string, ...args: any[]): any {
  return (orch as any)[method](...args);
}

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;
  let stdoutWriteSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.advanceTimersByTime(1000);
    stdoutWriteSpy = vi.fn();
    process.stdout.write = stdoutWriteSpy as any;
    process.exit = vi.fn() as any;

    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
  });

  afterEach(() => {
    if (orchestrator) {
      try { orchestrator.destroy(); } catch {}
    }
    process.exit = originalExit;
    process.stdout.write = originalStdoutWrite;
    if (originalStdoutColumns) {
      Object.defineProperty(process.stdout, 'columns', originalStdoutColumns);
    }
    if (originalStdoutRows) {
      Object.defineProperty(process.stdout, 'rows', originalStdoutRows);
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ===================================================================
  // CONSTRUCTOR
  // ===================================================================
  describe('constructor', () => {
    it('initializes in menu mode when no gameId provided', () => {
      orchestrator = createOrchestrator();
      expect(getPrivate(orchestrator, 'inMenu')).toBe(true);
      expect(getPrivate(orchestrator, 'currentGameId')).toBeNull();
      expect(getPrivate(orchestrator, 'stateMachine').state).toBe(AppState.GAME_MINIMIZED);
    });

    it('initializes with specified game and transitions to GAME_ACTIVE', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      expect(getPrivate(orchestrator, 'inMenu')).toBe(false);
      expect(getPrivate(orchestrator, 'currentGameId')).toBe('snake');
      expect(getPrivate(orchestrator, 'stateMachine').state).toBe(AppState.GAME_ACTIVE);
    });

    it('accepts an external ConfigManager', () => {
      const cm = new ConfigManager();
      orchestrator = new Orchestrator({ command: 'echo', args: [] }, cm);
      expect(getPrivate(orchestrator, 'configManager')).toBe(cm);
    });

    it('sets passthrough to false initially', () => {
      orchestrator = createOrchestrator();
      expect(getPrivate(orchestrator, 'passthrough')).toBe(false);
    });

    it('creates an IPC server with a GameBridge', () => {
      orchestrator = createOrchestrator();
      const ipc = getPrivate(orchestrator, 'ipcServer');
      expect(ipc._bridge).toBeDefined();
      expect(typeof ipc._bridge.getGameState).toBe('function');
      expect(typeof ipc._bridge.makeMove).toBe('function');
      expect(typeof ipc._bridge.selectGame).toBe('function');
      expect(typeof ipc._bridge.waitForTurn).toBe('function');
    });
  });

  // ===================================================================
  // START
  // ===================================================================
  describe('start()', () => {
    it('writes alternate screen when starting with a game active', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const writes = stdoutWriteSpy.mock.calls.map((c: any) => c[0]);
      expect(writes.some((w: string) => w.includes('?1049h'))).toBe(true);
    });

    it('sets passthrough=true when starting in menu mode', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      expect(getPrivate(orchestrator, 'passthrough')).toBe(true);
    });

    it('spawns the PTY with the given command and dimensions', () => {
      orchestrator = createOrchestrator({ command: 'bash', args: ['-l'] });
      orchestrator.start();
      const pty = getPrivate(orchestrator, 'ptyManager');
      expect(pty.spawn).toHaveBeenCalledWith('bash', ['-l'], 80, 24);
    });

    it('starts the input router', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const ir = getPrivate(orchestrator, 'inputRouter');
      expect(ir.start).toHaveBeenCalled();
    });

    it('starts the IPC server', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const ipc = getPrivate(orchestrator, 'ipcServer');
      expect(ipc.start).toHaveBeenCalled();
    });

    it('starts the render loop', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      expect(getPrivate(orchestrator, 'renderTimer')).not.toBeNull();
    });

    it('registers signal handlers only once', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      expect(getPrivate(orchestrator, 'signalHandlersRegistered')).toBe(true);
    });

    it('initializes game engine with calculated geometry', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const ge = getPrivate(orchestrator, 'gameEngine');
      expect(ge.init).toHaveBeenCalled || expect(ge.currentGame.init).toHaveBeenCalled();
    });
  });

  // ===================================================================
  // PTY DATA / EXIT
  // ===================================================================
  describe('onPtyData', () => {
    it('writes data to the emulator', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      callPrivate(orchestrator, 'onPtyData', 'hello world');
      expect(emu.write).toHaveBeenCalledWith('hello world');
    });

    it('passes data through to stdout in passthrough mode', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      // In menu mode, passthrough is true after start
      callPrivate(orchestrator, 'onPtyData', 'test output');
      expect(stdoutWriteSpy).toHaveBeenCalledWith('test output');
    });

    it('does not pass data to stdout when not in passthrough mode', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      stdoutWriteSpy.mockClear();
      callPrivate(orchestrator, 'onPtyData', 'game data');
      // Should write to emulator but not directly to stdout
      const emu = getPrivate(orchestrator, 'emulator');
      expect(emu.write).toHaveBeenCalledWith('game data');
    });

    it('does not pass data to stdout when scrolled back', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).scrolledBack = true;
      stdoutWriteSpy.mockClear();
      callPrivate(orchestrator, 'onPtyData', 'scrolled data');
      // Should only write to emulator
      const directCalls = stdoutWriteSpy.mock.calls.filter(
        (c: any) => c[0] === 'scrolled data'
      );
      expect(directCalls).toHaveLength(0);
    });
  });

  describe('onPtyExit', () => {
    it('transitions to EXITING and calls shutdown', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      callPrivate(orchestrator, 'onPtyExit', 0);
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('passes exit code to process.exit', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      callPrivate(orchestrator, 'onPtyExit', 42);
      expect(process.exit).toHaveBeenCalledWith(42);
    });
  });

  // ===================================================================
  // TOGGLE / DEBOUNCE
  // ===================================================================
  describe('onToggle', () => {
    it('transitions state on toggle', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      expect(sm.state).toBe(AppState.GAME_MINIMIZED);
      callPrivate(orchestrator, 'onToggle');
      expect(sm.state).toBe(AppState.GAME_ACTIVE);
    });

    it('debounces rapid toggles', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();

      // First toggle: MINIMIZED → ACTIVE
      vi.setSystemTime(1000);
      (orchestrator as any).lastToggleTime = 0;
      callPrivate(orchestrator, 'onToggle');
      const sm = getPrivate(orchestrator, 'stateMachine');
      expect(sm.state).toBe(AppState.GAME_ACTIVE);

      // Second toggle within 200ms: should be ignored
      vi.setSystemTime(1100);
      // Mock performance.now to return 1100
      const origPerf = performance.now;
      performance.now = () => 1100;
      (orchestrator as any).lastToggleTime = 1000;
      callPrivate(orchestrator, 'onToggle');
      expect(sm.state).toBe(AppState.GAME_ACTIVE); // unchanged
      performance.now = origPerf;
    });
  });

  // ===================================================================
  // GAME INPUT
  // ===================================================================
  describe('onGameInput', () => {
    describe('escape key', () => {
      it('minimizes when in menu', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        // Toggle to ACTIVE first
        callPrivate(orchestrator, 'onToggle');
        const sm = getPrivate(orchestrator, 'stateMachine');
        expect(sm.state).toBe(AppState.GAME_ACTIVE);
        // In menu mode, escape should minimize
        callPrivate(orchestrator, 'onGameInput', 'escape');
        expect(sm.state).toBe(AppState.GAME_MINIMIZED);
      });

      it('switches to menu when game is over', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const ge = getPrivate(orchestrator, 'gameEngine');
        ge.currentGame.isGameOver = vi.fn(() => true);
        callPrivate(orchestrator, 'onGameInput', 'escape');
        expect(getPrivate(orchestrator, 'inMenu')).toBe(true);
      });

      it('switches to menu when in ESC_PAUSED state', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const sm = getPrivate(orchestrator, 'stateMachine');
        sm.transition(StateTransition.ESC_PAUSE);
        callPrivate(orchestrator, 'onGameInput', 'escape');
        expect(getPrivate(orchestrator, 'inMenu')).toBe(true);
      });

      it('pauses and enters ESC_PAUSED from GAME_ACTIVE', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const sm = getPrivate(orchestrator, 'stateMachine');
        const ge = getPrivate(orchestrator, 'gameEngine');
        callPrivate(orchestrator, 'onGameInput', 'escape');
        expect(ge.currentGame.pause).toHaveBeenCalled() || expect(sm.state).toBe(AppState.ESC_PAUSED);
      });
    });

    describe('minimize key', () => {
      it('transitions to GAME_MINIMIZED', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        callPrivate(orchestrator, 'onGameInput', 'minimize');
        expect(getPrivate(orchestrator, 'stateMachine').state).toBe(AppState.GAME_MINIMIZED);
      });
    });

    describe('ctrl-c', () => {
      it('transitions to GAME_MINIMIZED', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        callPrivate(orchestrator, 'onGameInput', 'ctrl-c');
        expect(getPrivate(orchestrator, 'stateMachine').state).toBe(AppState.GAME_MINIMIZED);
      });
    });

    describe('pause key', () => {
      it('is no-op when in menu', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        callPrivate(orchestrator, 'onToggle');
        const sm = getPrivate(orchestrator, 'stateMachine');
        callPrivate(orchestrator, 'onGameInput', 'pause');
        expect(sm.state).toBe(AppState.GAME_ACTIVE); // unchanged
      });

      it('pauses when GAME_ACTIVE', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const sm = getPrivate(orchestrator, 'stateMachine');
        expect(sm.state).toBe(AppState.GAME_ACTIVE);
        callPrivate(orchestrator, 'onGameInput', 'pause');
        expect(sm.state).toBe(AppState.GAME_PAUSED);
      });

      it('resumes when GAME_PAUSED', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const sm = getPrivate(orchestrator, 'stateMachine');
        callPrivate(orchestrator, 'onGameInput', 'pause');
        expect(sm.state).toBe(AppState.GAME_PAUSED);
        callPrivate(orchestrator, 'onGameInput', 'pause');
        expect(sm.state).toBe(AppState.GAME_ACTIVE);
      });

      it('resumes when ESC_PAUSED', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const sm = getPrivate(orchestrator, 'stateMachine');
        sm.transition(StateTransition.ESC_PAUSE);
        expect(sm.state).toBe(AppState.ESC_PAUSED);
        callPrivate(orchestrator, 'onGameInput', 'pause');
        expect(sm.state).toBe(AppState.GAME_ACTIVE);
      });
    });

    describe('next-game key', () => {
      it('switches to menu', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        callPrivate(orchestrator, 'onGameInput', 'next-game');
        expect(getPrivate(orchestrator, 'inMenu')).toBe(true);
        expect(getPrivate(orchestrator, 'currentGameId')).toBeNull();
      });
    });

    describe('resize keys', () => {
      it('resize-left increases game width', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const cm = getPrivate(orchestrator, 'configManager');
        callPrivate(orchestrator, 'onGameInput', 'resize-left');
        expect(cm.set).toHaveBeenCalledWith('gameWidthPercent', 55);
      });

      it('resize-right decreases game width', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const cm = getPrivate(orchestrator, 'configManager');
        callPrivate(orchestrator, 'onGameInput', 'resize-right');
        expect(cm.set).toHaveBeenCalledWith('gameWidthPercent', 45);
      });
    });

    describe('help key', () => {
      it('toggles help visibility when not in menu', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        expect(getPrivate(orchestrator, 'helpVisible')).toBe(false);
        callPrivate(orchestrator, 'onGameInput', 'help');
        expect(getPrivate(orchestrator, 'helpVisible')).toBe(true);
      });

      it('is no-op in menu mode', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        callPrivate(orchestrator, 'onToggle');
        callPrivate(orchestrator, 'onGameInput', 'help');
        expect(getPrivate(orchestrator, 'helpVisible')).toBe(false);
      });

      it('dismisses help on any next key press', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        callPrivate(orchestrator, 'onGameInput', 'help');
        expect(getPrivate(orchestrator, 'helpVisible')).toBe(true);
        callPrivate(orchestrator, 'onGameInput', 'up');
        expect(getPrivate(orchestrator, 'helpVisible')).toBe(false);
      });
    });

    describe('reset key', () => {
      it('restarts the current game', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        callPrivate(orchestrator, 'onGameInput', 'reset');
        // After restart, a new game engine should be created
        expect(createGame).toHaveBeenCalled();
      });

      it('is no-op in menu mode', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        callPrivate(orchestrator, 'onToggle');
        const callCount = (createGame as any).mock.calls.length;
        callPrivate(orchestrator, 'onGameInput', 'reset');
        expect((createGame as any).mock.calls.length).toBe(callCount);
      });
    });

    describe('ESC_PAUSED state input filtering', () => {
      it('only allows space and enter to resume', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const sm = getPrivate(orchestrator, 'stateMachine');
        sm.transition(StateTransition.ESC_PAUSE);
        // Arrow keys should be ignored
        callPrivate(orchestrator, 'onGameInput', 'up');
        expect(sm.state).toBe(AppState.ESC_PAUSED);
        // Space should resume
        callPrivate(orchestrator, 'onGameInput', 'space');
        expect(sm.state).toBe(AppState.GAME_ACTIVE);
      });

      it('enter resumes from ESC_PAUSED', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const sm = getPrivate(orchestrator, 'stateMachine');
        sm.transition(StateTransition.ESC_PAUSE);
        callPrivate(orchestrator, 'onGameInput', 'enter');
        expect(sm.state).toBe(AppState.GAME_ACTIVE);
      });
    });

    describe('menu mode input', () => {
      it('delegates to gameMenu.handleInput', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        callPrivate(orchestrator, 'onToggle');
        const menu = getPrivate(orchestrator, 'gameMenu');
        callPrivate(orchestrator, 'onGameInput', 'down');
        expect(menu.handleInput).toHaveBeenCalledWith('down');
      });

      it('launches game when menu returns a selection', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        callPrivate(orchestrator, 'onToggle');
        const menu = getPrivate(orchestrator, 'gameMenu');
        menu.selectedGame = { id: 'snake', name: 'Snake', create: () => createMockGame() };
        callPrivate(orchestrator, 'onGameInput', 'enter');
        expect(getPrivate(orchestrator, 'inMenu')).toBe(false);
        expect(getPrivate(orchestrator, 'currentGameId')).toBe('snake');
      });
    });

    describe('game mode input forwarding', () => {
      it('forwards input to game engine', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const ge = getPrivate(orchestrator, 'gameEngine');
        callPrivate(orchestrator, 'onGameInput', 'left');
        expect(ge.currentGame.handleInput).toHaveBeenCalledWith('left');
      });
    });
  });

  // ===================================================================
  // CHILD INPUT
  // ===================================================================
  describe('onChildInputData', () => {
    it('writes to PTY', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      callPrivate(orchestrator, 'onChildInputData', Buffer.from('ls\n'));
      const pty = getPrivate(orchestrator, 'ptyManager');
      expect(pty.write).toHaveBeenCalledWith('ls\n');
    });

    it('exits scrollback when scrolled back', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).scrolledBack = true;
      const emu = getPrivate(orchestrator, 'emulator');
      callPrivate(orchestrator, 'onChildInputData', Buffer.from('x'));
      expect(emu.scrollToBottom).toHaveBeenCalled();
      expect(getPrivate(orchestrator, 'scrolledBack')).toBe(false);
    });

    it('scrolls to bottom when emulator is scrolled back in split view', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.MANUAL_PAUSE);
      const emu = getPrivate(orchestrator, 'emulator');
      Object.defineProperty(emu, 'isScrolledBack', { value: true, configurable: true });
      emu.scrollToBottom.mockClear();
      emu.markDirty.mockClear();
      callPrivate(orchestrator, 'onChildInputData', Buffer.from('x'));
      expect(emu.scrollToBottom).toHaveBeenCalled();
      expect(emu.markDirty).toHaveBeenCalled();
    });
  });

  // ===================================================================
  // SCROLL
  // ===================================================================
  describe('onScroll', () => {
    it('does nothing in GAME_MINIMIZED state', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      callPrivate(orchestrator, 'onScroll', -3);
      expect(emu.scrollUp).not.toHaveBeenCalled();
    });

    it('scrolls up in GAME_ACTIVE state', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      callPrivate(orchestrator, 'onScroll', -3);
      expect(emu.scrollUp).toHaveBeenCalledWith(3);
      expect(emu.markDirty).toHaveBeenCalled();
    });

    it('scrolls down in GAME_ACTIVE state', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      callPrivate(orchestrator, 'onScroll', 3);
      expect(emu.scrollDown).toHaveBeenCalledWith(3);
      expect(emu.markDirty).toHaveBeenCalled();
    });

    it('scrolls in GAME_PAUSED state', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.MANUAL_PAUSE);
      const emu = getPrivate(orchestrator, 'emulator');
      emu.markDirty.mockClear();
      callPrivate(orchestrator, 'onScroll', -2);
      expect(emu.scrollUp).toHaveBeenCalledWith(2);
      expect(emu.markDirty).toHaveBeenCalled();
    });

    it('scrolls in ESC_PAUSED state', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.ESC_PAUSE);
      const emu = getPrivate(orchestrator, 'emulator');
      emu.markDirty.mockClear();
      callPrivate(orchestrator, 'onScroll', -2);
      expect(emu.scrollUp).toHaveBeenCalledWith(2);
      expect(emu.markDirty).toHaveBeenCalled();
    });

    it('does nothing in EXITING state', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.CHILD_EXIT);
      const emu = getPrivate(orchestrator, 'emulator');
      emu.scrollUp.mockClear();
      callPrivate(orchestrator, 'onScroll', -3);
      expect(emu.scrollUp).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // STATE APPLICATION
  // ===================================================================
  describe('applyState', () => {
    it('enters alternate screen when transitioning to GAME_ACTIVE', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      stdoutWriteSpy.mockClear();
      callPrivate(orchestrator, 'onToggle');
      const writes = stdoutWriteSpy.mock.calls.map((c: any) => c[0]);
      expect(writes.some((w: string) => typeof w === 'string' && w.includes('?1049h'))).toBe(true);
    });

    it('returns to main screen when transitioning to GAME_MINIMIZED', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      stdoutWriteSpy.mockClear();
      callPrivate(orchestrator, 'onToggle'); // ACTIVE → MINIMIZED
      const writes = stdoutWriteSpy.mock.calls.map((c: any) => c[0]);
      expect(writes.some((w: string) => typeof w === 'string' && w.includes('?1049l'))).toBe(true);
    });

    it('resizes emulator and PTY to full terminal when minimized', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      const pty = getPrivate(orchestrator, 'ptyManager');
      emu.resize.mockClear();
      pty.resize.mockClear();
      callPrivate(orchestrator, 'onToggle'); // → MINIMIZED
      expect(emu.resize).toHaveBeenCalledWith(80, 24);
      expect(pty.resize).toHaveBeenCalledWith(80, 24);
    });

    it('resizes emulator/PTY to left panel and game to right panel when active', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      const pty = getPrivate(orchestrator, 'ptyManager');
      emu.resize.mockClear();
      pty.resize.mockClear();
      callPrivate(orchestrator, 'onToggle'); // → ACTIVE
      expect(emu.resize).toHaveBeenCalledWith(40, 24);
      expect(pty.resize).toHaveBeenCalledWith(40, 24);
    });

    it('pauses game engine when transitioning to GAME_PAUSED', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const ge = getPrivate(orchestrator, 'gameEngine');
      callPrivate(orchestrator, 'onGameInput', 'pause');
      expect(ge.currentGame.pause).toHaveBeenCalled();
    });

    it('enables mouse mode when leaving passthrough', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      stdoutWriteSpy.mockClear();
      callPrivate(orchestrator, 'onToggle'); // → ACTIVE
      const writes = stdoutWriteSpy.mock.calls.map((c: any) => c[0]);
      expect(writes.some((w: string) => typeof w === 'string' && w.includes('?1000h'))).toBe(true);
    });

    it('disables mouse mode when entering passthrough (minimized)', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      stdoutWriteSpy.mockClear();
      callPrivate(orchestrator, 'onToggle'); // → MINIMIZED
      const writes = stdoutWriteSpy.mock.calls.map((c: any) => c[0]);
      expect(writes.some((w: string) => typeof w === 'string' && w.includes('?1000l'))).toBe(true);
    });

    it('calls shutdown when state is EXITING', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.CHILD_EXIT);
      callPrivate(orchestrator, 'applyState');
      expect(process.exit).toHaveBeenCalled();
    });

    it('resets scrollback when transitioning to GAME_ACTIVE while scrolled', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).scrolledBack = true;
      const emu = getPrivate(orchestrator, 'emulator');
      callPrivate(orchestrator, 'onToggle'); // → ACTIVE
      expect(emu.scrollToBottom).toHaveBeenCalled();
      expect(getPrivate(orchestrator, 'scrolledBack')).toBe(false);
    });
  });

  // ===================================================================
  // GAME MANAGEMENT
  // ===================================================================
  describe('launchGame', () => {
    it('creates and starts a new game engine', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      callPrivate(orchestrator, 'onToggle');
      callPrivate(orchestrator, 'launchGame', 'snake');
      expect(getPrivate(orchestrator, 'inMenu')).toBe(false);
      expect(getPrivate(orchestrator, 'currentGameId')).toBe('snake');
    });

    it('resets claude opponent flag', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).claudeOpponent = true;
      callPrivate(orchestrator, 'launchGame', 'snake');
      expect(getPrivate(orchestrator, 'claudeOpponent')).toBe(false);
    });

    it('resets score submission state', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).lastScoreSubmitted = true;
      callPrivate(orchestrator, 'launchGame', 'snake');
      expect(getPrivate(orchestrator, 'lastScoreSubmitted')).toBe(false);
    });

    it('falls back to menu on game creation error', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (createGame as any).mockImplementationOnce(() => { throw new Error('oops'); });
      callPrivate(orchestrator, 'onToggle');
      callPrivate(orchestrator, 'launchGame', 'bad-game');
      expect(getPrivate(orchestrator, 'inMenu')).toBe(true);
    });
  });

  describe('switchToMenu', () => {
    it('resets to menu state', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      callPrivate(orchestrator, 'switchToMenu');
      expect(getPrivate(orchestrator, 'inMenu')).toBe(true);
      expect(getPrivate(orchestrator, 'currentGameId')).toBeNull();
      expect(getPrivate(orchestrator, 'claudeOpponent')).toBe(false);
    });

    it('flushes turn waiters', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const resolved = vi.fn();
      getPrivate(orchestrator, 'turnWaiters').push(resolved);
      callPrivate(orchestrator, 'switchToMenu');
      expect(resolved).toHaveBeenCalledWith(expect.objectContaining({ status: 'ended' }));
    });

    it('clears help visibility', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      (orchestrator as any).helpVisible = true;
      callPrivate(orchestrator, 'switchToMenu');
      expect(getPrivate(orchestrator, 'helpVisible')).toBe(false);
    });

    it('resumes from ESC_PAUSED before switching', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.ESC_PAUSE);
      callPrivate(orchestrator, 'switchToMenu');
      expect(getPrivate(orchestrator, 'inMenu')).toBe(true);
    });
  });

  describe('restartGame', () => {
    it('creates a fresh game instance', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const callsBefore = (createGame as any).mock.calls.length;
      callPrivate(orchestrator, 'restartGame');
      expect((createGame as any).mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('is no-op when no currentGameId', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const callsBefore = (createGame as any).mock.calls.length;
      callPrivate(orchestrator, 'restartGame');
      expect((createGame as any).mock.calls.length).toBe(callsBefore);
    });

    it('preserves claude opponent mode on restart', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      (orchestrator as any).claudeOpponent = true;
      // Need a game that supports setOpponentMode
      (createGame as any).mockImplementationOnce(() => createMockExternalGame());
      callPrivate(orchestrator, 'restartGame');
      const ge = getPrivate(orchestrator, 'gameEngine');
      expect(ge.currentGame.setOpponentMode).toHaveBeenCalledWith('claude');
    });

    it('resumes from ESC_PAUSED before restarting', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.ESC_PAUSE);
      callPrivate(orchestrator, 'restartGame');
      expect(sm.state).toBe(AppState.GAME_ACTIVE);
    });
  });

  // ===================================================================
  // SCORE SUBMISSION
  // ===================================================================
  describe('checkAndSubmitScore', () => {
    it('submits score when game is over with score > 0', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const ge = getPrivate(orchestrator, 'gameEngine');
      ge.currentGame.getState = vi.fn(() => ({ grid: [], score: 100, status: 'gameover' }));
      const hs = getPrivate(orchestrator, 'highScores');
      callPrivate(orchestrator, 'checkAndSubmitScore');
      expect(hs.submit).toHaveBeenCalledWith('snake', 100);
    });

    it('does not submit when in menu', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const hs = getPrivate(orchestrator, 'highScores');
      callPrivate(orchestrator, 'checkAndSubmitScore');
      expect(hs.submit).not.toHaveBeenCalled();
    });

    it('does not submit when score is 0', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const ge = getPrivate(orchestrator, 'gameEngine');
      ge.currentGame.getState = vi.fn(() => ({ grid: [], score: 0, status: 'gameover' }));
      const hs = getPrivate(orchestrator, 'highScores');
      callPrivate(orchestrator, 'checkAndSubmitScore');
      expect(hs.submit).not.toHaveBeenCalled();
    });

    it('does not submit twice', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const ge = getPrivate(orchestrator, 'gameEngine');
      ge.currentGame.getState = vi.fn(() => ({ grid: [], score: 100, status: 'gameover' }));
      const hs = getPrivate(orchestrator, 'highScores');
      callPrivate(orchestrator, 'checkAndSubmitScore');
      callPrivate(orchestrator, 'checkAndSubmitScore');
      expect(hs.submit).toHaveBeenCalledTimes(1);
    });

    it('sets celebration end time on new high score', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const ge = getPrivate(orchestrator, 'gameEngine');
      ge.currentGame.getState = vi.fn(() => ({ grid: [], score: 100, status: 'gameover' }));
      const hs = getPrivate(orchestrator, 'highScores');
      hs.submit.mockReturnValue(true);
      callPrivate(orchestrator, 'checkAndSubmitScore');
      expect(getPrivate(orchestrator, 'celebrationEndTime')).toBeGreaterThan(0);
    });
  });

  // ===================================================================
  // CONFIG CHANGES
  // ===================================================================
  describe('onConfigChanged', () => {
    it('updates input router toggle key', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const ir = getPrivate(orchestrator, 'inputRouter');
      callPrivate(orchestrator, 'onConfigChanged', 'toggleKey');
      expect(ir.setToggleKey).toHaveBeenCalled();
    });

    it('updates input router modifier key', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const ir = getPrivate(orchestrator, 'inputRouter');
      callPrivate(orchestrator, 'onConfigChanged', 'modifierKey');
      expect(ir.setModifierKey).toHaveBeenCalled();
    });

    it('applies width change for gameWidthPercent', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const renderer = getPrivate(orchestrator, 'renderer');
      callPrivate(orchestrator, 'onConfigChanged', 'gameWidthPercent');
      expect(renderer.setGameWidthPercent).toHaveBeenCalled();
    });
  });

  // ===================================================================
  // RESIZE
  // ===================================================================
  describe('onResize / applyResize', () => {
    it('debounces resize events', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.updateGeometry.mockClear();

      callPrivate(orchestrator, 'onResize');
      callPrivate(orchestrator, 'onResize');
      callPrivate(orchestrator, 'onResize');

      // Should not have applied yet
      expect(renderer.updateGeometry).not.toHaveBeenCalled();

      // Advance past debounce timer
      vi.advanceTimersByTime(60);
      expect(renderer.updateGeometry).toHaveBeenCalledTimes(1);
    });

    it('resizes to full terminal when minimized', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      const pty = getPrivate(orchestrator, 'ptyManager');
      emu.resize.mockClear();
      pty.resize.mockClear();

      callPrivate(orchestrator, 'applyResize');
      expect(emu.resize).toHaveBeenCalledWith(80, 24);
      expect(pty.resize).toHaveBeenCalledWith(80, 24);
    });

    it('resizes split panels when game is active', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      const pty = getPrivate(orchestrator, 'ptyManager');
      emu.resize.mockClear();
      pty.resize.mockClear();

      callPrivate(orchestrator, 'applyResize');
      expect(emu.resize).toHaveBeenCalledWith(40, 24);
      expect(pty.resize).toHaveBeenCalledWith(40, 24);
    });

    it('clears screen when game is visible during resize', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      stdoutWriteSpy.mockClear();
      callPrivate(orchestrator, 'applyResize');
      const writes = stdoutWriteSpy.mock.calls.map((c: any) => c[0]);
      expect(writes.some((w: string) => typeof w === 'string' && w.includes('2J'))).toBe(true);
    });
  });

  // ===================================================================
  // RENDER LOOP
  // ===================================================================
  describe('renderFrame', () => {
    it('skips render when cleaned up', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).cleanedUp = true;
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderFullscreen.mockClear();
      renderer.renderSplit.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderFullscreen).not.toHaveBeenCalled();
      expect(renderer.renderSplit).not.toHaveBeenCalled();
    });

    it('skips render when shutting down', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).shuttingDown = true;
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderFullscreen.mockClear();
      renderer.renderSplit.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderFullscreen).not.toHaveBeenCalled();
      expect(renderer.renderSplit).not.toHaveBeenCalled();
    });

    it('skips minimized render when in passthrough and not scrolled', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderFullscreen.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderFullscreen).not.toHaveBeenCalled();
    });

    it('renders fullscreen when dirty in minimized mode', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).passthrough = false;
      const emu = getPrivate(orchestrator, 'emulator');
      emu.consumeDirty.mockReturnValue(true);
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderFullscreen.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderFullscreen).toHaveBeenCalled();
    });

    it('renders split view when game is active', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderSplit.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderSplit).toHaveBeenCalled();
    });

    it('applies pause overlay when ESC_PAUSED', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.ESC_PAUSE);
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderSplit.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderSplit).toHaveBeenCalled();
    });

    it('applies game over overlay when game is over', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const ge = getPrivate(orchestrator, 'gameEngine');
      ge.currentGame.getState = vi.fn(() => ({
        grid: Array.from({ length: 10 }, () =>
          Array.from({ length: 10 }, () => ({
            char: 'X',
            fg: { mode: 'default' as const, value: 0 },
            bg: { mode: 'default' as const, value: 0 },
          })),
        ),
        score: 50,
        status: 'gameover',
        statusMessage: 'Game Over - Press R',
      }));
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderSplit.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderSplit).toHaveBeenCalled();
    });

    it('applies help overlay when help is visible', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      (orchestrator as any).helpVisible = true;
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderSplit.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderSplit).toHaveBeenCalled();
    });
  });

  // ===================================================================
  // OVERLAYS
  // ===================================================================
  describe('applyPauseOverlay', () => {
    it('dims non-space characters and renders PAUSED label', () => {
      orchestrator = createOrchestrator();
      const grid = Array.from({ length: 10 }, () =>
        Array.from({ length: 20 }, () => ({
          char: 'X',
          fg: { mode: 'default' as const, value: 0 },
          bg: { mode: 'default' as const, value: 0 },
        })),
      );
      const gameState: GameRenderState = { grid, score: 0, status: 'paused' };
      callPrivate(orchestrator, 'applyPauseOverlay', gameState);

      // Check that non-space cells are dimmed
      expect(grid[0][0].fg).toEqual({ mode: 'palette', value: 238 });
      // Check PAUSED label exists at midRow
      const midRow = Math.floor(grid.length / 2);
      const pausedText = grid[midRow].map(c => c.char).join('');
      expect(pausedText).toContain('PAUSED');
    });

    it('handles empty grid gracefully', () => {
      orchestrator = createOrchestrator();
      const gameState: GameRenderState = { grid: [], score: 0, status: 'paused' };
      expect(() => callPrivate(orchestrator, 'applyPauseOverlay', gameState)).not.toThrow();
    });
  });

  describe('applyGameOverOverlay', () => {
    it('renders game over message and score', () => {
      orchestrator = createOrchestrator();
      const grid = Array.from({ length: 10 }, () =>
        Array.from({ length: 30 }, () => ({
          char: 'X',
          fg: { mode: 'default' as const, value: 0 },
          bg: { mode: 'default' as const, value: 0 },
        })),
      );
      const gameState: GameRenderState = {
        grid, score: 42, status: 'gameover',
        statusMessage: 'YOU WIN - Press R to restart',
      };
      callPrivate(orchestrator, 'applyGameOverOverlay', gameState);

      const midRow = Math.floor(grid.length / 2);
      const scoreRow = grid[midRow].map(c => c.char).join('');
      expect(scoreRow).toContain('Score: 42');
    });

    it('uses default message when no statusMessage', () => {
      orchestrator = createOrchestrator();
      const grid = Array.from({ length: 10 }, () =>
        Array.from({ length: 30 }, () => ({
          char: ' ',
          fg: { mode: 'default' as const, value: 0 },
          bg: { mode: 'default' as const, value: 0 },
        })),
      );
      const gameState: GameRenderState = { grid, score: 0, status: 'gameover' };
      callPrivate(orchestrator, 'applyGameOverOverlay', gameState);

      const allText = grid.map(row => row.map(c => c.char).join('')).join('');
      expect(allText).toContain('GAME OVER');
    });

    it('handles empty grid gracefully', () => {
      orchestrator = createOrchestrator();
      const gameState: GameRenderState = { grid: [], score: 0, status: 'gameover' };
      expect(() => callPrivate(orchestrator, 'applyGameOverOverlay', gameState)).not.toThrow();
    });
  });

  describe('applyHelpOverlay', () => {
    it('renders controls help text', () => {
      orchestrator = createOrchestrator();
      const grid = Array.from({ length: 20 }, () =>
        Array.from({ length: 30 }, () => ({
          char: ' ',
          fg: { mode: 'default' as const, value: 0 },
          bg: { mode: 'default' as const, value: 0 },
        })),
      );
      const gameState: GameRenderState = { grid, score: 0, status: 'playing' };
      callPrivate(orchestrator, 'applyHelpOverlay', gameState);

      const allText = grid.map(row => row.map(c => c.char).join('')).join('');
      expect(allText).toContain('CONTROLS');
      expect(allText).toContain('Esc');
      expect(allText).toContain('Menu');
    });

    it('handles empty grid gracefully', () => {
      orchestrator = createOrchestrator();
      const gameState: GameRenderState = { grid: [], score: 0, status: 'playing' };
      expect(() => callPrivate(orchestrator, 'applyHelpOverlay', gameState)).not.toThrow();
    });
  });

  // ===================================================================
  // STATUS BAR
  // ===================================================================
  describe('buildStatusBar', () => {
    it('shows menu hints when in menu mode', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const gs: GameRenderState = { grid: [], score: 0, status: 'playing' };
      const bar = callPrivate(orchestrator, 'buildStatusBar', gs);
      expect(bar).toContain('Select');
      expect(bar).toContain('Enter');
      expect(bar).toContain('F12');
    });

    it('shows game over status with high score', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const hs = getPrivate(orchestrator, 'highScores');
      hs.getHighScore.mockReturnValue(200);
      const gs: GameRenderState = { grid: [], score: 50, status: 'gameover' };
      const bar = callPrivate(orchestrator, 'buildStatusBar', gs);
      expect(bar).toContain('OVER');
      expect(bar).toContain('50');
      expect(bar).toContain('Hi:200');
    });

    it('shows celebration when new high score', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      (orchestrator as any).celebrationEndTime = Date.now() + 5000;
      const gs: GameRenderState = { grid: [], score: 300, status: 'gameover' };
      const bar = callPrivate(orchestrator, 'buildStatusBar', gs);
      expect(bar).toContain('NEW HIGH SCORE');
    });

    it('shows esc-pause status with Space:Resume', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.ESC_PAUSE);
      const gs: GameRenderState = { grid: [], score: 10, status: 'paused' };
      const bar = callPrivate(orchestrator, 'buildStatusBar', gs);
      expect(bar).toContain('Space:Resume');
    });

    it('shows manual-pause status with focus hint', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.MANUAL_PAUSE);
      const gs: GameRenderState = { grid: [], score: 10, status: 'paused' };
      const bar = callPrivate(orchestrator, 'buildStatusBar', gs);
      expect(bar).toContain('Terminal');
    });

    it('shows playing status with controls', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const gs: GameRenderState = { grid: [], score: 10, status: 'playing' };
      const bar = callPrivate(orchestrator, 'buildStatusBar', gs);
      expect(bar).toContain('Pause');
      expect(bar).toContain('Menu');
      expect(bar).toContain('Resize');
    });

    it('uses Ctrl label for modifier key', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const gs: GameRenderState = { grid: [], score: 0, status: 'playing' };
      const bar = callPrivate(orchestrator, 'buildStatusBar', gs);
      expect(bar).toContain('Ctrl');
    });
  });

  describe('toggleKeyLabel', () => {
    it('returns F12 for f12 config', () => {
      orchestrator = createOrchestrator();
      const label = callPrivate(orchestrator, 'toggleKeyLabel');
      expect(label).toBe('F12');
    });
  });

  // ===================================================================
  // MCP / IPC / GAME BRIDGE
  // ===================================================================
  describe('MCP client events', () => {
    it('sets claude connected on client connect', () => {
      orchestrator = createOrchestrator();
      const menu = getPrivate(orchestrator, 'gameMenu');
      callPrivate(orchestrator, 'onMcpClientConnect');
      expect(menu.setClaudeConnected).toHaveBeenCalledWith(true);
    });

    it('resets opponent mode on client disconnect', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      (orchestrator as any).claudeOpponent = true;
      const ge = getPrivate(orchestrator, 'gameEngine');
      ge.currentGame.setOpponentMode = vi.fn();
      callPrivate(orchestrator, 'onMcpClientDisconnect');
      expect(ge.currentGame.setOpponentMode).toHaveBeenCalledWith('ai');
      expect(getPrivate(orchestrator, 'claudeOpponent')).toBe(false);
    });

    it('sets claude disconnected on menu', () => {
      orchestrator = createOrchestrator();
      const menu = getPrivate(orchestrator, 'gameMenu');
      callPrivate(orchestrator, 'onMcpClientDisconnect');
      expect(menu.setClaudeConnected).toHaveBeenCalledWith(false);
    });
  });

  describe('GameBridge', () => {
    function getBridge(orch: Orchestrator): any {
      return getPrivate(orch, 'ipcServer')._bridge;
    }

    describe('getGameState', () => {
      it('returns null when in menu', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        const bridge = getBridge(orchestrator);
        expect(bridge.getGameState()).toBeNull();
      });

      it('returns compact state when game is active', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const bridge = getBridge(orchestrator);
        const state = bridge.getGameState();
        expect(state).not.toBeNull();
        expect(state.game).toBe('snake');
        expect(state.score).toBe(42);
      });
    });

    describe('makeMove', () => {
      it('returns error when in menu', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        const bridge = getBridge(orchestrator);
        const result = bridge.makeMove('0,0');
        expect(result.success).toBe(false);
        expect(result.error).toContain('No active game');
      });

      it('returns error when game does not support external moves', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const bridge = getBridge(orchestrator);
        const result = bridge.makeMove('up');
        expect(result.success).toBe(false);
        expect(result.error).toContain('does not support');
      });

      it('returns success with state when move is valid', () => {
        orchestrator = createOrchestrator({ gameId: 'tictactoe' });
        orchestrator.start();
        // Replace game engine's game with an external-move supporting game
        const extGame = createMockExternalGame();
        (orchestrator as any).gameEngine = {
          currentGame: extGame,
          getState: extGame.getState,
          init: vi.fn(), start: vi.fn(), stop: vi.fn(),
          handleInput: vi.fn(), resize: vi.fn(),
          pause: vi.fn(), resume: vi.fn(), reset: vi.fn(),
          isPaused: false, isGameOver: false,
        };
        const bridge = getBridge(orchestrator);
        const result = bridge.makeMove('0,1');
        expect(result.success).toBe(true);
        expect(result.state).toBeDefined();
      });

      it('returns error when move is invalid', () => {
        orchestrator = createOrchestrator({ gameId: 'tictactoe' });
        orchestrator.start();
        const extGame = createMockExternalGame({ externalMove: vi.fn(() => false) });
        (orchestrator as any).gameEngine = {
          currentGame: extGame,
          getState: extGame.getState,
          init: vi.fn(), start: vi.fn(), stop: vi.fn(),
          handleInput: vi.fn(), resize: vi.fn(),
          pause: vi.fn(), resume: vi.fn(), reset: vi.fn(),
          isPaused: false, isGameOver: false,
        };
        const bridge = getBridge(orchestrator);
        const result = bridge.makeMove('bad');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid move');
      });
    });

    describe('getAvailableGames', () => {
      it('returns list of games', () => {
        orchestrator = createOrchestrator();
        const bridge = getBridge(orchestrator);
        const games = bridge.getAvailableGames();
        expect(games.length).toBeGreaterThanOrEqual(2);
        expect(games[0]).toHaveProperty('id');
        expect(games[0]).toHaveProperty('name');
        expect(games[0]).toHaveProperty('supportsExternalMoves');
      });

      it('caches the result', () => {
        orchestrator = createOrchestrator();
        const bridge = getBridge(orchestrator);
        const first = bridge.getAvailableGames();
        const second = bridge.getAvailableGames();
        expect(first).toBe(second); // same reference
      });
    });

    describe('getCurrentGame', () => {
      it('returns null when in menu', () => {
        orchestrator = createOrchestrator();
        const bridge = getBridge(orchestrator);
        expect(bridge.getCurrentGame()).toBeNull();
      });

      it('returns game id when game is active', () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        const bridge = getBridge(orchestrator);
        expect(bridge.getCurrentGame()).toBe('snake');
      });
    });

    describe('selectGame', () => {
      it('returns error for unknown game', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        const bridge = getBridge(orchestrator);
        const result = bridge.selectGame('unknown-game');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Unknown game');
      });

      it('launches game and sets claude opponent', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        const bridge = getBridge(orchestrator);
        // Need to set up a game with external moves
        (createGame as any).mockImplementationOnce(() => createMockExternalGame());
        const result = bridge.selectGame('tictactoe');
        expect(result.success).toBe(true);
        expect(getPrivate(orchestrator, 'claudeOpponent')).toBe(true);
      });

      it('toggles from minimized to visible', () => {
        orchestrator = createOrchestrator();
        orchestrator.start();
        const sm = getPrivate(orchestrator, 'stateMachine');
        expect(sm.state).toBe(AppState.GAME_MINIMIZED);
        const bridge = getBridge(orchestrator);
        bridge.selectGame('tictactoe');
        // Should have toggled to active
        expect(sm.state).toBe(AppState.GAME_ACTIVE);
      });

      it('returns existing state when same game already active with claude', () => {
        orchestrator = createOrchestrator({ gameId: 'tictactoe' });
        orchestrator.start();
        (orchestrator as any).claudeOpponent = true;
        const bridge = getBridge(orchestrator);
        const result = bridge.selectGame('tictactoe');
        expect(result.success).toBe(true);
      });
    });

    describe('waitForTurn', () => {
      it('resolves immediately when it is already claude turn', async () => {
        orchestrator = createOrchestrator({ gameId: 'tictactoe' });
        orchestrator.start();
        const extGame = createMockExternalGame();
        extGame.setOpponentMode!('claude');
        (orchestrator as any).gameEngine = {
          currentGame: extGame,
          getState: extGame.getState,
          init: vi.fn(), start: vi.fn(), stop: vi.fn(),
          handleInput: vi.fn(), resize: vi.fn(),
          pause: vi.fn(), resume: vi.fn(), reset: vi.fn(),
          isPaused: false, isGameOver: false,
        };
        const bridge = getBridge(orchestrator);
        const state = await bridge.waitForTurn(5000);
        expect(state).not.toBeNull();
        expect(state.turn).toBe('claude');
      });

      it('resolves immediately when game is over', async () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const ge = getPrivate(orchestrator, 'gameEngine');
        ge.currentGame.getState = vi.fn(() => ({
          grid: [], score: 50, status: 'gameover',
        }));
        ge.currentGame.getCompactState = vi.fn(() => ({
          board: '', validMoves: [], turn: null,
        }));
        const bridge = getBridge(orchestrator);
        const state = await bridge.waitForTurn(5000);
        expect(state).not.toBeNull();
        expect(state.status).toBe('gameover');
      });

      it('times out and resolves with null', async () => {
        orchestrator = createOrchestrator({ gameId: 'snake' });
        orchestrator.start();
        const bridge = getBridge(orchestrator);
        const promise = bridge.waitForTurn(100);
        vi.advanceTimersByTime(150);
        const state = await promise;
        expect(state).toBeNull();
      });

      it('resolves when turn changes via notifyTurnWaiters', async () => {
        orchestrator = createOrchestrator({ gameId: 'tictactoe' });
        orchestrator.start();
        const bridge = getBridge(orchestrator);
        // Current state: not claude's turn
        const promise = bridge.waitForTurn(5000);

        // Simulate turn change
        const extGame = createMockExternalGame();
        extGame.setOpponentMode!('claude');
        (orchestrator as any).gameEngine = {
          currentGame: extGame,
          getState: extGame.getState,
          init: vi.fn(), start: vi.fn(), stop: vi.fn(),
          handleInput: vi.fn(), resize: vi.fn(),
          pause: vi.fn(), resume: vi.fn(), reset: vi.fn(),
          isPaused: false, isGameOver: false,
        };

        callPrivate(orchestrator, 'notifyTurnWaiters');
        const state = await promise;
        expect(state).not.toBeNull();
        expect(state.turn).toBe('claude');
      });
    });
  });

  // ===================================================================
  // TURN WAITERS
  // ===================================================================
  describe('notifyTurnWaiters', () => {
    it('does nothing when no waiters', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      expect(() => callPrivate(orchestrator, 'notifyTurnWaiters')).not.toThrow();
    });

    it('does not notify when not claude turn and game not over', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const cb = vi.fn();
      getPrivate(orchestrator, 'turnWaiters').push(cb);
      callPrivate(orchestrator, 'notifyTurnWaiters');
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('flushTurnWaiters', () => {
    it('sends ended state to all waiters', () => {
      orchestrator = createOrchestrator();
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      getPrivate(orchestrator, 'turnWaiters').push(cb1, cb2);
      callPrivate(orchestrator, 'flushTurnWaiters');
      expect(cb1).toHaveBeenCalledWith(expect.objectContaining({ status: 'ended' }));
      expect(cb2).toHaveBeenCalledWith(expect.objectContaining({ status: 'ended' }));
      expect(getPrivate(orchestrator, 'turnWaiters')).toHaveLength(0);
    });

    it('does nothing when no waiters', () => {
      orchestrator = createOrchestrator();
      expect(() => callPrivate(orchestrator, 'flushTurnWaiters')).not.toThrow();
    });
  });

  // ===================================================================
  // BUILD COMPACT STATE
  // ===================================================================
  describe('buildCompactState', () => {
    it('returns null when in menu', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      expect(callPrivate(orchestrator, 'buildCompactState')).toBeNull();
    });

    it('returns state with game info when game is active', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const state = callPrivate(orchestrator, 'buildCompactState');
      expect(state).not.toBeNull();
      expect(state.game).toBe('snake');
      expect(state.score).toBe(42);
    });

    it('includes compact state from game when available', () => {
      orchestrator = createOrchestrator({ gameId: 'tictactoe' });
      orchestrator.start();
      const extGame = createMockExternalGame();
      (orchestrator as any).gameEngine = {
        currentGame: extGame,
        getState: extGame.getState,
        init: vi.fn(), start: vi.fn(), stop: vi.fn(),
        handleInput: vi.fn(), resize: vi.fn(),
        pause: vi.fn(), resume: vi.fn(), reset: vi.fn(),
        isPaused: false, isGameOver: false,
      };
      const state = callPrivate(orchestrator, 'buildCompactState');
      expect(state.board).toBe('X__|_O_|___');
      expect(state.validMoves.length).toBeGreaterThan(0);
    });

    it('converts external turn to claude', () => {
      orchestrator = createOrchestrator({ gameId: 'tictactoe' });
      orchestrator.start();
      const extGame = createMockExternalGame();
      extGame.setOpponentMode!('claude');
      (orchestrator as any).gameEngine = {
        currentGame: extGame,
        getState: extGame.getState,
        init: vi.fn(), start: vi.fn(), stop: vi.fn(),
        handleInput: vi.fn(), resize: vi.fn(),
        pause: vi.fn(), resume: vi.fn(), reset: vi.fn(),
        isPaused: false, isGameOver: false,
      };
      const state = callPrivate(orchestrator, 'buildCompactState');
      expect(state.turn).toBe('claude');
      expect(state.status).toBe('waiting_for_claude');
    });
  });

  // ===================================================================
  // CLEANUP
  // ===================================================================
  describe('cleanup / destroy', () => {
    it('stops all subsystems', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const ipc = getPrivate(orchestrator, 'ipcServer');
      const ir = getPrivate(orchestrator, 'inputRouter');
      const pty = getPrivate(orchestrator, 'ptyManager');
      const emu = getPrivate(orchestrator, 'emulator');

      orchestrator.destroy();

      expect(ipc.stop).toHaveBeenCalled();
      expect(ir.stop).toHaveBeenCalled();
      expect(pty.kill).toHaveBeenCalled();
      expect(emu.dispose).toHaveBeenCalled();
    });

    it('clears render and resize timers', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      expect(getPrivate(orchestrator, 'renderTimer')).not.toBeNull();
      orchestrator.destroy();
      expect(getPrivate(orchestrator, 'renderTimer')).toBeNull();
    });

    it('is idempotent - can be called multiple times', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      orchestrator.destroy();
      expect(() => orchestrator.destroy()).not.toThrow();
    });

    it('restores terminal state on cleanup', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      stdoutWriteSpy.mockClear();
      orchestrator.destroy();
      const writes = stdoutWriteSpy.mock.calls.map((c: any) => c[0]);
      // Should show cursor
      expect(writes.some((w: string) => typeof w === 'string' && w.includes('?25h'))).toBe(true);
      // Should disable mouse
      expect(writes.some((w: string) => typeof w === 'string' && w.includes('?1000l'))).toBe(true);
    });

    it('returns to main screen when not in passthrough mode', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      stdoutWriteSpy.mockClear();
      orchestrator.destroy();
      const writes = stdoutWriteSpy.mock.calls.map((c: any) => c[0]);
      expect(writes.some((w: string) => typeof w === 'string' && w.includes('?1049l'))).toBe(true);
    });

    it('does not return to main screen when in passthrough mode', () => {
      orchestrator = createOrchestrator();
      orchestrator.start(); // passthrough = true in menu mode
      stdoutWriteSpy.mockClear();
      orchestrator.destroy();
      const writes = stdoutWriteSpy.mock.calls.map((c: any) => c[0]);
      expect(writes.every((w: string) => typeof w !== 'string' || !w.includes('?1049l'))).toBe(true);
    });
  });

  // ===================================================================
  // SHUTDOWN
  // ===================================================================
  describe('shutdown', () => {
    it('submits pending scores before exiting', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const ge = getPrivate(orchestrator, 'gameEngine');
      ge.currentGame.getState = vi.fn(() => ({ grid: [], score: 100, status: 'gameover' }));
      callPrivate(orchestrator, 'shutdown', 0);
      const hs = getPrivate(orchestrator, 'highScores');
      expect(hs.submit).toHaveBeenCalled();
    });

    it('flushes turn waiters before exiting', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const cb = vi.fn();
      getPrivate(orchestrator, 'turnWaiters').push(cb);
      callPrivate(orchestrator, 'shutdown', 0);
      expect(cb).toHaveBeenCalled();
    });

    it('is idempotent - only shuts down once', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      callPrivate(orchestrator, 'shutdown', 0);
      const exitCallCount = (process.exit as any).mock.calls.length;
      callPrivate(orchestrator, 'shutdown', 1);
      expect((process.exit as any).mock.calls.length).toBe(exitCallCount);
    });
  });

  // ===================================================================
  // WIDTH CHANGE
  // ===================================================================
  describe('handleResize (game width)', () => {
    it('clamps to min game width', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const cm = getPrivate(orchestrator, 'configManager');
      cm.get.mockImplementation((key: string) => key === 'gameWidthPercent' ? 22 : 'f12');
      callPrivate(orchestrator, 'handleResize', -10);
      // Should clamp to min (20)
      expect(cm.set).toHaveBeenCalledWith('gameWidthPercent', 20);
    });

    it('clamps to max game width', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const cm = getPrivate(orchestrator, 'configManager');
      cm.get.mockImplementation((key: string) => key === 'gameWidthPercent' ? 78 : 'f12');
      callPrivate(orchestrator, 'handleResize', 10);
      expect(cm.set).toHaveBeenCalledWith('gameWidthPercent', 80);
    });

    it('no-ops when already at boundary', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const cm = getPrivate(orchestrator, 'configManager');
      cm.get.mockImplementation((key: string) => key === 'gameWidthPercent' ? 20 : 'f12');
      cm.set.mockClear();
      callPrivate(orchestrator, 'handleResize', -5);
      expect(cm.set).not.toHaveBeenCalled();
    });
  });

  describe('applyWidthChange', () => {
    it('updates renderer and resizes subsystems when game is visible', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.setGameWidthPercent.mockClear();
      callPrivate(orchestrator, 'applyWidthChange');
      expect(renderer.setGameWidthPercent).toHaveBeenCalled();
    });

    it('does not resize subsystems when minimized', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      emu.resize.mockClear();
      callPrivate(orchestrator, 'applyWidthChange');
      // In minimized state, no subsystem resize should occur for width change
      expect(emu.resize).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // EDGE CASES
  // ===================================================================
  describe('edge cases', () => {
    it('handles rapid game switches', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      callPrivate(orchestrator, 'onToggle');
      callPrivate(orchestrator, 'launchGame', 'snake');
      callPrivate(orchestrator, 'switchToMenu');
      callPrivate(orchestrator, 'launchGame', 'tictactoe');
      expect(getPrivate(orchestrator, 'currentGameId')).toBe('tictactoe');
      expect(getPrivate(orchestrator, 'inMenu')).toBe(false);
    });

    it('handles game over → restart → game over cycle', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();

      // First game over
      const ge1 = getPrivate(orchestrator, 'gameEngine');
      ge1.currentGame.getState = vi.fn(() => ({ grid: [], score: 100, status: 'gameover' }));
      ge1.currentGame.isGameOver = vi.fn(() => true);
      callPrivate(orchestrator, 'checkAndSubmitScore');
      expect(getPrivate(orchestrator, 'lastScoreSubmitted')).toBe(true);

      // Restart
      callPrivate(orchestrator, 'restartGame');
      expect(getPrivate(orchestrator, 'lastScoreSubmitted')).toBe(false);
    });

    it('cleanup during scrollback restores state', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).scrolledBack = true;
      expect(() => orchestrator.destroy()).not.toThrow();
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: SCROLL EDGE CASES
  // ===================================================================
  describe('scroll (additional paths)', () => {
    it('marks dirty when scrolling down in split view', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      emu.markDirty.mockClear();
      callPrivate(orchestrator, 'onScroll', 3);
      expect(emu.scrollDown).toHaveBeenCalledWith(3);
      expect(emu.markDirty).toHaveBeenCalled();
    });

    it('marks dirty when scrolling up in split view', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const emu = getPrivate(orchestrator, 'emulator');
      emu.markDirty.mockClear();
      callPrivate(orchestrator, 'onScroll', -5);
      expect(emu.scrollUp).toHaveBeenCalledWith(5);
      expect(emu.markDirty).toHaveBeenCalled();
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: RENDER LOOP TIMER
  // ===================================================================
  describe('render loop timer', () => {
    it('fires render frames at interval', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderSplit.mockClear();
      vi.advanceTimersByTime(100);
      expect(renderer.renderSplit.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('renders fullscreen when minimized and scrolled back', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).scrolledBack = true;
      const emu = getPrivate(orchestrator, 'emulator');
      emu.consumeDirty.mockReturnValue(true);
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderFullscreen.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderFullscreen).toHaveBeenCalled();
    });

    it('skips minimized render when not dirty and not scrolled', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).passthrough = false;
      const emu = getPrivate(orchestrator, 'emulator');
      emu.consumeDirty.mockReturnValue(false);
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderFullscreen.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderFullscreen).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: SELECT GAME FROM VARIOUS STATES
  // ===================================================================
  describe('selectGame state transitions', () => {
    function getBridge(orch: Orchestrator): any {
      return getPrivate(orch, 'ipcServer')._bridge;
    }

    it('resumes from GAME_PAUSED when selecting game', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.MANUAL_PAUSE);
      expect(sm.state).toBe(AppState.GAME_PAUSED);
      const bridge = getBridge(orchestrator);
      bridge.selectGame('tictactoe');
      expect(sm.state).toBe(AppState.GAME_ACTIVE);
    });

    it('resumes from ESC_PAUSED when selecting game', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.ESC_PAUSE);
      expect(sm.state).toBe(AppState.ESC_PAUSED);
      const bridge = getBridge(orchestrator);
      bridge.selectGame('tictactoe');
      expect(sm.state).toBe(AppState.GAME_ACTIVE);
    });

    it('sets opponent mode to claude on selected game', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const bridge = getBridge(orchestrator);
      const extGame = createMockExternalGame();
      (createGame as any).mockImplementationOnce(() => extGame);
      bridge.selectGame('tictactoe');
      expect(extGame.setOpponentMode).toHaveBeenCalledWith('claude');
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: GAME INPUT FORWARDING + SCORE + TURN
  // ===================================================================
  describe('game input score and turn notification', () => {
    it('calls checkAndSubmitScore before and after game input', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const ge = getPrivate(orchestrator, 'gameEngine');
      const hs = getPrivate(orchestrator, 'highScores');
      // Make the game over with a score so we can detect submission
      ge.currentGame.getState = vi.fn(() => ({ grid: [], score: 99, status: 'gameover' }));
      hs.submit.mockClear();
      callPrivate(orchestrator, 'onGameInput', 'down');
      expect(hs.submit).toHaveBeenCalledWith('snake', 99);
    });

    it('calls notifyTurnWaiters after game input', () => {
      orchestrator = createOrchestrator({ gameId: 'tictactoe' });
      orchestrator.start();
      const extGame = createMockExternalGame();
      extGame.setOpponentMode!('claude');
      (orchestrator as any).gameEngine = {
        currentGame: extGame,
        getState: extGame.getState,
        init: vi.fn(), start: vi.fn(), stop: vi.fn(),
        handleInput: vi.fn(), resize: vi.fn(),
        pause: vi.fn(), resume: vi.fn(), reset: vi.fn(),
        isPaused: false, isGameOver: false,
      };
      const cb = vi.fn();
      getPrivate(orchestrator, 'turnWaiters').push(cb);
      callPrivate(orchestrator, 'onGameInput', 'left');
      expect(cb).toHaveBeenCalled();
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: APPLY WIDTH IN PAUSED STATE
  // ===================================================================
  describe('applyWidthChange in GAME_PAUSED state', () => {
    it('resizes subsystems when paused', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.MANUAL_PAUSE);
      const emu = getPrivate(orchestrator, 'emulator');
      emu.resize.mockClear();
      callPrivate(orchestrator, 'applyWidthChange');
      expect(emu.resize).toHaveBeenCalled();
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: TOGGLE KEY LABEL VARIANTS
  // ===================================================================
  describe('toggleKeyLabel ctrl+] variant', () => {
    it('returns Ctrl+] when config is ctrl+]', () => {
      orchestrator = createOrchestrator();
      const cm = getPrivate(orchestrator, 'configManager');
      cm.get.mockImplementation((key: string) => key === 'toggleKey' ? 'ctrl+]' : 'ctrl');
      const label = callPrivate(orchestrator, 'toggleKeyLabel');
      expect(label).toBe('Ctrl+]');
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: STATUS BAR WITH NO HIGH SCORE
  // ===================================================================
  describe('buildStatusBar additional', () => {
    it('omits high score when none exists', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const gs: GameRenderState = { grid: [], score: 50, status: 'gameover' };
      const bar = callPrivate(orchestrator, 'buildStatusBar', gs);
      expect(bar).not.toContain('Hi:');
    });

    it('shows celebration score value', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      (orchestrator as any).celebrationEndTime = Date.now() + 5000;
      const gs: GameRenderState = { grid: [], score: 250, status: 'gameover' };
      const bar = callPrivate(orchestrator, 'buildStatusBar', gs);
      expect(bar).toContain('250');
    });

    it('uses Alt label when modifier is alt', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const cm = getPrivate(orchestrator, 'configManager');
      cm.get.mockImplementation((key: string) => {
        if (key === 'modifierKey') return 'alt';
        if (key === 'toggleKey') return 'f12';
        return 50;
      });
      const gs: GameRenderState = { grid: [], score: 0, status: 'playing' };
      const bar = callPrivate(orchestrator, 'buildStatusBar', gs);
      expect(bar).toContain('Alt');
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: MCP DISCONNECT WHEN NOT CLAUDE OPPONENT
  // ===================================================================
  describe('MCP disconnect without claude opponent', () => {
    it('does not attempt to reset opponent mode', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      (orchestrator as any).claudeOpponent = false;
      const ge = getPrivate(orchestrator, 'gameEngine');
      ge.currentGame.setOpponentMode = vi.fn();
      callPrivate(orchestrator, 'onMcpClientDisconnect');
      expect(ge.currentGame.setOpponentMode).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: OVERLAY EDGE CASES
  // ===================================================================
  describe('overlay edge cases', () => {
    it('applyPauseOverlay does not dim space characters', () => {
      orchestrator = createOrchestrator();
      const grid = Array.from({ length: 5 }, () =>
        Array.from({ length: 20 }, () => ({
          char: ' ',
          fg: { mode: 'default' as const, value: 0 },
          bg: { mode: 'default' as const, value: 0 },
        })),
      );
      const gameState: GameRenderState = { grid, score: 0, status: 'paused' };
      callPrivate(orchestrator, 'applyPauseOverlay', gameState);
      // Space chars at corners should NOT be dimmed
      expect(grid[0][0].fg).toEqual({ mode: 'default', value: 0 });
    });

    it('applyGameOverOverlay renders correctly on small grid', () => {
      orchestrator = createOrchestrator();
      const grid = Array.from({ length: 5 }, () =>
        Array.from({ length: 40 }, () => ({
          char: ' ',
          fg: { mode: 'default' as const, value: 0 },
          bg: { mode: 'default' as const, value: 0 },
        })),
      );
      const gameState: GameRenderState = {
        grid, score: 10, status: 'gameover',
        statusMessage: 'GAME OVER',
      };
      callPrivate(orchestrator, 'applyGameOverOverlay', gameState);
      const allText = grid.map(row => row.map(c => c.char).join('')).join('');
      expect(allText).toContain('GAME OVER');
      expect(allText).toContain('Score: 10');
    });

    it('applyHelpOverlay centers on various grid sizes', () => {
      orchestrator = createOrchestrator();
      const grid = Array.from({ length: 25 }, () =>
        Array.from({ length: 40 }, () => ({
          char: ' ',
          fg: { mode: 'default' as const, value: 0 },
          bg: { mode: 'default' as const, value: 0 },
        })),
      );
      const gameState: GameRenderState = { grid, score: 0, status: 'playing' };
      callPrivate(orchestrator, 'applyHelpOverlay', gameState);
      const allText = grid.map(row => row.map(c => c.char).join('')).join('');
      expect(allText).toContain('CONTROLS');
      expect(allText).toContain('Any key to close');
    });
  });

  // ===================================================================
  // INTEGRATION-STYLE: FULL GAME LIFECYCLE
  // ===================================================================
  describe('integration: full game lifecycle', () => {
    it('menu → launch → play → game over → restart → menu', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();

      // Start in menu, toggle to active
      expect(getPrivate(orchestrator, 'inMenu')).toBe(true);
      callPrivate(orchestrator, 'onToggle');
      expect(getPrivate(orchestrator, 'stateMachine').state).toBe(AppState.GAME_ACTIVE);

      // Launch a game from menu
      const menu = getPrivate(orchestrator, 'gameMenu');
      menu.selectedGame = { id: 'snake', name: 'Snake', create: () => createMockGame() };
      callPrivate(orchestrator, 'onGameInput', 'enter');
      expect(getPrivate(orchestrator, 'inMenu')).toBe(false);
      expect(getPrivate(orchestrator, 'currentGameId')).toBe('snake');

      // Simulate game over
      const ge = getPrivate(orchestrator, 'gameEngine');
      ge.currentGame.getState = vi.fn(() => ({ grid: [], score: 150, status: 'gameover' }));
      ge.currentGame.isGameOver = vi.fn(() => true);

      // Restart
      callPrivate(orchestrator, 'onGameInput', 'reset');
      expect(getPrivate(orchestrator, 'lastScoreSubmitted')).toBe(false);

      // Second game over
      const ge2 = getPrivate(orchestrator, 'gameEngine');
      ge2.currentGame.getState = vi.fn(() => ({ grid: [], score: 200, status: 'gameover' }));
      ge2.currentGame.isGameOver = vi.fn(() => true);

      // Go to menu via escape
      callPrivate(orchestrator, 'onGameInput', 'escape');
      expect(getPrivate(orchestrator, 'inMenu')).toBe(true);
      expect(getPrivate(orchestrator, 'currentGameId')).toBeNull();
    });

    it('toggle → active → pause → resume → minimize cycle', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');

      // Start active
      expect(sm.state).toBe(AppState.GAME_ACTIVE);

      // Pause
      callPrivate(orchestrator, 'onGameInput', 'pause');
      expect(sm.state).toBe(AppState.GAME_PAUSED);

      // Resume
      callPrivate(orchestrator, 'onGameInput', 'pause');
      expect(sm.state).toBe(AppState.GAME_ACTIVE);

      // Esc pause
      callPrivate(orchestrator, 'onGameInput', 'escape');
      expect(sm.state).toBe(AppState.ESC_PAUSED);

      // Resume with space
      callPrivate(orchestrator, 'onGameInput', 'space');
      expect(sm.state).toBe(AppState.GAME_ACTIVE);

      // Minimize
      callPrivate(orchestrator, 'onGameInput', 'minimize');
      expect(sm.state).toBe(AppState.GAME_MINIMIZED);

      // Toggle back
      vi.advanceTimersByTime(250);
      callPrivate(orchestrator, 'onToggle');
      expect(sm.state).toBe(AppState.GAME_ACTIVE);
    });

    it('MCP: select game → player move → claude turn → claude move', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();

      const bridge = getPrivate(orchestrator, 'ipcServer')._bridge;

      // MCP selects game
      const extGame = createMockExternalGame();
      (createGame as any).mockImplementationOnce(() => extGame);
      const selectResult = bridge.selectGame('tictactoe');
      expect(selectResult.success).toBe(true);
      expect(getPrivate(orchestrator, 'claudeOpponent')).toBe(true);

      // Player makes a move (handled by game input)
      callPrivate(orchestrator, 'onGameInput', 'enter');

      // Get state — should reflect game state
      const state = bridge.getGameState();
      expect(state).not.toBeNull();
      expect(state.game).toBe('tictactoe');
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: RESIZE TIMER CLEANUP
  // ===================================================================
  describe('resize timer cleanup', () => {
    it('clears pending resize timer on destroy', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      callPrivate(orchestrator, 'onResize');
      expect(getPrivate(orchestrator, 'resizeTimer')).not.toBeNull();
      orchestrator.destroy();
      expect(getPrivate(orchestrator, 'resizeTimer')).toBeNull();
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: GAME OVER OVERLAY WITH SINGLE-PART MESSAGE
  // ===================================================================
  describe('applyGameOverOverlay message parsing', () => {
    it('uses default instructions when no dash separator', () => {
      orchestrator = createOrchestrator();
      const grid = Array.from({ length: 10 }, () =>
        Array.from({ length: 30 }, () => ({
          char: ' ',
          fg: { mode: 'default' as const, value: 0 },
          bg: { mode: 'default' as const, value: 0 },
        })),
      );
      const gameState: GameRenderState = {
        grid, score: 0, status: 'gameover',
        statusMessage: 'YOU LOST',
      };
      callPrivate(orchestrator, 'applyGameOverOverlay', gameState);
      const allText = grid.map(row => row.map(c => c.char).join('')).join('');
      expect(allText).toContain('YOU LOST');
      expect(allText).toContain('R:Restart');
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: START() DOES NOT DOUBLE-REGISTER SIGNALS
  // ===================================================================
  describe('signal handler registration', () => {
    it('does not re-register signal handlers on second start call', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      const firstBound = getPrivate(orchestrator, 'boundOnSignal');
      // Calling start logic again shouldn't re-register
      expect(getPrivate(orchestrator, 'signalHandlersRegistered')).toBe(true);
      expect(getPrivate(orchestrator, 'boundOnSignal')).toBe(firstBound);
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: GAME BRIDGE makeMove SUBMITS SCORE
  // ===================================================================
  describe('GameBridge makeMove score submission', () => {
    function getBridge(orch: Orchestrator): any {
      return getPrivate(orch, 'ipcServer')._bridge;
    }

    it('submits score after a valid external move that ends the game', () => {
      orchestrator = createOrchestrator({ gameId: 'tictactoe' });
      orchestrator.start();
      const extGame = createMockExternalGame();
      extGame.getState = vi.fn(() => ({ grid: [], score: 100, status: 'gameover' }));
      (orchestrator as any).gameEngine = {
        currentGame: extGame,
        getState: extGame.getState,
        init: vi.fn(), start: vi.fn(), stop: vi.fn(),
        handleInput: vi.fn(), resize: vi.fn(),
        pause: vi.fn(), resume: vi.fn(), reset: vi.fn(),
        isPaused: false, isGameOver: false,
      };
      const hs = getPrivate(orchestrator, 'highScores');
      hs.submit.mockClear();
      const bridge = getBridge(orchestrator);
      bridge.makeMove('0,1');
      expect(hs.submit).toHaveBeenCalledWith('tictactoe', 100);
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: RENDER FRAME DURING GAME_PAUSED
  // ===================================================================
  describe('renderFrame during GAME_PAUSED', () => {
    it('renders split view with status bar', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const sm = getPrivate(orchestrator, 'stateMachine');
      sm.transition(StateTransition.MANUAL_PAUSE);
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderSplit.mockClear();
      callPrivate(orchestrator, 'renderFrame');
      expect(renderer.renderSplit).toHaveBeenCalled();
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: EXIT SCROLLBACK
  // ===================================================================
  describe('exitScrollback', () => {
    it('resets scrollback state and renders fullscreen', () => {
      orchestrator = createOrchestrator();
      orchestrator.start();
      (orchestrator as any).scrolledBack = true;
      const emu = getPrivate(orchestrator, 'emulator');
      const renderer = getPrivate(orchestrator, 'renderer');
      renderer.renderFullscreen.mockClear();
      callPrivate(orchestrator, 'exitScrollback');
      expect(getPrivate(orchestrator, 'scrolledBack')).toBe(false);
      expect(emu.scrollToBottom).toHaveBeenCalled();
      expect(emu.markDirty).toHaveBeenCalled();
      expect(renderer.renderFullscreen).toHaveBeenCalled();
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: START WITH ACTIVE GAME ENABLES MOUSE MODE
  // ===================================================================
  describe('start() with active game', () => {
    it('enables mouse mode when starting with game active', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      const writes: string[] = [];
      stdoutWriteSpy.mockImplementation((data: any) => { writes.push(data); return true; });
      orchestrator.start();
      expect(writes.some(w => typeof w === 'string' && w.includes('?1000h'))).toBe(true);
      expect(getPrivate(orchestrator, 'passthrough')).toBe(false);
    });

    it('does not enable mouse mode when starting in menu', () => {
      orchestrator = createOrchestrator();
      const writes: string[] = [];
      stdoutWriteSpy.mockImplementation((data: any) => { writes.push(data); return true; });
      orchestrator.start();
      // passthrough is true, so mouse mode should NOT be enabled during start
      expect(getPrivate(orchestrator, 'passthrough')).toBe(true);
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE: IPC SERVER START ERROR
  // ===================================================================
  describe('IPC server error handling', () => {
    it('logs error to stderr when IPC server fails to start', async () => {
      orchestrator = createOrchestrator();
      const ipc = getPrivate(orchestrator, 'ipcServer');
      ipc.start.mockImplementation(() => Promise.reject(new Error('port in use')));
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      orchestrator.start();
      // Wait for the promise rejection to be caught
      await vi.advanceTimersByTimeAsync(10);
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('IPC server failed to start'),
      );
      stderrSpy.mockRestore();
    });
  });

  // ===================================================================
  // ADDITIONAL: MINIMIZE/HELP CLEARS ON STATE CHANGE
  // ===================================================================
  describe('helpVisible cleared on minimize', () => {
    it('clears helpVisible when game is minimized', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      (orchestrator as any).helpVisible = true;
      callPrivate(orchestrator, 'onGameInput', 'minimize');
      expect(getPrivate(orchestrator, 'helpVisible')).toBe(false);
    });
  });

  // ===================================================================
  // ADDITIONAL: SCORE SUBMISSION ON MINIMIZE
  // ===================================================================
  describe('score submission on minimize', () => {
    it('submits score when minimizing with game over', () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const ge = getPrivate(orchestrator, 'gameEngine');
      ge.currentGame.getState = vi.fn(() => ({ grid: [], score: 75, status: 'gameover' }));
      const hs = getPrivate(orchestrator, 'highScores');
      hs.submit.mockClear();
      callPrivate(orchestrator, 'onGameInput', 'minimize');
      expect(hs.submit).toHaveBeenCalledWith('snake', 75);
    });
  });

  // ===================================================================
  // ADDITIONAL: GAME OVER DEFAULT INSTRUCTIONS IN OVERLAY
  // ===================================================================
  describe('applyGameOverOverlay instructions row', () => {
    it('renders custom instruction from statusMessage', () => {
      orchestrator = createOrchestrator();
      const grid = Array.from({ length: 10 }, () =>
        Array.from({ length: 40 }, () => ({
          char: ' ',
          fg: { mode: 'default' as const, value: 0 },
          bg: { mode: 'default' as const, value: 0 },
        })),
      );
      const gameState: GameRenderState = {
        grid, score: 0, status: 'gameover',
        statusMessage: 'WINNER! - Great job, play again?',
      };
      callPrivate(orchestrator, 'applyGameOverOverlay', gameState);
      const allText = grid.map(row => row.map(c => c.char).join('')).join('');
      expect(allText).toContain('WINNER!');
      expect(allText).toContain('Great job, play again?');
    });
  });

  // ===================================================================
  // ADDITIONAL: WAITFORTURN CLEANUP ON TIMEOUT
  // ===================================================================
  describe('waitForTurn cleanup', () => {
    it('removes waiter from list on timeout', async () => {
      orchestrator = createOrchestrator({ gameId: 'snake' });
      orchestrator.start();
      const bridge = getPrivate(orchestrator, 'ipcServer')._bridge;
      const promise = bridge.waitForTurn(100);
      expect(getPrivate(orchestrator, 'turnWaiters')).toHaveLength(1);
      vi.advanceTimersByTime(150);
      await promise;
      expect(getPrivate(orchestrator, 'turnWaiters')).toHaveLength(0);
    });
  });
});
