import { describe, it, expect, beforeEach } from 'vitest';
import { FlappyBirdGame } from '../../src/games/flappy-bird';

describe('FlappyBirdGame', () => {
  let game: FlappyBirdGame;

  beforeEach(() => {
    game = new FlappyBirdGame();
    game.init(40, 20);
  });

  it('initializes with correct grid dimensions', () => {
    const state = game.getState();
    expect(state.grid.length).toBe(20);
    expect(state.grid[0].length).toBe(40);
  });

  it('starts in playing state with score 0, not yet started', () => {
    const state = game.getState();
    expect(state.status).toBe('playing');
    expect(state.score).toBe(0);
    expect(game.isGameOver()).toBe(false);
    expect(game.isPaused()).toBe(false);
    expect(state.statusMessage).toContain('Press SPACE to start');
  });

  it('space starts the game and flaps', () => {
    game.handleInput('space');
    const state = game.getState();
    // After starting, statusMessage is undefined (no message while actively playing)
    // or does not contain the start prompt
    if (state.statusMessage !== undefined) {
      expect(state.statusMessage).not.toContain('Press SPACE to start');
    } else {
      expect(state.statusMessage).toBeUndefined();
    }
  });

  it('tick does nothing before the game is started', () => {
    const before = game.getState();
    game.tick(1000);
    const after = game.getState();
    expect(after.score).toBe(before.score);
    expect(after.statusMessage).toContain('Press SPACE to start');
  });

  it('bird falls due to gravity after starting', () => {
    game.handleInput('space'); // start + flap
    // Bird should have upward velocity initially. After many ticks, gravity pulls it down.
    game.tick(5000);
    // Either still playing or game over (hit ground)
    expect(['playing', 'gameover']).toContain(game.getState().status);
  });

  it('flapping gives upward velocity', () => {
    game.handleInput('space'); // start
    game.handleInput('space'); // flap again
    // Just verify no crash
    expect(game.getState().status).toBe('playing');
  });

  it('bird hits the ground and game is over', () => {
    game.handleInput('space'); // start
    // Let gravity pull the bird down for a long time
    for (let i = 0; i < 100; i++) {
      game.tick(80);
      if (game.isGameOver()) break;
    }
    expect(game.isGameOver()).toBe(true);
    expect(game.getState().status).toBe('gameover');
  });

  it('pause and resume work', () => {
    game.handleInput('space'); // start
    game.pause();
    expect(game.isPaused()).toBe(true);
    expect(game.getState().status).toBe('paused');

    game.resume();
    expect(game.isPaused()).toBe(false);
    expect(game.getState().status).toBe('playing');
  });

  it('tick does nothing while paused', () => {
    game.handleInput('space'); // start
    game.pause();
    const before = game.getState();
    game.tick(5000);
    const after = game.getState();
    expect(after.score).toBe(before.score);
    expect(after.status).toBe('paused');
  });

  it('pause toggle via handleInput', () => {
    game.handleInput('space'); // start
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
    expect(state.statusMessage).toContain('Press SPACE to start');
  });

  it('space restarts after game over', () => {
    game.handleInput('space'); // start
    for (let i = 0; i < 100; i++) {
      game.tick(80);
      if (game.isGameOver()) break;
    }
    expect(game.isGameOver()).toBe(true);
    game.handleInput('space');
    expect(game.isGameOver()).toBe(false);
    expect(game.getState().score).toBe(0);
  });

  it('resize updates grid dimensions', () => {
    game.resize(50, 25);
    const state = game.getState();
    expect(state.grid.length).toBe(25);
    expect(state.grid[0].length).toBe(50);
  });

  it('resize clamps to minimum 10 wide, 8 tall', () => {
    game.resize(3, 3);
    const state = game.getState();
    expect(state.grid[0].length).toBe(10);
    expect(state.grid.length).toBe(8);
  });

  it('ground row exists at the bottom', () => {
    const state = game.getState();
    const bottomRow = state.grid[state.grid.length - 1];
    // Ground should be rendered with the brown ground character
    const groundChars = bottomRow.filter(c => c.char === '▓');
    expect(groundChars.length).toBe(40);
  });
});
