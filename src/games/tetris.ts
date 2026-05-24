import { IGame, GameRenderState, GameCell, ANSIColor } from '../types';

interface Point { x: number; y: number; }

// Colors for each tetromino type
const CYAN: ANSIColor = { mode: 'palette', value: 6 };
const YELLOW: ANSIColor = { mode: 'palette', value: 3 };
const MAGENTA: ANSIColor = { mode: 'palette', value: 5 };
const GREEN: ANSIColor = { mode: 'palette', value: 2 };
const RED: ANSIColor = { mode: 'palette', value: 1 };
const ORANGE: ANSIColor = { mode: 'palette', value: 208 };
const BLUE: ANSIColor = { mode: 'palette', value: 4 };
const DEFAULT: ANSIColor = { mode: 'default', value: 0 };
const DARK_GRAY: ANSIColor = { mode: 'palette', value: 8 };
const WHITE: ANSIColor = { mode: 'palette', value: 7 };

type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'L' | 'J';

const PIECE_COLORS: Record<PieceType, ANSIColor> = {
  I: CYAN,
  O: YELLOW,
  T: MAGENTA,
  S: GREEN,
  Z: RED,
  L: ORANGE,
  J: BLUE,
};

// Each tetromino defined as relative (x, y) offsets from a pivot
const PIECE_SHAPES: Record<PieceType, Point[]> = {
  I: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  O: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  T: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }],
  S: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: -1 }],
  Z: [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 }],
  L: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }],
  J: [{ x: -1, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }],
};

const ALL_PIECES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'L', 'J'];

const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;

interface FallingPiece {
  type: PieceType;
  blocks: Point[]; // relative offsets
  pos: Point;      // position of the pivot on the board
}

interface PlacedCell {
  color: ANSIColor;
}

// Scoring table: index 0 unused, 1-4 lines
const LINE_SCORES = [0, 100, 300, 500, 800];

export class TetrisGame implements IGame {
  readonly name = 'Tetris';

  private panelWidth = 0;
  private panelHeight = 0;

  // The board stores placed (locked) cells only
  private board: (PlacedCell | null)[][] = [];
  private current: FallingPiece | null = null;

  private score = 0;
  private level = 1;
  private linesCleared = 0;
  private _paused = false;
  private _gameOver = false;
  private dropAccumulator = 0;
  private bag: PieceType[] = [];
  private nextType: PieceType | null = null;

  init(width: number, height: number): void {
    this.panelWidth = Math.max(14, width);
    this.panelHeight = Math.max(10, height);
    this.reset();
  }

  tick(deltaMs: number): void {
    if (this._paused || this._gameOver || !this.current) return;

    this.dropAccumulator += deltaMs;
    const interval = this.dropInterval();
    if (this.dropAccumulator >= interval) {
      this.dropAccumulator -= interval;
      this.moveDown();
    }
  }

  handleInput(key: string): void {
    if (key === 'pause') {
      this._paused ? this.resume() : this.pause();
      return;
    }

    if (this._gameOver) {
      if (key === 'reset' || key === 'space') this.reset();
      return;
    }

    if (this._paused) return;
    if (!this.current) return;

    switch (key) {
      case 'left':
        this.tryMove(-1, 0);
        break;
      case 'right':
        this.tryMove(1, 0);
        break;
      case 'down':
        this.moveDown();
        this.dropAccumulator = 0;
        break;
      case 'up':
        this.tryRotate();
        break;
      case 'space':
        this.hardDrop();
        break;
    }
  }

  getState(): GameRenderState {
    const grid = this.buildGrid();

    let statusMessage: string | undefined;
    if (this._gameOver) {
      statusMessage = 'GAME OVER - Press SPACE or R';
    } else if (this._paused) {
      statusMessage = 'PAUSED - Ctrl+Space to resume';
    } else {
      statusMessage = `Lv ${this.level} | Lines ${this.linesCleared}`;
    }

    return {
      grid,
      score: this.score,
      status: this._gameOver ? 'gameover' : this._paused ? 'paused' : 'playing',
      statusMessage,
    };
  }

  resize(width: number, height: number): void {
    this.panelWidth = Math.max(14, width);
    this.panelHeight = Math.max(10, height);
  }

  isPaused(): boolean { return this._paused; }
  pause(): void { this._paused = true; }
  resume(): void { if (!this._gameOver) this._paused = false; }
  isGameOver(): boolean { return this._gameOver; }

  reset(): void {
    this._gameOver = false;
    this._paused = false;
    this.score = 0;
    this.level = 1;
    this.linesCleared = 0;
    this.dropAccumulator = 0;
    this.bag = [];
    this.nextType = null;

    // Initialize empty board
    this.board = [];
    for (let r = 0; r < BOARD_HEIGHT; r++) {
      this.board[r] = new Array(BOARD_WIDTH).fill(null);
    }

    this.spawnPiece();
  }

