import { IGame, GameRenderState, GameCell, ANSIColor } from '../types';

const DEFAULT: ANSIColor = { mode: 'default', value: 0 };
const DARK_GRAY: ANSIColor = { mode: 'palette', value: 8 };

const TILE_COLORS: Record<number, ANSIColor> = {
  2:    { mode: 'palette', value: 7 },
  4:    { mode: 'palette', value: 3 },
  8:    { mode: 'palette', value: 208 },
  16:   { mode: 'palette', value: 1 },
  32:   { mode: 'palette', value: 5 },
  64:   { mode: 'palette', value: 9 },
  128:  { mode: 'palette', value: 11 },
  256:  { mode: 'palette', value: 10 },
  512:  { mode: 'palette', value: 14 },
  1024: { mode: 'palette', value: 12 },
  2048: { mode: 'palette', value: 10 },
};

function tileColor(value: number): ANSIColor {
  return TILE_COLORS[value] ?? { mode: 'palette', value: 13 };
}

export class Game2048 implements IGame {
  readonly name = '2048';

  private width = 0;
  private height = 0;
  private board: number[][] = [];
  private score = 0;
  private _paused = false;
  private _gameOver = false;

  init(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.reset();
  }

  tick(_deltaMs: number): void {
    // Turn-based game — nothing to do on tick.
  }

