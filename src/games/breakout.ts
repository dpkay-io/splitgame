import { IGame, GameRenderState, GameCell, ANSIColor } from '../types';

const DEFAULT: ANSIColor = { mode: 'default', value: 0 };
const WHITE: ANSIColor = { mode: 'palette', value: 15 };
const BRIGHT_YELLOW: ANSIColor = { mode: 'palette', value: 11 };
const RED: ANSIColor = { mode: 'palette', value: 1 };
const YELLOW: ANSIColor = { mode: 'palette', value: 3 };
const GREEN: ANSIColor = { mode: 'palette', value: 2 };
const CYAN: ANSIColor = { mode: 'palette', value: 6 };
const MAGENTA: ANSIColor = { mode: 'palette', value: 5 };
const DARK_GRAY: ANSIColor = { mode: 'palette', value: 8 };

const ROW_COLORS: ANSIColor[] = [RED, YELLOW, GREEN, CYAN, MAGENTA];

const BRICK_WIDTH = 3;
const PADDLE_WIDTH = 7;
const BALL_CHAR = '●';
const BRICK_CHAR = '█';
const PADDLE_CHAR = '═';
const BALL_TICK_MS = 50;
const INITIAL_LIVES = 3;

interface Brick {
  x: number;       // left column of the brick
  y: number;       // row
  alive: boolean;
  colorRow: number; // index into ROW_COLORS
}

export class BreakoutGame implements IGame {
  readonly name = 'Breakout';

  private width = 0;
  private height = 0;

  private paddleX = 0;
  private ballX = 0;
  private ballY = 0;
  private ballDx = 0;
  private ballDy = 0;
  private ballAttached = true;
  private ballAccumulator = 0;

  private bricks: Brick[] = [];
  private score = 0;
  private lives = INITIAL_LIVES;
  private level = 1;

  private _paused = false;
  private _gameOver = false;

  init(width: number, height: number): void {
    this.width = Math.max(10, width);
    this.height = Math.max(10, height);
    this.reset();
  }

  tick(deltaMs: number): void {
    if (this._paused || this._gameOver || this.ballAttached) return;

    this.ballAccumulator += deltaMs;
    while (this.ballAccumulator >= BALL_TICK_MS) {
      this.ballAccumulator -= BALL_TICK_MS;
      this.moveBall();
      if (this._gameOver || this.ballAttached) break;
    }
  }

  handleInput(key: string): void {
    if (this._gameOver) {
      if (key === 'reset' || key === 'r') this.reset();
      return;
    }

    switch (key) {
      case 'left':
        this.paddleX = Math.max(0, this.paddleX - 2);
        if (this.ballAttached) this.ballX = this.paddleX + Math.floor(PADDLE_WIDTH / 2);
        break;
      case 'right':
        this.paddleX = Math.min(this.width - PADDLE_WIDTH, this.paddleX + 2);
        if (this.ballAttached) this.ballX = this.paddleX + Math.floor(PADDLE_WIDTH / 2);
        break;
      case 'space':
        if (this.ballAttached) this.launchBall();
        break;
      case 'pause':
        this._paused ? this.resume() : this.pause();
        break;
    }
  }

  getState(): GameRenderState {
    const grid: GameCell[][] = [];
    const empty: GameCell = { char: ' ', fg: DEFAULT, bg: DEFAULT };

    for (let row = 0; row < this.height; row++) {
      grid[row] = [];
      for (let col = 0; col < this.width; col++) {
        grid[row][col] = { ...empty };
      }
    }

    // Bricks
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const color = ROW_COLORS[brick.colorRow % ROW_COLORS.length];
      for (let i = 0; i < BRICK_WIDTH; i++) {
        const col = brick.x + i;
        if (col >= 0 && col < this.width && brick.y >= 0 && brick.y < this.height) {
          grid[brick.y][col] = { char: BRICK_CHAR, fg: color, bg: DEFAULT };
        }
      }
    }

    // Paddle
    const paddleY = this.height - 2;
    for (let i = 0; i < PADDLE_WIDTH; i++) {
      const col = this.paddleX + i;
      if (col >= 0 && col < this.width && paddleY >= 0 && paddleY < this.height) {
        grid[paddleY][col] = { char: PADDLE_CHAR, fg: WHITE, bg: DEFAULT };
      }
    }

    // Ball
    const bx = Math.round(this.ballX);
    const by = Math.round(this.ballY);
    if (bx >= 0 && bx < this.width && by >= 0 && by < this.height) {
      grid[by][bx] = { char: BALL_CHAR, fg: BRIGHT_YELLOW, bg: DEFAULT };
    }

    let statusMessage: string;
    if (this._gameOver) {
      statusMessage = 'GAME OVER - Press R';
    } else if (this._paused) {
      statusMessage = 'PAUSED - Ctrl+Space';
    } else if (this.ballAttached) {
      statusMessage = `Lives: ${this.lives} | Lv ${this.level} | SPACE to launch`;
    } else {
      statusMessage = `Lives: ${this.lives} | Lv ${this.level}`;
    }