  // ---- Private: piece management ----

  private nextPieceType(): PieceType {
    if (this.bag.length === 0) {
      // 7-bag randomizer: shuffle all 7 pieces
      this.bag = [...ALL_PIECES];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop()!;
  }

  private spawnPiece(): void {
    const type = this.nextType ?? this.nextPieceType();
    this.nextType = this.nextPieceType();
    const blocks = PIECE_SHAPES[type].map(p => ({ ...p }));
    const pos: Point = { x: Math.floor(BOARD_WIDTH / 2), y: 1 };

    this.current = { type, blocks, pos };
    this.dropAccumulator = 0;

    if (!this.isValidPosition(this.current.blocks, this.current.pos)) {
      this._gameOver = true;
      this.current = null;
    }
  }

  private absoluteBlocks(blocks: Point[], pos: Point): Point[] {
    return blocks.map(b => ({ x: b.x + pos.x, y: b.y + pos.y }));
  }

  private isValidPosition(blocks: Point[], pos: Point): boolean {
    for (const b of blocks) {
      const ax = b.x + pos.x;
      const ay = b.y + pos.y;
      if (ax < 0 || ax >= BOARD_WIDTH || ay >= BOARD_HEIGHT) return false;
      // Allow blocks above the top (y < 0) during spawn
      if (ay >= 0 && this.board[ay][ax] !== null) return false;
    }
    return true;
  }

  private tryMove(dx: number, dy: number): boolean {
    if (!this.current) return false;
    const newPos = { x: this.current.pos.x + dx, y: this.current.pos.y + dy };
    if (this.isValidPosition(this.current.blocks, newPos)) {
      this.current.pos = newPos;
      return true;
    }
    return false;
  }

  private moveDown(): void {
    if (!this.tryMove(0, 1)) {
      this.lockPiece();
    }
  }

  private hardDrop(): void {
    if (!this.current) return;
    while (this.tryMove(0, 1)) { /* keep dropping */ }
    this.lockPiece();
  }

  private tryRotate(): void {
    if (!this.current || this.current.type === 'O') return;

    // Rotate clockwise: (x, y) -> (-y, x)
    const rotated = this.current.blocks.map(b => ({ x: -b.y, y: b.x }));

    // Try basic rotation
    if (this.isValidPosition(rotated, this.current.pos)) {
      this.current.blocks = rotated;
      return;
    }

    // Basic wall kicks: try shifting left, right, up
    const kicks = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 },
                   { x: -2, y: 0 }, { x: 2, y: 0 }];
    for (const kick of kicks) {
      const kickedPos = { x: this.current.pos.x + kick.x, y: this.current.pos.y + kick.y };
      if (this.isValidPosition(rotated, kickedPos)) {
        this.current.blocks = rotated;
        this.current.pos = kickedPos;
        return;
      }
    }
    // Rotation rejected
  }

  private lockPiece(): void {
    if (!this.current) return;
    const abs = this.absoluteBlocks(this.current.blocks, this.current.pos);
    const color = PIECE_COLORS[this.current.type];

    for (const p of abs) {
      if (p.y >= 0 && p.y < BOARD_HEIGHT && p.x >= 0 && p.x < BOARD_WIDTH) {
        this.board[p.y][p.x] = { color };
      }
    }

    this.current = null;
    this.clearLines();
    this.spawnPiece();
  }

  private clearLines(): void {
    let cleared = 0;
    for (let r = BOARD_HEIGHT - 1; r >= 0; r--) {
      if (this.board[r].every(cell => cell !== null)) {
        this.board.splice(r, 1);
        this.board.unshift(new Array(BOARD_WIDTH).fill(null));
        cleared++;
        r++; // re-check this row since rows shifted down
      }
    }

    if (cleared > 0) {
      const idx = Math.min(cleared, 4);
      this.score += LINE_SCORES[idx] * this.level;
      this.linesCleared += cleared;
      this.level = Math.floor(this.linesCleared / 10) + 1;
    }
  }

  private dropInterval(): number {
    // Start at 500ms, decrease by 40ms per level, floor at 50ms
    return Math.max(50, 500 - (this.level - 1) * 40);
  }

  // ---- Private: rendering ----

  private buildGrid(): GameCell[][] {
    const emptyCell: GameCell = { char: ' ', fg: DEFAULT, bg: DEFAULT };
    const grid: GameCell[][] = [];

    for (let r = 0; r < this.panelHeight; r++) {
      grid[r] = [];
      for (let c = 0; c < this.panelWidth; c++) {
        grid[r][c] = { ...emptyCell };
      }
    }

    // Calculate offsets to center the playfield + border in the panel
    // Playfield is BOARD_WIDTH wide, plus 2 for left/right border chars
    const fieldDisplayWidth = BOARD_WIDTH + 2;
    const fieldDisplayHeight = BOARD_HEIGHT + 2; // top/bottom borders
    const offsetX = Math.max(0, Math.floor((this.panelWidth - fieldDisplayWidth) / 2));
    const offsetY = Math.max(0, Math.floor((this.panelHeight - fieldDisplayHeight) / 2));

    // Draw border
    this.drawBorder(grid, offsetX, offsetY, fieldDisplayWidth, fieldDisplayHeight);

    // Draw board contents (placed blocks)
    for (let r = 0; r < BOARD_HEIGHT; r++) {
      for (let c = 0; c < BOARD_WIDTH; c++) {
        const gr = offsetY + 1 + r;
        const gc = offsetX + 1 + c;
        if (gr < 0 || gr >= this.panelHeight || gc < 0 || gc >= this.panelWidth) continue;

        const cell = this.board[r]?.[c];
        if (cell) {
          grid[gr][gc] = { char: '█', fg: cell.color, bg: DEFAULT };
        } else {
          // Subtle dot pattern for empty playfield
          grid[gr][gc] = { char: '·', fg: DARK_GRAY, bg: DEFAULT };
        }
      }
    }

    // Draw current falling piece
    if (this.current) {
      const abs = this.absoluteBlocks(this.current.blocks, this.current.pos);
      const color = PIECE_COLORS[this.current.type];
      for (const p of abs) {
        if (p.y < 0 || p.y >= BOARD_HEIGHT) continue;
        const gr = offsetY + 1 + p.y;
        const gc = offsetX + 1 + p.x;
        if (gr >= 0 && gr < this.panelHeight && gc >= 0 && gc < this.panelWidth) {
          grid[gr][gc] = { char: '█', fg: color, bg: DEFAULT };
        }
      }

      // Draw ghost piece (drop preview)
      const ghostPos = this.findGhostPos();
      if (ghostPos) {
        const ghostAbs = this.absoluteBlocks(this.current.blocks, ghostPos);
        for (const p of ghostAbs) {
          if (p.y < 0 || p.y >= BOARD_HEIGHT) continue;
          const gr = offsetY + 1 + p.y;
          const gc = offsetX + 1 + p.x;
          if (gr >= 0 && gr < this.panelHeight && gc >= 0 && gc < this.panelWidth) {
            const isActual = abs.some(a => a.x === p.x && a.y === p.y);
            if (!isActual) {
              grid[gr][gc] = { char: '░', fg: DARK_GRAY, bg: DEFAULT };
            }
          }
        }
      }
    }

    // Draw next-piece preview to the right of the board
    if (this.nextType) {
      const previewX = offsetX + fieldDisplayWidth + 1;
      const previewY = offsetY + 1;
      const label = 'Next:';
      for (let i = 0; i < label.length && previewX + i < this.panelWidth; i++) {
        if (previewY >= 0 && previewY < this.panelHeight) {
          grid[previewY][previewX + i] = { char: label[i], fg: WHITE, bg: DEFAULT };
        }
      }
      const nextBlocks = PIECE_SHAPES[this.nextType];
      const nextColor = PIECE_COLORS[this.nextType];
      for (const b of nextBlocks) {
        const gr = previewY + 2 + b.y;
        const gc = previewX + 1 + b.x;
        if (gr >= 0 && gr < this.panelHeight && gc >= 0 && gc < this.panelWidth) {
          grid[gr][gc] = { char: '█', fg: nextColor, bg: DEFAULT };
        }
      }
    }

    return grid;
  }

  private drawBorder(
    grid: GameCell[][],
    ox: number, oy: number,
    w: number, h: number,
  ): void {
    const borderFg = WHITE;

    const set = (r: number, c: number, ch: string) => {
      if (r >= 0 && r < this.panelHeight && c >= 0 && c < this.panelWidth) {
        grid[r][c] = { char: ch, fg: borderFg, bg: DEFAULT };
      }
    };

    // Corners
    set(oy, ox, '┌');
    set(oy, ox + w - 1, '┐');
    set(oy + h - 1, ox, '└');
    set(oy + h - 1, ox + w - 1, '┘');

    // Top and bottom
    for (let c = 1; c < w - 1; c++) {
      set(oy, ox + c, '─');
      set(oy + h - 1, ox + c, '─');
    }

    // Left and right
    for (let r = 1; r < h - 1; r++) {
      set(oy + r, ox, '│');
      set(oy + r, ox + w - 1, '│');
    }
  }

  private findGhostPos(): Point | null {
    if (!this.current) return null;
    const ghost: Point = { ...this.current.pos };
    while (this.isValidPosition(this.current.blocks, { x: ghost.x, y: ghost.y + 1 })) {
      ghost.y++;
    }
    // Only show ghost if it's below the current position
    if (ghost.y === this.current.pos.y) return null;
    return ghost;
  }
}
