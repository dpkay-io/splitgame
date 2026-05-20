import { IGame, GameRenderState, GameCell, ANSIColor } from '../types';

const DEFAULT: ANSIColor = { mode: 'default', value: 0 };
const YELLOW: ANSIColor = { mode: 'palette', value: 11 };
const GREEN: ANSIColor = { mode: 'palette', value: 2 };
const BROWN: ANSIColor = { mode: 'palette', value: 130 };
const SKY_BG: ANSIColor = { mode: 'palette', value: 153 };
const WHITE: ANSIColor = { mode: 'palette', value: 15 };

interface Pipe {
  x: number;       // column position (float, scrolls left)
  gapTop: number;   // top row of the gap (inclusive)
  gapBottom: number; // bottom row of the gap (inclusive)
  scored: boolean;   // whether the bird has already passed this pipe
}

const BIRD_COL = 5;
const GRAVITY = 0.4;
const FLAP_VELOCITY = -3;
const TERMINAL_VELOCITY = 4;
const TICK_INTERVAL_MS = 80;
const PIPE_SPACING = 18; // columns between pipe spawns
const GAP_SIZE = 5;

export class FlappyBirdGame implements IGame {
  readonly name = 'Flappy Bird';

  private width = 0;
  private height = 0;
  private birdY = 0;
  private birdVelocity = 0;
  private pipes: Pipe[] = [];
  private score = 0;
  private _paused = false;
  private _gameOver = false;
  private started = false;
  private tickAccumulator = 0;
  private distanceSinceLastPipe = 0;

  init(width: number, height: number): void {
    this.width = Math.max(10, width);
    this.height = Math.max(8, height);
    this.reset();
  }

  tick(deltaMs: number): void {
    if (this._paused || this._gameOver || !this.started) return;

    this.tickAccumulator += deltaMs;
    while (this.tickAccumulator >= TICK_INTERVAL_MS) {
      this.tickAccumulator -= TICK_INTERVAL_MS;
      this.step();
      if (this._gameOver) break;
    }
  }

  handleInput(key: string): void {
    switch (key) {
      case 'space':
      case 'up':
        if (this._gameOver) {
          this.reset();
        } else if (!this.started) {
          this.started = true;
          this.flap();
        } else if (!this._paused) {
          this.flap();
        }
        break;
      case 'pause':
        this._paused ? this.resume() : this.pause();
        break;
      case 'reset':
        if (this._gameOver) this.reset();
        break;
    }
  }

  getState(): GameRenderState {
    const playableHeight = this.height - 1; // bottom row is ground
    const grid: GameCell[][] = [];

    // Fill sky
    for (let row = 0; row < this.height; row++) {
      grid[row] = [];
      for (let col = 0; col < this.width; col++) {
        grid[row][col] = { char: ' ', fg: DEFAULT, bg: SKY_BG };
      }
    }

    // Ground (bottom row)
    for (let col = 0; col < this.width; col++) {
      grid[this.height - 1][col] = { char: '▓', fg: BROWN, bg: DEFAULT };
    }

    // Pipes
    for (const pipe of this.pipes) {
      const col = Math.round(pipe.x);
      if (col < 0 || col >= this.width) continue;
      for (let row = 0; row < playableHeight; row++) {
        if (row < pipe.gapTop || row > pipe.gapBottom) {
          grid[row][col] = { char: '█', fg: GREEN, bg: DEFAULT };
        }
      }
    }

    // Bird
    const birdRow = Math.round(this.birdY);
    if (birdRow >= 0 && birdRow < playableHeight && BIRD_COL < this.width) {
      grid[birdRow][BIRD_COL] = { char: '►', fg: YELLOW, bg: SKY_BG };
    }

    // Score display at top center
    const scoreStr = String(this.score);
    const startCol = Math.floor((this.width - scoreStr.length) / 2);
    for (let i = 0; i < scoreStr.length; i++) {
      const col = startCol + i;
      if (col >= 0 && col < this.width) {
        grid[0][col] = { char: scoreStr[i], fg: WHITE, bg: SKY_BG };
      }
    }

    let statusMessage: string | undefined;
    if (this._gameOver) {
      statusMessage = 'Game Over! Press SPACE';
    } else if (this._paused) {
      statusMessage = 'PAUSED - Ctrl+Space to resume';
    } else if (!this.started) {
      statusMessage = 'Press SPACE to start';
    }

    return {
      grid,
      score: this.score,
      status: this._gameOver ? 'gameover' : this._paused ? 'paused' : 'playing',
      statusMessage,
    };
  }