    return {
      grid,
      score: this.score,
      status: this._gameOver ? 'gameover' : this._paused ? 'paused' : 'playing',
      statusMessage,
    };
  }

  resize(width: number, height: number): void {
    this.width = Math.max(10, width);
    this.height = Math.max(10, height);
    // Clamp paddle
    this.paddleX = Math.min(this.paddleX, this.width - PADDLE_WIDTH);
    this.paddleX = Math.max(0, this.paddleX);
    // Clamp ball
    this.ballX = Math.min(this.ballX, this.width - 1);
    this.ballY = Math.min(this.ballY, this.height - 1);
    if (this.ballAttached) {
      this.ballX = this.paddleX + Math.floor(PADDLE_WIDTH / 2);
      this.ballY = this.height - 3;
    }
  }

  isPaused(): boolean { return this._paused; }
  pause(): void { this._paused = true; }
  resume(): void { if (!this._gameOver) this._paused = false; }
  isGameOver(): boolean { return this._gameOver; }

  reset(): void {
    this._gameOver = false;
    this._paused = false;
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.level = 1;
    this.ballAccumulator = 0;
    this.initLevel();
  }

  private initLevel(): void {
    this.ballAttached = true;
    this.paddleX = Math.floor((this.width - PADDLE_WIDTH) / 2);
    this.ballX = this.paddleX + Math.floor(PADDLE_WIDTH / 2);
    this.ballY = this.height - 3;
    this.ballDx = 0;
    this.ballDy = 0;
    this.ballAccumulator = 0;
    this.buildBricks();
  }

  private buildBricks(): void {
    this.bricks = [];
    const rows = Math.min(3 + this.level - 1, 5);
    const startRow = 2;
    // Bricks are BRICK_WIDTH wide with 1-char gap
    const brickSlot = BRICK_WIDTH + 1;
    const bricksPerRow = Math.floor((this.width - 1) / brickSlot);
    const totalBrickWidth = bricksPerRow * brickSlot - 1;
    const offsetX = Math.floor((this.width - totalBrickWidth) / 2);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < bricksPerRow; c++) {
        this.bricks.push({
          x: offsetX + c * brickSlot,
          y: startRow + r,
          alive: true,
          colorRow: r,
        });
      }
    }
  }

  private launchBall(): void {
    this.ballAttached = false;
    this.ballDx = (Math.random() < 0.5 ? -1 : 1);
    this.ballDy = -1;
  }

  private moveBall(): void {
    const nextX = this.ballX + this.ballDx;
    const nextY = this.ballY + this.ballDy;

    // Side walls
    if (nextX < 0 || nextX >= this.width) {
      this.ballDx = -this.ballDx;
    }

    // Top wall
    if (nextY < 0) {
      this.ballDy = -this.ballDy;
    }

    // Below screen — lose life
    if (nextY >= this.height) {
      this.lives--;
      if (this.lives <= 0) {
        this._gameOver = true;
        return;
      }
      this.resetBall();
      return;
    }

    // Paddle collision
    const paddleY = this.height - 2;
    if (this.ballDy > 0 && Math.round(nextY) === paddleY) {
      const bx = Math.round(nextX);
      if (bx >= this.paddleX && bx < this.paddleX + PADDLE_WIDTH) {
        this.ballDy = -this.ballDy;
        // Adjust dx based on hit position relative to paddle center
        const hitPos = (bx - this.paddleX) / (PADDLE_WIDTH - 1); // 0..1
        const offset = hitPos - 0.5; // -0.5..0.5
        this.ballDx = offset * 2.5; // range roughly -1.25..1.25
        // Ensure some horizontal movement
        if (Math.abs(this.ballDx) < 0.3) {
          this.ballDx = this.ballDx >= 0 ? 0.3 : -0.3;
        }
        this.ballX = nextX;
        this.ballY = paddleY - 1;
        return;
      }
    }

    // Brick collision
    const hitBrick = this.checkBrickCollision(Math.round(nextX), Math.round(nextY));
    if (hitBrick) {
      hitBrick.alive = false;
      this.score += 10;

      // Determine reflection: compare ball center vs brick bounds
      const brickLeft = hitBrick.x;
      const brickRight = hitBrick.x + BRICK_WIDTH - 1;
      const bx = Math.round(this.ballX);
      const by = Math.round(this.ballY);

      // If the ball was horizontally outside the brick, reflect dx; otherwise reflect dy
      if (bx < brickLeft || bx > brickRight) {
        this.ballDx = -this.ballDx;
      } else {
        this.ballDy = -this.ballDy;
      }

      // Check level clear
      if (this.bricks.every(b => !b.alive)) {
        this.score += 50 * this.level;
        this.level++;
        this.initLevel();
        return;
      }

      // Still apply movement with the reflected velocity
      this.ballX += this.ballDx;
      this.ballY += this.ballDy;
      return;
    }

    // Normal movement
    this.ballX += this.ballDx;
    this.ballY += this.ballDy;
  }

  private checkBrickCollision(bx: number, by: number): Brick | null {
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      if (by === brick.y && bx >= brick.x && bx < brick.x + BRICK_WIDTH) {
        return brick;
      }
    }
    return null;
  }

  private resetBall(): void {
    this.ballAttached = true;
    this.ballAccumulator = 0;
    this.paddleX = Math.floor((this.width - PADDLE_WIDTH) / 2);
    this.ballX = this.paddleX + Math.floor(PADDLE_WIDTH / 2);
    this.ballY = this.height - 3;
    this.ballDx = 0;
    this.ballDy = 0;
  }
}
