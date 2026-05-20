import { describe, it, expect } from 'vitest';
import { getGameList, findGame, createGame, getDefaultGameId } from '../src/game-registry';

describe('game-registry', () => {
  describe('getGameList', () => {
    it('returns all registered games', () => {
      const list = getGameList();
      expect(list.length).toBeGreaterThanOrEqual(7);
    });

    it('each entry has id, name, and create function', () => {
      for (const info of getGameList()) {
        expect(typeof info.id).toBe('string');
        expect(info.id.length).toBeGreaterThan(0);
        expect(typeof info.name).toBe('string');
        expect(info.name.length).toBeGreaterThan(0);
        expect(typeof info.create).toBe('function');
      }
    });

    it('includes snake, 2048, tetris, tictactoe, breakout, minesweeper, flappy', () => {
      const ids = getGameList().map(g => g.id);
      expect(ids).toContain('snake');
      expect(ids).toContain('2048');
      expect(ids).toContain('tetris');
      expect(ids).toContain('tictactoe');
      expect(ids).toContain('breakout');
      expect(ids).toContain('minesweeper');
      expect(ids).toContain('flappy');
    });
  });

  describe('findGame', () => {
    it('finds a game by its id', () => {
      const info = findGame('snake');
      expect(info).toBeDefined();
      expect(info!.id).toBe('snake');
      expect(info!.name).toBe('Snake');
    });

    it('finds a game by its display name (case-insensitive)', () => {
      const info = findGame('Tic-Tac-Toe');
      expect(info).toBeDefined();
      expect(info!.id).toBe('tictactoe');

      const info2 = findGame('tic-tac-toe');
      expect(info2).toBeDefined();
      expect(info2!.id).toBe('tictactoe');
    });

    it('returns undefined for unknown game', () => {
      expect(findGame('nonexistent')).toBeUndefined();
    });

    it('is case-insensitive for ids', () => {
      const info = findGame('SNAKE');
      // ids are stored lowercase, and the lookup lowercases the input
      expect(info).toBeDefined();
      expect(info!.id).toBe('snake');
    });
  });

  describe('createGame', () => {
    it('creates a game instance that implements IGame', () => {
      const game = createGame('snake');
      expect(game).toBeDefined();
      expect(typeof game.init).toBe('function');
      expect(typeof game.tick).toBe('function');
      expect(typeof game.handleInput).toBe('function');
      expect(typeof game.getState).toBe('function');
      expect(typeof game.resize).toBe('function');
      expect(typeof game.isPaused).toBe('function');
      expect(typeof game.pause).toBe('function');
      expect(typeof game.resume).toBe('function');
      expect(typeof game.isGameOver).toBe('function');
      expect(typeof game.reset).toBe('function');
    });

    it('each registered game can be created and initialized', () => {
      for (const info of getGameList()) {
        const game = createGame(info.id);
        game.init(20, 15);
        const state = game.getState();
        expect(state.grid.length).toBe(15);
        expect(state.grid[0].length).toBeGreaterThanOrEqual(1);
        expect(['playing', 'paused', 'gameover']).toContain(state.status);
      }
    });

    it('throws for unknown game id', () => {
      expect(() => createGame('nonexistent')).toThrow('Unknown game: nonexistent');
    });
  });

  describe('getDefaultGameId', () => {
    it('returns snake as the default', () => {
      expect(getDefaultGameId()).toBe('snake');
    });

    it('default id is valid and can be found', () => {
      const defaultId = getDefaultGameId();
      const info = findGame(defaultId);
      expect(info).toBeDefined();
    });
  });
});