  handleInput(key: string): void {
    if (this._paused) {
      if (key === 'pause') this.resume();
      return;
    }

    if (this._gameOver) {
      if (key === 'reset' || key === 'space') this.reset();
      return;
    }

    switch (key) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        this.move(key);
        break;
      case 'pause':
        this.pause();
        break;
      case 'reset':
      case 'space':
        this.reset();
        break;
    }
  }

  getState(): GameRenderState {
    const grid: GameCell[][] = [];
    for (let r = 0; r < this.height; r++) {
      grid[r] = [];
      for (let c = 0; c < this.width; c++) {
        grid[r][c] = { char: ' ', fg: DEFAULT, bg: DEFAULT };
      }
    }

    this.renderBoard(grid);

    let statusMessage: string | undefined;
    if (this._gameOver) statusMessage = 'GAME OVER - Press SPACE or R';
    else if (this._paused) statusMessage = 'PAUSED - Ctrl+Space to resume';

    return {
      grid,
      score: this.score,
      status: this._gameOver ? 'gameover' : this._paused ? 'paused' : 'playing',
      statusMessage,
    };
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  isPaused(): boolean { return this._paused; }
  pause(): void { this._paused = true; }
  resume(): void { if (!this._gameOver) this._paused = false; }
  isGameOver(): boolean { return this._gameOver; }

  reset(): void {
    this._gameOver = false;
    this._paused = false;
    this.score = 0;
    this.board = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    this.spawnTile();
    this.spawnTile();
  }

  // ── Core mechanics ──────────────────────────────────────────────

  private move(dir: 'up' | 'down' | 'left' | 'right'): void {
    const before = this.boardSnapshot();
    switch (dir) {
      case 'left':  this.slideLeft(); break;
      case 'right': this.slideRight(); break;
      case 'up':    this.slideUp(); break;
      case 'down':  this.slideDown(); break;
    }
    if (!this.boardsEqual(before, this.board)) {
      this.spawnTile();
      if (!this.hasValidMoves()) this._gameOver = true;
    }
  }

  private slideLeft(): void {
    for (let r = 0; r < 4; r++) {
      this.board[r] = this.mergeRow(this.board[r]);
    }
  }

  private slideRight(): void {
    for (let r = 0; r < 4; r++) {
      this.board[r] = this.mergeRow(this.board[r].slice().reverse()).reverse();
    }
  }

  private slideUp(): void {
    for (let c = 0; c < 4; c++) {
      const col = [this.board[0][c], this.board[1][c], this.board[2][c], this.board[3][c]];
      const merged = this.mergeRow(col);
      for (let r = 0; r < 4; r++) this.board[r][c] = merged[r];
    }
  }

  private slideDown(): void {
    for (let c = 0; c < 4; c++) {
      const col = [this.board[3][c], this.board[2][c], this.board[1][c], this.board[0][c]];
      const merged = this.mergeRow(col);
      for (let r = 0; r < 4; r++) this.board[3 - r][c] = merged[r];
    }
  }

  /** Slide and merge a single row toward index 0. */
  private mergeRow(row: number[]): number[] {
    // Compact non-zero values to the left.
    const compact = row.filter(v => v !== 0);
    const result: number[] = [];
    let i = 0;
    while (i < compact.length) {
      if (i + 1 < compact.length && compact[i] === compact[i + 1]) {
        const merged = compact[i] * 2;
        result.push(merged);
        this.score += merged;
        i += 2;
      } else {
        result.push(compact[i]);
        i++;
      }
    }
    while (result.length < 4) result.push(0);
    return result;
  }

  private spawnTile(): void {
    const empty: { r: number; c: number }[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (this.board[r][c] === 0) empty.push({ r, c });
      }
    }
    if (empty.length === 0) return;
    const cell = empty[Math.floor(Math.random() * empty.length)];
    this.board[cell.r][cell.c] = Math.random() < 0.9 ? 2 : 4;
  }

  private hasValidMoves(): boolean {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (this.board[r][c] === 0) return true;
        if (c + 1 < 4 && this.board[r][c] === this.board[r][c + 1]) return true;
        if (r + 1 < 4 && this.board[r][c] === this.board[r + 1][c]) return true;
      }
    }
    return false;
  }

  private boardSnapshot(): number[][] {
    return this.board.map(row => row.slice());
  }

  private boardsEqual(a: number[][], b: number[][]): boolean {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (a[r][c] !== b[r][c]) return false;
      }
    }
    return true;
  }

  // ── Rendering ───────────────────────────────────────────────────

  private renderBoard(grid: GameCell[][]): void {
    const tileW = 6;  // characters per tile horizontally
    const tileH = 3;  // rows per tile vertically
    const gridW = tileW * 4 + 1; // +1 for right border
    const gridH = tileH * 4 + 1; // +1 for bottom border

    // Center the rendered board within the panel.
    const offsetX = Math.max(0, Math.floor((this.width - gridW) / 2));
    const offsetY = Math.max(0, Math.floor((this.height - gridH) / 2));

    for (let tr = 0; tr < 4; tr++) {
      for (let tc = 0; tc < 4; tc++) {
        const value = this.board[tr][tc];
        const cellX = offsetX + tc * tileW;
        const cellY = offsetY + tr * tileH;
        this.renderTile(grid, cellX, cellY, tileW, tileH, value);
      }
    }

    // Draw grid lines.
    this.renderGridLines(grid, offsetX, offsetY, tileW, tileH);
  }

  private renderTile(
    grid: GameCell[][],
    x: number, y: number,
    w: number, h: number,
    value: number,
  ): void {
    const fg = value === 0 ? DARK_GRAY : tileColor(value);
    const label = value === 0 ? '·' : String(value);
    // Center label in the middle row of the tile.
    const midRow = y + Math.floor(h / 2);
    const labelStart = x + Math.max(0, Math.floor((w - label.length) / 2));

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const gr = y + dy;
        const gc = x + dx;
        if (gr < 0 || gr >= this.height || gc < 0 || gc >= this.width) continue;
        grid[gr][gc] = { char: ' ', fg: DEFAULT, bg: DEFAULT };
      }
    }

    for (let i = 0; i < label.length; i++) {
      const gc = labelStart + i;
      if (midRow >= 0 && midRow < this.height && gc >= 0 && gc < this.width) {
        grid[midRow][gc] = { char: label[i], fg, bg: DEFAULT };
      }
    }
  }

  private renderGridLines(
    grid: GameCell[][],
    ox: number, oy: number,
    tileW: number, tileH: number,
  ): void {
    const fg = DARK_GRAY;

    // Horizontal lines (between rows and at top/bottom edges).
    for (let i = 0; i <= 4; i++) {
      const row = oy + i * tileH;
      if (row < 0 || row >= this.height) continue;
      // Only draw border rows at i=0 (top) and i=4 (bottom), plus between tiles.
      // Skip top-most and bottom-most if they coincide with tile content — but
      // since tileH=3, row 0*3=0 is the border above row-0 tiles (which start rendering at oy+0).
      // We draw on the row *before* each tile band and one extra at the end.
    }

    // Simpler approach: draw '+' at intersections, '-' on horizontal borders, '|' on vertical.
    for (let i = 0; i <= 4; i++) {
      const row = oy + i * tileH;
      if (row >= 0 && row < this.height) {
        for (let col = ox; col < ox + tileW * 4 + 1 && col < this.width; col++) {
          if (col >= 0) {
            const isIntersection = (col - ox) % tileW === 0;
            grid[row][col] = { char: isIntersection ? '+' : '-', fg, bg: DEFAULT };
          }
        }
      }
    }

    for (let i = 0; i <= 4; i++) {
      const col = ox + i * tileW;
      if (col < 0 || col >= this.width) continue;
      for (let row = oy; row < oy + tileH * 4 + 1 && row < this.height; row++) {
        if (row >= 0) {
          // Don't overwrite intersection '+'
          if (grid[row][col].char !== '+') {
            grid[row][col] = { char: '|', fg, bg: DEFAULT };
          }
        }
      }
    }
  }
}
