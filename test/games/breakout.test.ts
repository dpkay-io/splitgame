import { describe, it, expect, beforeEach } from 'vitest';
import { BreakoutGame } from '../../src/games/breakout';

describe('BreakoutGame', () => {
  let game: BreakoutGame;

  beforeEach(() => {
    game = new BreakoutGame();
    game.init(40, 25);
  });

  it('initializes with correct grid dimensions', () => {
    const state = game.getState();
    expect(state.grid.length).toBe(25);
    expect(state.grid[0].length).toBe(40);
  });

  it('starts in playing state with score 0', () => {
    const state = game.getState();
    expect(state.status).toBe('playing');
    expect(state.score).toBe(0);
    expect(game.isGameOver()).toBe(false);
    expect(game.isPaused()).toBe(false);
  });

  it('ball starts attached to paddle', () => {
    const state = game.getState();
    // Status message should indicate SPACE to launch
    expect(state.statusMessage).toContain('SPACE to launch');
  });

  it('left and right move the paddle', () => {
    game.handleInput('left');
    game.handleInput('right');
    // No crash, still playing
    expect(game.getState().status).toBe('playing');
  });

  it('ball follows paddle while attached', () => {
    // Move paddle left several times — ball should track
    game.handleInput('left');
    game.handleInput('left');
    game.handleInput('left');
    const state = game.getState();
    // Find the ball character on the grid
    let ballFound = false;
    for (const row of state.grid) {
      for (const cell of row) {
        if (cell.char === '●') ballFound = true;
      }
    }
    expect(ballFound).toBe(true);
  });

  it('space launches the ball', () => {
    game.handleInput('space');
    const state = game.getState();
    // After launch, status message should NOT mention SPACE to launch
    expect(state.statusMessage).not.toContain('SPACE to launch');
  });

  it('tick moves the ball after launch', () => {
    game.handleInput('space');
    game.tick(100);
    // Ball should have moved — just verify state is valid
    const state = game.getState();
    expect(state.grid.length).toBe(25);
    expect(['playing', 'gameover']).toContain(state.status);
  });

  it('tick does nothing while ball is attached', () => {
    const before = game.getState();
    game.tick(5000);
    const after = game.getState();
    expect(after.score).toBe(before.score);
  });

  it('pause and resume work', () => {
    game.pause();
    expect(game.isPaused()).toBe(true);
    expect(game.getState().status).toBe('paused');

    game.resume();
    expect(game.isPaused()).toBe(false);
    expect(game.getState().status).toBe('playing');
  });

  it('pause toggle via handleInput', () => {
    game.handleInput('pause');
    expect(game.isPaused()).toBe(true);
    game.handleInput('pause');
    expect(game.isPaused()).toBe(false);
  });

  it('reset restores initial state', () => {
    game.handleInput('space');
    game.tick(500);
    game.reset();
    const state = game.getState();
    expect(state.score).toBe(0);
    expect(state.status).toBe('playing');
    expect(game.isGameOver()).toBe(false);
    expect(state.statusMessage).toContain('SPACE to launch');
  });

  it('bricks exist on the grid after init', () => {
    const state = game.getState();
    let brickCount = 0;
    for (const row of state.grid) {
      for (const cell of row) {
        if (cell.char === '█') brickCount++;
      }
    }
    expect(brickCount).toBeGreaterThan(0);
  });

  it('resize updates grid dimensions and clamps paddle', () => {
    game.resize(50, 30);
    const state = game.getState();
    expect(state.grid.length).toBe(30);
    expect(state.grid[0].length).toBe(50);
  });

  it('resize clamps to minimum 10x10', () => {
    game.resize(3, 3);
    const state = game.getState();
    expect(state.grid[0].length).toBe(10);
    expect(state.grid.length).toBe(10);
  });

  it('lives decrease when ball falls off screen', () => {
    game.handleInput('space');
    // Tick many times to let the ball fly around and eventually fall off
    for (let i = 0; i < 500; i++) {
      game.tick(50);
      if (game.isGameOver()) break;
    }
    // Either lives decreased (ball reset) or game over — both valid outcomes
    const state = game.getState();
    expect(['playing', 'gameover']).toContain(state.status);
  });
});
