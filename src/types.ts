export enum AppState {
  GAME_ACTIVE = 'GAME_ACTIVE',
  GAME_PAUSED = 'GAME_PAUSED',
  GAME_MINIMIZED = 'GAME_MINIMIZED',
  EXITING = 'EXITING',
}

export enum InputFocus {
  CHILD = 'CHILD',
  GAME = 'GAME',
}

export enum StateTransition {
  TOGGLE = 'TOGGLE',
  MANUAL_PAUSE = 'MANUAL_PAUSE',
  MINIMIZE = 'MINIMIZE',
  RESUME = 'RESUME',
  CHILD_EXIT = 'CHILD_EXIT',
  FATAL_ERROR = 'FATAL_ERROR',
}

export interface ANSIColor {
  mode: 'default' | 'palette' | 'rgb';
  value: number;
}

export interface ScreenCell {
  char: string;
  width: number;
  fg: ANSIColor;
  bg: ANSIColor;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

export interface IGame {
  readonly name: string;
  init(width: number, height: number): void;
  tick(deltaMs: number): void;
  handleInput(key: string): void;
  getState(): GameRenderState;
  resize(width: number, height: number): void;
  isPaused(): boolean;
  pause(): void;
  resume(): void;
  isGameOver(): boolean;
  reset(): void;

  readonly supportsExternalMoves?: boolean;
  getCompactState?(): { board: string; validMoves: string[]; turn: 'player' | 'external' | null };
  externalMove?(move: string): boolean;
  setOpponentMode?(mode: 'ai' | 'claude'): void;
}

export interface GameRenderState {
  grid: GameCell[][];
  score: number;
  status: 'playing' | 'paused' | 'gameover';
  statusMessage?: string;
}

export interface GameCell {
  char: string;
  fg: ANSIColor;
  bg: ANSIColor;
}

export interface PanelGeometry {
  leftWidth: number;
  rightWidth: number;
  height: number;
  borderCol: number;
}

export interface AppStateSnapshot {
  state: AppState;
  inputFocus: InputFocus;
  gameVisible: boolean;
}
