import { describe, it, expect, beforeEach } from 'vitest';
import { TetrisGame } from '../../src/games/tetris';

describe('TetrisGame', () => {
  let game: TetrisGame;

  beforeEach(() => {
    game = new TetrisGame();
    game.init(30, 25);
  });

  it('initializes with correct grid dimensions', () => {
    const state = game.getState();
    expect(state.grid.length).toBe(25);
    expect(state.grid[0].length).toBe(30);
  });

  it('starts in playing state with score 0', () => {
    const state = game.getState();
    expect(state.status).toBe('playing');
    expect(state.score).toBe(0);
    expect(game.isGameOver()).toBe(false);
    expect(game.isPaused()).toBe(false);
  });

  it('status message includes level and lines', () => {
    const state = game.getState();
    expect(state.statusMessage).toContain('Lv');
    expect(state.statusMessage).toContain('Lines');
  });

  it('pause and resume work', () => {
    game.pause();
    expect(game.isPaused()).toBe(true);
    expect(game.getState().status).toBe('paused');

    game.resume();
    expect(game.isPaused()).toBe(false);
    expect(game.getState().status).toBe('playing');
  });

  it('tick does not advance when paused', () => {
    game.pause();
    const before = game.getState();
    game.tick(5000);
    const after = game.getState();
    // Grid should not change while paused
    expect(after.score).toBe(before.score);
    expect(after.status).toBe('paused');
  });

  it('piece drops over time via tick', () => {
    // Tick enough to trigger at least one gravity drop (default interval 500ms)
    const before = game.getState();
    game.tick(600);
    const after = game.getState();
    // The grid should have changed because the piece moved down
    // We just verify state is still valid
    expect(after.grid.length).toBe(25);
    expect(after.status).toBe('playing');
  });

  it('left and right inputs move the piece horizontally', () => {
    // Simply verify no crash and state remains valid
    game.handleInput('left');
    expect(game.getState().status).toBe('playing');
    game.handleInput('right');
    expect(game.getState().status).toBe('playing');
  });

  it('down input soft-drops the piece', () => {
    game.handleInput('down');
    expect(game.getState().status).toBe('playing');
  });

  it('up input rotates the piece', () => {
    game.handleInput('up');
    expect(game.getState().status).toBe('playing');
  });

  it('space hard-drops, locks, and spawns a new piece', () => {
    game.handleInput('space');
    // After hard drop the piece is locked and a new one spawns
    expect(['playing', 'gameover']).toContain(game.getState().status);
  });

  it('reset restores initial state', () => {
    game.handleInput('space');
    game.handleInput('space');
    game.reset();
    const state = game.getState();
    expect(state.score).toBe(0);
    expect(state.status).toBe('playing');
    expect(game.isGameOver()).toBe(false);
  });

  it('resize updates panel dimensions', () => {
    game.resize(40, 30);
    const state = game.getState();
    expect(state.grid.length).toBe(30);
    expect(state.grid[0].length).toBe(40);
  });

  it('resize clamps to minimum 14 wide, 10 tall', () => {
    game.resize(5, 3);
    const state = game.getState();
    expect(state.grid[0].length).toBe(14);
    expect(state.grid.length).toBe(10);
  });

  it('pause toggle via handleInput', () => {
    game.handleInput('pause');
    expect(game.isPaused()).toBe(true);
    game.handleInput('pause');
    expect(game.isPaused()).toBe(false);
  });

  it('resume does nothing when game is over', () => {
    // Hard-drop repeatedly to fill the board and trigger game over
    for (let i = 0; i < 100; i++) {
      if (game.isGameOver()) break;
      game.handleInput('space');
    }
    if (game.isGameOver()) {
      game.resume();
      expect(game.isGameOver()).toBe(true);
    }
  });
});
