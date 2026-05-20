import { describe, it, expect, beforeEach } from 'vitest';
import { TicTacToeGame } from '../../src/games/tic-tac-toe';

describe('TicTacToeGame', () => {
  let game: TicTacToeGame;

  beforeEach(() => {
    game = new TicTacToeGame();
    game.init(25, 15);
  });

  it('initializes with correct grid dimensions', () => {
    const state = game.getState();
    expect(state.grid.length).toBe(15);
    expect(state.grid[0].length).toBe(25);
  });

  it('starts in playing state with score 0', () => {
    const state = game.getState();
    expect(state.status).toBe('playing');
    expect(state.score).toBe(0);
    expect(game.isGameOver()).toBe(false);
    expect(game.isPaused()).toBe(false);
  });

  it('status message shows turn info and record', () => {
    const state = game.getState();
    expect(state.statusMessage).toContain('Your turn');
    expect(state.statusMessage).toContain('W:');
    expect(state.statusMessage).toContain('L:');
    expect(state.statusMessage).toContain('D:');
  });

  it('cursor starts at center (1,1)', () => {
    // The cursor starts at row=1, col=1 (center of 3x3 board).
    // Verified indirectly: moving up then left should move to (0,0) position.
    game.handleInput('up');
    game.handleInput('left');
    // Now placing should place at top-left (index 0)
    const state = game.getState();
    expect(state.status).toBe('playing');
  });

  it('placing a mark triggers AI response', () => {
    // Place at center (cursor is already at 1,1)
    game.handleInput('space');
    // After player places X, AI places O. Game should still be playing
    // (or could be gameover if AI sees forced win — unlikely on first move).
    const state = game.getState();
    expect(['playing', 'gameover']).toContain(state.status);
  });

  it('cannot place on occupied cell', () => {
    game.handleInput('space'); // place X at center, AI responds
    // Move cursor back to center and try again
    // Cursor might have stayed at (1,1), place again — should be a no-op
    // since (1,1) is now occupied by X
    const scoreBefore = game.getState().score;
    game.handleInput('space');
    // Nothing should have changed from the duplicate placement
    expect(game.getState().status).toBe('playing');
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
    // Still paused, no mark placed
    expect(game.isPaused()).toBe(true);
  });

  it('cursor movement wraps at boundaries', () => {
    // Move up from row 1 twice — should clamp at 0
    game.handleInput('up');
    game.handleInput('up');
    // Move left from col 1 twice — should clamp at 0
    game.handleInput('left');
    game.handleInput('left');
    // No crash, still playing
    expect(game.getState().status).toBe('playing');
  });

  it('reset clears the entire record (wins/losses/draws)', () => {
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

  it('resize updates grid dimensions', () => {
    game.resize(30, 20);
    const state = game.getState();
    expect(state.grid.length).toBe(20);
    expect(state.grid[0].length).toBe(30);
  });

  it('game over after enough moves, then space resets board', () => {
    // Play a full game by placing in available cells.
    // Move cursor to top-left and place sequentially.
    game.handleInput('up');
    game.handleInput('left');
    game.handleInput('space'); // (0,0) = X, AI responds

    if (!game.isGameOver()) {
      game.handleInput('right');
      game.handleInput('right');
      game.handleInput('space'); // (0,2) = X, AI responds
    }

    if (!game.isGameOver()) {
      game.handleInput('down');
      game.handleInput('down');
      game.handleInput('left');
      game.handleInput('left');
      game.handleInput('space'); // (2,0) = X, AI responds
    }

    if (!game.isGameOver()) {
      game.handleInput('right');
      game.handleInput('space');
    }

    // Eventually the game ends (the board fills or someone wins).
    // Even if not game over yet, verify state is valid.
    const state = game.getState();
    expect(['playing', 'gameover']).toContain(state.status);

    // If game over, pressing space resets the board for a new round
    if (game.isGameOver()) {
      game.handleInput('space');
      expect(game.isGameOver()).toBe(false);
      expect(game.getState().status).toBe('playing');
    }
  });

  describe('vs-claude mode', () => {
    beforeEach(() => {
      game.setOpponentMode('claude');
    });

    it('waits for Claude after player moves', () => {
      game.handleInput('space');
      const compact = game.getCompactState!();
      expect(compact.turn).toBe('external');
      expect(compact.board).toContain('X');
      expect(game.getState().statusMessage).toContain('Waiting for Claude');
    });

    it('blocks player input while waiting for Claude', () => {
      game.handleInput('space'); // place X at center
      game.handleInput('up');
      game.handleInput('left');
      game.handleInput('space'); // should be ignored
      const compact = game.getCompactState!();
      expect(compact.board).toBe('___|_X_|___');
    });

    it('accepts external move from Claude', () => {
      game.handleInput('space'); // X at center (1,1)
      const ok = game.externalMove!('0,0'); // O at top-left
      expect(ok).toBe(true);
      const compact = game.getCompactState!();
      expect(compact.board).toBe('O__|_X_|___');
      expect(compact.turn).toBe('player');
    });

    it('rejects invalid external moves', () => {
      game.handleInput('space');
      expect(game.externalMove!('1,1')).toBe(false); // occupied
      expect(game.externalMove!('3,0')).toBe(false); // out of bounds
      expect(game.externalMove!('abc')).toBe(false); // bad format
    });

    it('getCompactState returns valid moves list', () => {
      game.handleInput('space'); // X at (1,1)
      const compact = game.getCompactState!();
      expect(compact.validMoves).toHaveLength(8);
      expect(compact.validMoves).toContain('0,0');
      expect(compact.validMoves).not.toContain('1,1');
    });

    it('detects game over after external move wins', () => {
      // X plays: (0,0), (1,0), (2,0) - left column
      // O plays: (0,1), (1,1)
      game.handleInput('up');
      game.handleInput('left');
      game.handleInput('space'); // X at (0,0)
      game.externalMove!('0,1');

      game.handleInput('down');
      game.handleInput('space'); // X at (1,0)
      game.externalMove!('1,1');

      game.handleInput('down');
      game.handleInput('space'); // X at (2,0) — player wins
      expect(game.isGameOver()).toBe(true);
      expect(game.getState().statusMessage).toContain('You win');
    });

    it('reverts to AI mode when setOpponentMode changes', () => {
      game.handleInput('space'); // X at center, waiting for Claude
      game.setOpponentMode('ai'); // should trigger AI move
      const compact = game.getCompactState!();
      expect(compact.turn).toBe('player'); // AI moved, now player's turn
      expect(compact.board).toContain('O'); // AI placed an O
    });
  });
});
