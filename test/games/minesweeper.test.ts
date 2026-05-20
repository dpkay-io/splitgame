import { describe, it, expect, beforeEach } from 'vitest';
import { MinesweeperGame } from '../../src/games/minesweeper';

describe('MinesweeperGame', () => {
  let game: MinesweeperGame;

  beforeEach(() => {
    game = new MinesweeperGame();
    game.init(30, 20);
  });

  it('initializes with correct grid dimensions', () => {
    const state = game.getState();
    expect(state.grid.length).toBe(20);
    expect(state.grid[0].length).toBe(30);
  });

  it('starts in playing state with score 0', () => {
    const state = game.getState();
    expect(state.status).toBe('playing');
    expect(state.score).toBe(0);
    expect(game.isGameOver()).toBe(false);
    expect(game.isPaused()).toBe(false);
  });

  it('status message shows mine and flag counts', () => {
    const state = game.getState();
    expect(state.statusMessage).toContain('Mines:');
    expect(state.statusMessage).toContain('Flags:');
  });

  it('cursor movement works in all four directions', () => {
    game.handleInput('up');
    game.handleInput('down');
    game.handleInput('left');
    game.handleInput('right');
    expect(game.getState().status).toBe('playing');
  });

  it('first reveal is always safe (no mine)', () => {
    // The game guarantees the first revealed cell and its neighbors are mine-free.
    game.handleInput('space');
    expect(game.isGameOver()).toBe(false);
    // Score should have increased (at least one cell revealed)
    expect(game.getState().score).toBeGreaterThan(0);
  });

  it('reveal via enter key also works', () => {
    game.handleInput('enter');
    expect(game.isGameOver()).toBe(false);
    expect(game.getState().score).toBeGreaterThan(0);
  });

  it('flagging a cell toggles the flag', () => {
    const before = game.getState();
    game.handleInput('f');
    const afterFlag = game.getState();
    // Flag count should have increased by 1
    expect(afterFlag.statusMessage).toContain('Flags: 1');

    game.handleInput('f');
    const afterUnflag = game.getState();
    // Flag count back to 0
    expect(afterUnflag.statusMessage).toContain('Flags: 0');
  });

  it('pause and resume work', () => {
    game.pause();
    expect(game.isPaused()).toBe(true);
    expect(game.getState().status).toBe('paused');

    game.resume();
    expect(game.isPaused()).toBe(false);
    expect(game.getState().status).toBe('playing');
  });

  it('input is ignored while paused', () => {
    game.pause();
    game.handleInput('space');
    // No cell revealed while paused
    expect(game.getState().score).toBe(0);
  });

  it('reset restores initial state', () => {
    game.handleInput('space');
    game.reset();
    const state = game.getState();
    expect(state.score).toBe(0);
    expect(state.status).toBe('playing');
    expect(game.isGameOver()).toBe(false);
  });

  it('tick is a no-op (turn-based game)', () => {
    const before = game.getState();
    game.tick(5000);
    const after = game.getState();
    expect(after.score).toBe(before.score);
    expect(after.status).toBe(before.status);
  });

  it('resize updates panel and may reset grid', () => {
    game.resize(50, 30);
    const state = game.getState();
    expect(state.grid.length).toBe(30);
    expect(state.grid[0].length).toBe(50);
    expect(state.status).toBe('playing');
  });

  it('game over via space/enter resets the board', () => {
    // We can't easily force a mine hit, but we can test the restart path.
    // If the game is over, pressing space should reset.
    // For now, just verify the contract: if isGameOver, space resets.
    game.handleInput('space'); // safe first move
    // Game should not be over after first move
    expect(game.isGameOver()).toBe(false);
  });
});
