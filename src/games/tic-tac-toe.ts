import { IGame, GameRenderState, GameCell, ANSIColor } from '../types';

type Mark = 'X' | 'O' | null;

const BLUE: ANSIColor = { mode: 'palette', value: 4 };
const RED: ANSIColor = { mode: 'palette', value: 1 };
const DARK_GRAY: ANSIColor = { mode: 'palette', value: 8 };
const WHITE: ANSIColor = { mode: 'palette', value: 15 };
const DEFAULT: ANSIColor = { mode: 'default', value: 0 };
const CURSOR_BG: ANSIColor = { mode: 'palette', value: 236 };
const MAGENTA: ANSIColor = { mode: 'palette', value: 13 };

export class TicTacToeGame implements IGame {
  readonly name = 'Tic-Tac-Toe';
  readonly supportsExternalMoves = true;

  private width = 0;
  private height = 0;
  private board: Mark[] = new Array(9).fill(null);
  private cursorRow = 0;
  private cursorCol = 0;
  private _paused = false;
  private _gameOver = false;
  private winner: 'X' | 'O' | 'draw' | null = null;
  private wins = 0;
  private losses = 0;
  private draws = 0;
  private opponentMode: 'ai' | 'claude' = 'ai';
  private _waitingForClaude = false;
  private difficulty: 'easy' | 'medium' | 'hard' = 'medium';
  private movesMade = false;
  private streak = 0;
  private bestStreak = 0;

  init(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.resetBoard();
  }

  tick(_deltaMs: number): void {
    // Turn-based — no-op.
  }

  handleInput(key: string): void {
    if (this._gameOver) {
      if (key === 'space' || key === 'enter' || key === 'reset') {
        this.resetBoard();
      } else if (key === 'up' || key === 'down') {
        this.cycleDifficulty(key);
      }
      return;
    }
    if (this._paused) return;
    if (this._waitingForClaude) return;

    if (!this.movesMade && this.opponentMode !== 'claude' && (key === 'up' || key === 'down')) {
      this.cycleDifficulty(key);
      return;
    }

    switch (key) {
      case 'up':    this.cursorRow = Math.max(0, this.cursorRow - 1); break;
      case 'down':  this.cursorRow = Math.min(2, this.cursorRow + 1); break;
      case 'left':  this.cursorCol = Math.max(0, this.cursorCol - 1); break;
      case 'right': this.cursorCol = Math.min(2, this.cursorCol + 1); break;
      case 'space':
      case 'enter':
        this.placePlayerMark();
        break;
      case 'reset':
        this.resetBoard();
        break;
    }
  }