  resize(width: number, height: number): void {
    const oldHeight = this.height;
    this.width = Math.max(10, width);
    this.height = Math.max(8, height);

    if (oldHeight > 0 && this.height !== oldHeight) {
      const ratio = (this.height - 1) / (oldHeight - 1);
      this.birdY *= ratio;
      for (const pipe of this.pipes) {
        pipe.gapTop = Math.round(pipe.gapTop * ratio);
        pipe.gapBottom = pipe.gapTop + GAP_SIZE - 1;
      }
    }
  }

  isPaused(): boolean { return this._paused; }
  pause(): void { this._paused = true; }
  resume(): void { if (!this._gameOver) this._paused = false; }
  isGameOver(): boolean { return this._gameOver; }

  reset(): void {
    this._gameOver = false;
    this._paused = false;
    this.started = false;
    this.score = 0;
    this.tickAccumulator = 0;
    this.birdY = Math.floor((this.height - 1) / 2);
    this.birdVelocity = 0;
    this.pipes = [];
    this.distanceSinceLastPipe = PIPE_SPACING; // spawn first pipe soon
  }

  private flap(): void {
    this.birdVelocity = FLAP_VELOCITY;
  }

  private step(): void {
    const playableHeight = this.height - 1;

    // Apply gravity
    this.birdVelocity += GRAVITY;
    if (this.birdVelocity > TERMINAL_VELOCITY) {
      this.birdVelocity = TERMINAL_VELOCITY;
    }
    this.birdY += this.birdVelocity;

    // Ceiling/floor collision
    if (this.birdY < 0) {
      this.birdY = 0;
      this.birdVelocity = 0;
    }
    if (this.birdY >= playableHeight) {
      this.birdY = playableHeight - 1;
      this._gameOver = true;
      return;
    }

    // Scroll pipes left
    for (const pipe of this.pipes) {
      pipe.x -= 1;
    }

    // Remove pipes that scrolled off screen
    this.pipes = this.pipes.filter(p => p.x >= -1);

    // Spawn new pipes
    this.distanceSinceLastPipe += 1;
    if (this.distanceSinceLastPipe >= PIPE_SPACING) {
      this.distanceSinceLastPipe = 0;
      this.spawnPipe();
    }

    // Scoring: bird passes a pipe
    const birdRow = Math.round(this.birdY);
    for (const pipe of this.pipes) {
      if (!pipe.scored && Math.round(pipe.x) < BIRD_COL) {
        pipe.scored = true;
        this.score += 1;
      }
    }

    // Collision with pipes
    for (const pipe of this.pipes) {
      const pipeCol = Math.round(pipe.x);
      if (pipeCol !== BIRD_COL) continue;
      if (birdRow < pipe.gapTop || birdRow > pipe.gapBottom) {
        this._gameOver = true;
        return;
      }
    }
  }

  private spawnPipe(): void {
    const playableHeight = this.height - 1;
    const minGapTop = 1;
    const maxGapTop = playableHeight - GAP_SIZE - 1;
    if (maxGapTop <= minGapTop) return; // too small to fit a pipe

    const gapTop = minGapTop + Math.floor(Math.random() * (maxGapTop - minGapTop + 1));
    this.pipes.push({
      x: this.width - 1,
      gapTop,
      gapBottom: gapTop + GAP_SIZE - 1,
      scored: false,
    });
  }
}
