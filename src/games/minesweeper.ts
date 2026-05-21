import { IGame, GameRenderState, GameCell, ANSIColor } from '../types';

const DEFAULT: ANSIColor = { mode: 'default', value: 0 };
const DARK_GRAY: ANSIColor = { mode: 'palette', value: 8 };
const RED: ANSIColor = { mode: 'palette', value: 1 };
const CURSOR_BG: ANSIColor = { mode: 'palette', value: 240 };

const NUMBER_COLORS: ANSIColor[] = [
  DEFAULT,                          // 0 — unused (blank)
  { mode: 'palette', value: 4 },    // 1 — blue
  { mode: 'palette', value: 2 },    // 2 — green
  { mode: 'palette', value: 1 },    // 3 — red
  { mode: 'palette', value: 12 },   // 4 — dark blue
  { mode: 'palette', value: 9 },    // 5 — dark red
  { mode: 'palette', value: 6 },    // 6 — cyan
  { mode: 'palette', value: 0 },    // 7 — black
  { mode: 'palette', value: 8 },    // 8 — gray
];

const MAX_COLS = 30;
const MAX_ROWS = 16;
const MINE_DENSITY = 0.15;
const CELL_WIDTH = 2;

enum CellState {
  HIDDEN,
  REVEALED,
  FLAGGED,
}

interface Cell {
  mine: boolean;
  state: CellState;
  adjacent: number;
}

export class MinesweeperGame implements IGame {
  readonly name = 'Minesweeper';

  private panelWidth = 0;
  private panelHeight = 0;
  private cols = 0;
  private rows = 0;
  private grid: Cell[][] = [];
  private cursorX = 0;
  private cursorY = 0;
  private mineCount = 0;
  private flagCount = 0;
  private revealedCount = 0;
  private _paused = false;
  private _gameOver = false;
  private _won = false;
  private firstMove = true;
  private elapsedMs = 0;

  init(width: number, height: number): void {
    this.panelWidth = width;
    this.panelHeight = height;
    this.computeGridSize();
    this.reset();
  }

  tick(deltaMs: number): void {
    if (!this.firstMove && !this._gameOver && !this._paused) {
      this.elapsedMs += deltaMs;
    }
  }

  handleInput(key: string): void {
    if (this._gameOver) {
      if (key === 'space' || key === 'enter' || key === 'reset') {
        this.reset();
      }
      return;
    }
    if (this._paused) return;

    switch (key) {
      case 'up':
        if (this.cursorY > 0) this.cursorY--;
        break;
      case 'down':
        if (this.cursorY < this.rows - 1) this.cursorY++;
        break;
      case 'left':
        if (this.cursorX > 0) this.cursorX--;
        break;
      case 'right':
        if (this.cursorX < this.cols - 1) this.cursorX++;
        break;
      case 'space':
      case 'enter':
        this.reveal(this.cursorX, this.cursorY);
        break;
      case 'f':
      case 'flag':
        this.toggleFlag(this.cursorX, this.cursorY);
        break;
      case 'pause':
        this.pause();
        break;
    }
  }