  private cycleDifficulty(key: 'up' | 'down'): void {
    const levels: Array<'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard'];
    const idx = levels.indexOf(this.difficulty);
    this.difficulty = levels[(idx + (key === 'up' ? 1 : levels.length - 1)) % levels.length];
  }

  getState(): GameRenderState {
    const grid = this.buildGrid();

    let statusMessage: string;
    if (this._paused) {
      statusMessage = 'PAUSED';
    } else if (this._gameOver) {
      if (this.winner === 'X') statusMessage = 'You win! SPACE:New ↑↓:Difficulty';
      else if (this.winner === 'O') {
        statusMessage = this.opponentMode === 'claude'
          ? 'Claude wins! SPACE:New'
          : 'AI wins! SPACE:New ↑↓:Difficulty';
      }
      else statusMessage = 'Draw! SPACE:New ↑↓:Difficulty';
    } else if (this._waitingForClaude) {
      statusMessage = 'Waiting for Claude...';
    } else if (!this.movesMade && this.opponentMode !== 'claude') {
      statusMessage = `↑↓:Difficulty [${this.difficulty}]  SPACE:Play`;
    } else {
      statusMessage = this.opponentMode === 'claude' ? 'Your turn (vs Claude)' : 'Your turn';
    }

    const diffLabel = this.opponentMode === 'claude' ? '' : ` [${this.difficulty}]`;
    statusMessage += `  |  W:${this.wins} L:${this.losses} D:${this.draws}${diffLabel}`;

    return {
      grid,
      score: this.bestStreak,
      status: this._gameOver ? 'gameover' : this._paused ? 'paused' : 'playing',
      statusMessage,
    };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  isPaused(): boolean { return this._paused; }
  pause(): void { this._paused = true; }
  resume(): void { if (!this._gameOver) this._paused = false; }
  isGameOver(): boolean { return this._gameOver; }

  reset(): void {
    this.wins = 0;
    this.losses = 0;
    this.draws = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.resetBoard();
  }

  setOpponentMode(mode: 'ai' | 'claude'): void {
    this.opponentMode = mode;
    if (mode === 'ai' && this._waitingForClaude) {
      this._waitingForClaude = false;
      this.aiMove();
      const result = this.checkWinner();
      if (result) this.endRound(result);
    }
  }

  getCompactState(): { board: string; validMoves: string[]; turn: 'player' | 'external' | null } {
    const rows: string[] = [];
    for (let r = 0; r < 3; r++) {
      let row = '';
      for (let c = 0; c < 3; c++) {
        const mark = this.board[r * 3 + c];
        row += mark === null ? '_' : mark;
      }
      rows.push(row);
    }

    const validMoves: string[] = [];
    for (let i = 0; i < 9; i++) {
      if (this.board[i] === null) {
        validMoves.push(`${Math.floor(i / 3)},${i % 3}`);
      }
    }

    let turn: 'player' | 'external' | null = null;
    if (!this._gameOver) {
      turn = this._waitingForClaude ? 'external' : 'player';
    }

    return { board: rows.join('|'), validMoves, turn };
  }

  externalMove(move: string): boolean {
    if (!this._waitingForClaude || this._gameOver) return false;

    const parts = move.split(',').map(Number);
    if (parts.length !== 2 || parts.some(isNaN)) return false;

    const [row, col] = parts;
    if (row < 0 || row > 2 || col < 0 || col > 2) return false;

    const idx = row * 3 + col;
    if (this.board[idx] !== null) return false;

    this.board[idx] = 'O';
    this._waitingForClaude = false;

    const result = this.checkWinner();
    if (result) this.endRound(result);

    return true;
  }

  // --- Private: game logic ---

  private resetBoard(): void {
    this.board = new Array(9).fill(null);
    this.cursorRow = 1;
    this.cursorCol = 1;
    this._gameOver = false;
    this._paused = false;
    this._waitingForClaude = false;
    this.winner = null;
    this.movesMade = false;
  }

  private placePlayerMark(): void {
    const idx = this.cursorRow * 3 + this.cursorCol;
    if (this.board[idx] !== null) return;

    this.movesMade = true;
    this.board[idx] = 'X';
    const result = this.checkWinner();
    if (result) {
      this.endRound(result);
      return;
    }

    if (this.opponentMode === 'claude') {
      this._waitingForClaude = true;
      return;
    }

    this.aiMove();
    const result2 = this.checkWinner();
    if (result2) {
      this.endRound(result2);
    }
  }

  private aiMove(): void {
    const empty = this.board.map((v, i) => v === null ? i : -1).filter(i => i >= 0);
    if (empty.length === 0) return;

    const useRandom =
      (this.difficulty === 'easy' && Math.random() < 0.5) ||
      (this.difficulty === 'medium' && Math.random() < 0.2);

    if (useRandom) {
      this.board[empty[Math.floor(Math.random() * empty.length)]] = 'O';
      return;
    }

    // First-move heuristic: center > corner
    if (empty.length === 8) {
      if (this.board[4] === null) {
        this.board[4] = 'O';
      } else {
        this.board[0] = 'O';
      }
      return;
    }

    let bestScore = -Infinity;
    let bestIdx = empty[0];
    for (const idx of empty) {
      this.board[idx] = 'O';
      const score = this.minimax(false);
      this.board[idx] = null;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }
    this.board[bestIdx] = 'O';
  }

  private minimax(isAI: boolean): number {
    const result = this.checkWinner();
    if (result === 'O') return 1;
    if (result === 'X') return -1;
    if (result === 'draw') return 0;

    const empty = this.board.map((v, i) => v === null ? i : -1).filter(i => i >= 0);

    if (isAI) {
      let best = -Infinity;
      for (const idx of empty) {
        this.board[idx] = 'O';
        best = Math.max(best, this.minimax(false));
        this.board[idx] = null;
      }
      return best;
    } else {
      let best = Infinity;
      for (const idx of empty) {
        this.board[idx] = 'X';
        best = Math.min(best, this.minimax(true));
        this.board[idx] = null;
      }
      return best;
    }
  }

  private checkWinner(): 'X' | 'O' | 'draw' | null {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
      [0, 4, 8], [2, 4, 6],             // diagonals
    ];
    for (const [a, b, c] of lines) {
      if (this.board[a] && this.board[a] === this.board[b] && this.board[b] === this.board[c]) {
        return this.board[a] as 'X' | 'O';
      }
    }
    if (this.board.every(c => c !== null)) return 'draw';
    return null;
  }

  private endRound(result: 'X' | 'O' | 'draw'): void {
    this._gameOver = true;
    this.winner = result;
    if (result === 'X') {
      this.wins++;
      this.streak++;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    } else if (result === 'O') {
      this.losses++;
      this.streak = 0;
    } else {
      this.draws++;
      this.streak = 0;
    }
  }

  // --- Private: rendering ---

  private buildGrid(): GameCell[][] {
    const grid: GameCell[][] = [];
    for (let r = 0; r < this.height; r++) {
      grid[r] = [];
      for (let c = 0; c < this.width; c++) {
        grid[r][c] = { char: ' ', fg: DEFAULT, bg: DEFAULT };
      }
    }

    // Cell dimensions (chars): 5 wide, 3 tall
    const cellW = 5;
    const cellH = 3;
    // Grid has 2 separator columns and 2 separator rows
    const totalW = cellW * 3 + 2; // 17
    const totalH = cellH * 3 + 2; // 11

    const startCol = Math.max(0, Math.floor((this.width - totalW) / 2));
    const startRow = Math.max(0, Math.floor((this.height - totalH) / 2));

    // Draw grid lines and cells
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const cellTopRow = startRow + br * (cellH + 1);
        const cellLeftCol = startCol + bc * (cellW + 1);
        const mark = this.board[br * 3 + bc];
        const isCursor = br === this.cursorRow && bc === this.cursorCol && !this._gameOver;

        this.renderCell(grid, cellTopRow, cellLeftCol, cellW, cellH, mark, isCursor);
      }
    }

    // Draw horizontal separator lines
    for (let sep = 0; sep < 2; sep++) {
      const row = startRow + (sep + 1) * cellH + sep;
      for (let c = 0; c < totalW; c++) {
        const gc = startCol + c;
        if (gc >= 0 && gc < this.width && row >= 0 && row < this.height) {
          grid[row][gc] = { char: '─', fg: DARK_GRAY, bg: DEFAULT };
        }
      }
    }

    // Draw vertical separator lines
    for (let sep = 0; sep < 2; sep++) {
      const col = startCol + (sep + 1) * cellW + sep;
      for (let r = 0; r < totalH; r++) {
        const gr = startRow + r;
        if (col >= 0 && col < this.width && gr >= 0 && gr < this.height) {
          // Intersections
          const isHLine = r === cellH || r === cellH * 2 + 1;
          grid[gr][col] = { char: isHLine ? '┼' : '│', fg: DARK_GRAY, bg: DEFAULT };
        }
      }
    }

    if (this.opponentMode === 'claude' && !this._gameOver) {
      const msgRow = startRow + totalH + 1;
      if (this._waitingForClaude) {
        this.writeGridText(grid, msgRow, "Claude's turn...", MAGENTA);
      } else {
        this.writeGridText(grid, msgRow, 'Your turn', WHITE);
      }
    }

    return grid;
  }

  private writeGridText(grid: GameCell[][], row: number, text: string, fg: ANSIColor): void {
    if (row < 0 || row >= this.height) return;
    const col = Math.max(0, Math.floor((this.width - text.length) / 2));
    for (let i = 0; i < text.length && col + i < this.width; i++) {
      grid[row][col + i] = { char: text[i], fg, bg: DEFAULT };
    }
  }

  private renderCell(
    grid: GameCell[][],
    topRow: number, leftCol: number,
    w: number, h: number,
    mark: Mark, isCursor: boolean,
  ): void {
    const bg = isCursor ? CURSOR_BG : DEFAULT;
    const midRow = topRow + Math.floor(h / 2);
    const midCol = leftCol + Math.floor(w / 2);

    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        const r = topRow + dr;
        const c = leftCol + dc;
        if (r < 0 || r >= this.height || c < 0 || c >= this.width) continue;
        grid[r][c] = { char: ' ', fg: DEFAULT, bg };
      }
    }

    if (midRow >= 0 && midRow < this.height && midCol >= 0 && midCol < this.width) {
      if (mark === 'X') {
        grid[midRow][midCol] = { char: 'X', fg: BLUE, bg };
      } else if (mark === 'O') {
        grid[midRow][midCol] = { char: 'O', fg: RED, bg };
      } else if (isCursor) {
        grid[midRow][midCol] = { char: '·', fg: WHITE, bg };
      }
    }
  }
}
