import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IpcServer, GameBridge, CompactGameState } from '../src/ipc-server';

const PORT_FILE = path.join(os.homedir(), '.splitgame', 'ipc-port');

function createMockBridge(): GameBridge {
  return {
    getGameState: () => ({
      game: 'tictactoe',
      board: 'XO_|_X_|__O',
      score: 1,
      status: 'waiting_for_claude',
      turn: 'claude' as const,
      validMoves: ['0,2', '1,0', '2,0', '2,1'],
    }),
    makeMove: (move: string) => {
      if (move === '0,2') {
        return {
          success: true,
          state: {
            game: 'tictactoe',
            board: 'XOO|_X_|__O',
            score: 1,
            status: 'playing',
            turn: 'player' as const,
            validMoves: ['1,0', '2,0', '2,1'],
          },
        };
      }
      return { success: false, error: 'Invalid move' };
    },
    getAvailableGames: () => [
      { id: 'tictactoe', name: 'Tic-Tac-Toe', supportsExternalMoves: true },
      { id: 'snake', name: 'Snake', supportsExternalMoves: false },
    ],
    getCurrentGame: () => 'tictactoe',
  };
}

function readPortFile(): { port: number; token: string } {
  const content = fs.readFileSync(PORT_FILE, 'utf-8').trim();
  const [portStr, token] = content.split('\n');
  return { port: parseInt(portStr, 10), token };
}

function sendRequest(port: number, token: string, method: string, params?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      // Send auth handshake first
      socket.write(JSON.stringify({ auth: token }) + '\n');
      const id = Date.now();
      socket.write(JSON.stringify({ id, method, params: params || {} }) + '\n');

      let buffer = '';
      socket.on('data', (data) => {
        buffer += data.toString();
        const idx = buffer.indexOf('\n');
        if (idx !== -1) {
          const msg = JSON.parse(buffer.slice(0, idx));
          socket.destroy();
          resolve(msg);
        }
      });
    });
    socket.on('error', reject);
    setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, 3000);
  });
}

describe('IpcServer', () => {
  let server: IpcServer;

  beforeEach(async () => {
    server = new IpcServer(createMockBridge());
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  it('writes port file with port and auth token on start', () => {
    expect(fs.existsSync(PORT_FILE)).toBe(true);
    const { port, token } = readPortFile();
    expect(port).toBeGreaterThan(0);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('handles get_game_state', async () => {
    const { port, token } = readPortFile();
    const res = await sendRequest(port, token, 'get_game_state');
    expect(res.result.game).toBe('tictactoe');
    expect(res.result.board).toBe('XO_|_X_|__O');
    expect(res.result.turn).toBe('claude');
  });

  it('handles make_move with valid move', async () => {
    const { port, token } = readPortFile();
    const res = await sendRequest(port, token, 'make_move', { move: '0,2' });
    expect(res.result.success).toBe(true);
    expect(res.result.state.board).toBe('XOO|_X_|__O');
  });

  it('handles make_move with invalid move', async () => {
    const { port, token } = readPortFile();
    const res = await sendRequest(port, token, 'make_move', { move: 'bad' });
    expect(res.result.success).toBe(false);
    expect(res.result.error).toBe('Invalid move');
  });

  it('handles get_game_info', async () => {
    const { port, token } = readPortFile();
    const res = await sendRequest(port, token, 'get_game_info');
    expect(res.result.currentGame).toBe('tictactoe');
    expect(res.result.availableGames).toHaveLength(2);
    expect(res.result.availableGames[0].supportsExternalMoves).toBe(true);
  });

  it('rejects connections with wrong auth token', async () => {
    const { port } = readPortFile();
    await expect(sendRequest(port, 'wrong-token', 'get_game_state')).rejects.toThrow();
  });

  it('removes port file on stop', () => {
    server.stop();
    expect(fs.existsSync(PORT_FILE)).toBe(false);
  });
});