  getState(): GameRenderState {
    const out: GameCell[][] = [];
    const empty: GameCell = { char: ' ', fg: DEFAULT, bg: DEFAULT };

    // Offsets to center the minesweeper grid within the panel.
    const gridPixelW = this.cols * CELL_WIDTH;
    const gridPixelH = this.rows + 1; // +1 for header row
    const offsetX = Math.max(0, Math.floor((this.panelWidth - gridPixelW) / 2));
    const offsetY = Math.max(0, Math.floor((this.panelHeight - gridPixelH) / 2));

    for (let row = 0; row < this.panelHeight; row++) {
      out[row] = [];
      for (let col = 0; col < this.panelWidth; col++) {
        out[row][col] = { ...empty };
      }
    }

    // Header row: title
    const header = `MINESWEEPER`;
    const headerX = Math.max(0, Math.floor((this.panelWidth - header.length) / 2));
    for (let i = 0; i < header.length && headerX + i < this.panelWidth; i++) {
      out[offsetY][headerX + i] = { char: header[i], fg: DEFAULT, bg: DEFAULT };
    }

    // Minesweeper cells
    for (let gy = 0; gy < this.rows; gy++) {
      const screenRow = offsetY + 1 + gy;
      if (screenRow >= this.panelHeight) break;
      for (let gx = 0; gx < this.cols; gx++) {
        const screenCol = offsetX + gx * CELL_WIDTH;
        if (screenCol + 1 >= this.panelWidth) break;

        const cell = this.grid[gy][gx];
        const isCursor = gx === this.cursorX && gy === this.cursorY;
        const bg = isCursor ? CURSOR_BG : DEFAULT;

        let char: string;
        let fg: ANSIColor;

        if (cell.state === CellState.REVEALED) {
          if (cell.mine) {
            char = '*';
            fg = RED;
          } else if (cell.adjacent === 0) {
            char = ' ';
            fg = DEFAULT;
          } else {
            char = String(cell.adjacent);
            fg = NUMBER_COLORS[cell.adjacent];
          }
        } else if (cell.state === CellState.FLAGGED) {
          char = 'F';
          fg = RED;
        } else {
          // Hidden
          if (this._gameOver && !this._won && cell.mine) {
            // Reveal mines on loss
            char = '*';
            fg = RED;
          } else {
            char = '■'; // ■
            fg = DARK_GRAY;
          }
        }

        out[screenRow][screenCol] = { char, fg, bg };
        out[screenRow][screenCol + 1] = { char: ' ', fg: DEFAULT, bg };
      }
    }

    const totalSec = Math.floor(this.elapsedMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

    let statusMessage = `Mines: ${this.mineCount} | Flags: ${this.flagCount} | ${timeStr}`;
    let status: 'playing' | 'paused' | 'gameover' = 'playing';

    if (this._gameOver) {
      status = 'gameover';
      statusMessage = this._won ? `YOU WIN! ${timeStr}` : `BOOM! Game Over ${timeStr}`;
    } else if (this._paused) {
      status = 'paused';
      statusMessage = 'PAUSED - Ctrl+Space to resume';
    }

    return {
      grid: out,
      score: this.revealedCount,
      status,
      statusMessage,
    };
  }

  resize(width: number, height: number): void {
    this.panelWidth = width;
    this.panelHeight = height;
    const oldCols = this.cols;
    const oldRows = this.rows;
    this.computeGridSize();
    // If grid dimensions changed, must reset (mine layout depends on size).
    if (this.cols !== oldCols || this.rows !== oldRows) {
      this.reset();
    }
  }

  isPaused(): boolean { return this._paused; }
  pause(): void { this._paused = true; }
  resume(): void { if (!this._gameOver) this._paused = false; }
  isGameOver(): boolean { return this._gameOver; }

  reset(): void {
    this._gameOver = false;
    this._won = false;
    this._paused = false;
    this.firstMove = true;
    this.elapsedMs = 0;
    this.revealedCount = 0;
    this.flagCount = 0;
    this.cursorX = Math.floor(this.cols / 2);
    this.cursorY = Math.floor(this.rows / 2);
    this.mineCount = Math.max(1, Math.floor(this.cols * this.rows * MINE_DENSITY));
    this.initGrid();
  }

  // --- internals ---

  private computeGridSize(): void {
    this.cols = Math.min(MAX_COLS, Math.max(5, Math.floor(this.panelWidth / CELL_WIDTH)));
    this.rows = Math.min(MAX_ROWS, Math.max(5, this.panelHeight - 2));
  }

  private initGrid(): void {
    this.grid = [];
    for (let y = 0; y < this.rows; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.cols; x++) {
        this.grid[y][x] = { mine: false, state: CellState.HIDDEN, adjacent: 0 };
      }
    }
    // Mines are placed on first reveal to guarantee safety.
  }

  private placeMines(safeX: number, safeY: number): void {
    // Collect all positions except the safe cell and its neighbors.
    const safeSet = new Set<string>();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        safeSet.add(`${safeX + dx},${safeY + dy}`);
      }
    }

    const candidates: { x: number; y: number }[] = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (!safeSet.has(`${x},${y}`)) {
          candidates.push({ x, y });
        }
      }
    }

    // Clamp mine count if grid is too small.
    this.mineCount = Math.min(this.mineCount, candidates.length);

    // Fisher-Yates shuffle and pick first mineCount.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    for (let i = 0; i < this.mineCount; i++) {
      const { x, y } = candidates[i];
      this.grid[y][x].mine = true;
    }

    // Compute adjacency counts.
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.grid[y][x].mine) continue;
        let count = 0;
        this.forEachNeighbor(x, y, (nx, ny) => {
          if (this.grid[ny][nx].mine) count++;
        });
        this.grid[y][x].adjacent = count;
      }
    }
  }

  private reveal(x: number, y: number): void {
    const cell = this.grid[y][x];
    if (cell.state !== CellState.HIDDEN) return;

    if (this.firstMove) {
      this.firstMove = false;
      this.placeMines(x, y);
    }

    if (cell.mine) {
      cell.state = CellState.REVEALED;
      this._gameOver = true;
      this._won = false;
      return;
    }

    this.floodReveal(x, y);
    this.checkWin();
  }

  private floodReveal(x: number, y: number): void {
    const stack: { x: number; y: number }[] = [{ x, y }];
    while (stack.length > 0) {
      const { x: cx, y: cy } = stack.pop()!;
      const cell = this.grid[cy][cx];
      if (cell.state === CellState.REVEALED) continue;
      if (cell.mine) continue;

      if (cell.state === CellState.FLAGGED) {
        this.flagCount--;
      }
      cell.state = CellState.REVEALED;
      this.revealedCount++;

      if (cell.adjacent === 0) {
        this.forEachNeighbor(cx, cy, (nx, ny) => {
          if (this.grid[ny][nx].state !== CellState.REVEALED) {
            stack.push({ x: nx, y: ny });
          }
        });
      }
    }
  }

  private toggleFlag(x: number, y: number): void {
    const cell = this.grid[y][x];
    if (cell.state === CellState.HIDDEN) {
      cell.state = CellState.FLAGGED;
      this.flagCount++;
    } else if (cell.state === CellState.FLAGGED) {
      cell.state = CellState.HIDDEN;
      this.flagCount--;
    }
  }

  private checkWin(): void {
    const totalSafe = this.cols * this.rows - this.mineCount;
    if (this.revealedCount === totalSafe) {
      this._gameOver = true;
      this._won = true;
    }
  }

  private forEachNeighbor(x: number, y: number, fn: (nx: number, ny: number) => void): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows) {
          fn(nx, ny);
        }
      }
    }
  }
}
