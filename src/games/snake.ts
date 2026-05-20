import { IGame, GameRenderState, GameCell, ANSIColor } from '../types';

interface Point { x: number; y: number; }

type Direction = 'up' | 'down' | 'left' | 'right';

const GREEN: ANSIColor = { mode: 'palette', value: 2 };
const BRIGHT_GREEN: ANSIColor = { mode: 'palette', value: 10 };
const RED: ANSIColor = { mode: 'palette', value: 1 };
const DARK_GRAY: ANSIColor = { mode: 'palette', value: 8 };
const DEFAULT: ANSIColor = { mode: 'default', value: 0 };

export class SnakeGame implements IGame {
  readonly name = 'Snake';

  private width = 0;
  private height = 0;
  private snake: Point[] = [];
  private food: Point = { x: 0, y: 0 };
  private direction: Direction = 'right';
  private nextDirection: Direction = 'right';
  private score = 0;
  private _paused = false;
  private _gameOver = false;
  private moveAccumulator = 0;
  private moveIntervalMs = 150;

  init(width: number, height: number): void {
    this.width = Math.max(5, width);
    this.height = Math.max(5, height);
    this.reset();
  }

  tick(deltaMs: number): void {
    if (this._paused || this._gameOver) return;
    this.moveAccumulator += deltaMs;
    if (this.moveAccumulator >= this.moveIntervalMs) {
      this.moveAccumulator -= this.moveIntervalMs;
      this.direction = this.nextDirection;
      this.moveSnake();
    }
  }

  handleInput(key: string): void {
    switch (key) {
      case 'up':
        if (this.direction !== 'down') this.nextDirection = 'up';
        break;
      case 'down':
        if (this.direction !== 'up') this.nextDirection = 'down';
        break;
      case 'left':
        if (this.direction !== 'right') this.nextDirection = 'left';
        break;
      case 'right':
        if (this.direction !== 'left') this.nextDirection = 'right';
        break;
      case 'pause':
        this._paused ? this.resume() : this.pause();
        break;
      case 'reset':
      case 'space':
        if (this._gameOver) this.reset();
        break;
    }
  }

  getState(): GameRenderState {
    const grid: GameCell[][] = [];
    const emptyCell: GameCell = { char: ' ', fg: DEFAULT, bg: DEFAULT };

    for (let row = 0; row < this.height; row++) {
      grid[row] = [];
      for (let col = 0; col < this.width; col++) {
        // subtle dot grid pattern
        if (row % 2 === 0 && col % 4 === 0) {
          grid[row][col] = { char: '.', fg: DARK_GRAY, bg: DEFAULT };
        } else {
          grid[row][col] = { ...emptyCell };
        }
      }
    }

    // food
    if (this.inBounds(this.food)) {
      grid[this.food.y][this.food.x] = { char: '*', fg: RED, bg: DEFAULT };
    }

    // snake body then head (head overwrites)
    for (let i = this.snake.length - 1; i >= 0; i--) {
      const p = this.snake[i];
      if (this.inBounds(p)) {
        const isHead = i === 0;
        grid[p.y][p.x] = {
          char: isHead ? '@' : '#',
          fg: isHead ? BRIGHT_GREEN : GREEN,
          bg: DEFAULT,
        };
      }
    }

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
    this.width = Math.max(5, width);
    this.height = Math.max(5, height);
    this.snake = this.snake.filter(p => this.inBounds(p));
    if (this.snake.length === 0) this.reset();
    else if (!this.inBounds(this.food)) this.spawnFood();
  }

  isPaused(): boolean { return this._paused; }
  pause(): void { this._paused = true; }
  resume(): void { if (!this._gameOver) this._paused = false; }
  isGameOver(): boolean { return this._gameOver; }

  reset(): void {
    this._gameOver = false;
    this._paused = false;
    this.score = 0;
    this.direction = 'right';
    this.nextDirection = 'right';
    this.moveAccumulator = 0;
    this.moveIntervalMs = 150;

    const cx = Math.floor(this.width / 2);
    const cy = Math.floor(this.height / 2);
    this.snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];

    this.spawnFood();
  }

  private moveSnake(): void {
    const head = { ...this.snake[0] };
    switch (this.direction) {
      case 'up': head.y--; break;
      case 'down': head.y++; break;
      case 'left': head.x--; break;
      case 'right': head.x++; break;
    }

    if (head.x < 0 || head.x >= this.width || head.y < 0 || head.y >= this.height) {
      this._gameOver = true;
      return;
    }

    for (let i = 0; i < this.snake.length - 1; i++) {
      if (this.snake[i].x === head.x && this.snake[i].y === head.y) {
        this._gameOver = true;
        return;
      }
    }

    this.snake.unshift(head);

    if (head.x === this.food.x && head.y === this.food.y) {
      this.score += 10;
      this.moveIntervalMs = Math.max(50, this.moveIntervalMs - 2);
      this.spawnFood();
    } else {
      this.snake.pop();
    }
  }

  private spawnFood(): void {
    const occupied = new Set(this.snake.map(p => `${p.x},${p.y}`));
    const free: Point[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!occupied.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    if (free.length === 0) {
      this._gameOver = true;
      return;
    }
    this.food = free[Math.floor(Math.random() * free.length)];
  }

  private inBounds(p: Point): boolean {
    return p.x >= 0 && p.x < this.width && p.y >= 0 && p.y < this.height;
  }
}
