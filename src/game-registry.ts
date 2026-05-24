import { IGame } from './types';
import { SnakeGame } from './games/snake';
import { Game2048 } from './games/game-2048';
import { TetrisGame } from './games/tetris';
import { TicTacToeGame } from './games/tic-tac-toe';
import { BreakoutGame } from './games/breakout';
import { MinesweeperGame } from './games/minesweeper';
import { FlappyBirdGame } from './games/flappy-bird';

export interface GameInfo {
  id: string;
  name: string;
  create: () => IGame;
  supportsExternalMoves?: boolean;
}

const registry: GameInfo[] = [
  { id: 'snake', name: 'Snake', create: () => new SnakeGame() },
  { id: '2048', name: '2048', create: () => new Game2048() },
  { id: 'tetris', name: 'Tetris', create: () => new TetrisGame() },
  { id: 'tictactoe', name: 'Tic-Tac-Toe', create: () => new TicTacToeGame(), supportsExternalMoves: true },
  { id: 'breakout', name: 'Breakout', create: () => new BreakoutGame() },
  { id: 'minesweeper', name: 'Minesweeper', create: () => new MinesweeperGame() },
  { id: 'flappy', name: 'Flappy Bird', create: () => new FlappyBirdGame() },
];

export function getGameList(): GameInfo[] {
  return registry;
}

export function findGame(idOrName: string): GameInfo | undefined {
  const lower = idOrName.toLowerCase();
  return registry.find(g => g.id === lower || g.name.toLowerCase() === lower);
}

export function createGame(id: string): IGame {
  const info = findGame(id);
  if (!info) throw new Error(`Unknown game: ${id}`);
  return info.create();
}

export function getDefaultGameId(): string {
  return 'snake';
}
