import { IGame, GameRenderState } from './types';

export class GameEngine {
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastTick: number = 0;
  private readonly TICK_INTERVAL_MS = 16;

  constructor(private game: IGame) {}

  init(width: number, height: number): void {
    this.game.init(width, height);
  }

  start(): void {
    if (this.intervalHandle) return;
    this.lastTick = Date.now();
    this.intervalHandle = setInterval(() => {
      const now = Date.now();
      const delta = now - this.lastTick;
      this.lastTick = now;
      if (!this.game.isPaused() && !this.game.isGameOver()) {
        this.game.tick(delta);
      }
    }, this.TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  handleInput(key: string): void {
    this.game.handleInput(key);
  }

  getState(): GameRenderState {
    return this.game.getState();
  }

  resize(width: number, height: number): void {
    this.game.resize(width, height);
  }

  pause(): void { this.game.pause(); }
  resume(): void { this.game.resume(); }
  reset(): void { this.game.reset(); }
  get isPaused(): boolean { return this.game.isPaused(); }
  get isGameOver(): boolean { return this.game.isGameOver(); }
}
