import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the fs module before importing HighScoreManager
vi.mock('fs', () => {
  let store: Record<string, string> = {};
  return {
    readFileSync: vi.fn((filePath: string) => {
      if (store[filePath]) return store[filePath];
      throw new Error('ENOENT');
    }),
    writeFileSync: vi.fn((filePath: string, data: string) => {
      store[filePath] = data;
    }),
    mkdirSync: vi.fn(),
    // Expose a helper to reset the in-memory store between tests
    __resetStore: () => { store = {}; },
  };
});

import * as fs from 'fs';
import { HighScoreManager } from '../src/high-scores';

describe('HighScoreManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the in-memory file store
    (fs as any).__resetStore();
  });

  it('returns 0 for a game with no scores', () => {
    const mgr = new HighScoreManager();
    expect(mgr.getHighScore('snake')).toBe(0);
  });

  it('returns empty array for top scores of unknown game', () => {
    const mgr = new HighScoreManager();
    expect(mgr.getTopScores('snake')).toEqual([]);
  });

  it('submit records a score and marks it as high score', () => {
    const mgr = new HighScoreManager();
    const isHigh = mgr.submit('snake', 100);
    expect(isHigh).toBe(true);
    expect(mgr.getHighScore('snake')).toBe(100);
  });

  it('submit returns false for score < 0, allows 0', () => {
    const mgr = new HighScoreManager();
    expect(mgr.submit('snake', -5)).toBe(false);
    expect(mgr.getHighScore('snake')).toBe(0);
    expect(mgr.submit('snake', 0)).toBe(true);
    expect(mgr.getHighScore('snake')).toBe(0);
  });

  it('submit returns true only when a new high score is set', () => {
    const mgr = new HighScoreManager();
    expect(mgr.submit('snake', 50)).toBe(true);   // first score — high
    expect(mgr.submit('snake', 30)).toBe(false);  // lower — not a new high
    expect(mgr.submit('snake', 50)).toBe(false);  // equal — not higher
    expect(mgr.submit('snake', 100)).toBe(true);  // higher — new high
  });

  it('getTopScores returns entries sorted descending', () => {
    const mgr = new HighScoreManager();
    mgr.submit('snake', 50);
    mgr.submit('snake', 100);
    mgr.submit('snake', 75);

    const top = mgr.getTopScores('snake', 10);
    expect(top.length).toBe(3);
    expect(top[0].score).toBe(100);
    expect(top[1].score).toBe(75);
    expect(top[2].score).toBe(50);
  });

  it('getTopScores respects the limit parameter', () => {
    const mgr = new HighScoreManager();
    mgr.submit('snake', 10);
    mgr.submit('snake', 20);
    mgr.submit('snake', 30);
    mgr.submit('snake', 40);

    const top = mgr.getTopScores('snake', 2);
    expect(top.length).toBe(2);
    expect(top[0].score).toBe(40);
    expect(top[1].score).toBe(30);
  });

  it('caps entries at 10 per game', () => {
    const mgr = new HighScoreManager();
    for (let i = 1; i <= 15; i++) {
      mgr.submit('snake', i);
    }
    const top = mgr.getTopScores('snake', 20);
    expect(top.length).toBe(10);
    // Lowest score kept should be 6 (top 10 of 1..15 are 15,14,13,...,6)
    expect(top[top.length - 1].score).toBe(6);
  });

  it('scores persist across manager instances via filesystem', () => {
    const mgr1 = new HighScoreManager();
    mgr1.submit('tetris', 500);

    // Create a new instance — it should load from the "file"
    const mgr2 = new HighScoreManager();
    expect(mgr2.getHighScore('tetris')).toBe(500);
  });

  it('different games have independent score lists', () => {
    const mgr = new HighScoreManager();
    mgr.submit('snake', 100);
    mgr.submit('tetris', 200);

    expect(mgr.getHighScore('snake')).toBe(100);
    expect(mgr.getHighScore('tetris')).toBe(200);
  });

  it('handles corrupted file gracefully', () => {
    // Write invalid JSON to the store
    (fs.writeFileSync as any)('test-path', 'not json');
    // HighScoreManager should handle parse errors and start with empty data
    const mgr = new HighScoreManager();
    expect(mgr.getHighScore('snake')).toBe(0);
  });
});
