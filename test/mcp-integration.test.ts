import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Orchestrator } from '../src/orchestrator';
import { ConfigManager } from '../src/config';

// Mock pty-manager to avoid spawning real processes
vi.mock('../src/pty-manager', () => {
  return {
    PtyManager: vi.fn().mockImplementation(function() {
      return {
        spawn: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      };
    }),
  };
});

// Mock Renderer to avoid TTY issues
vi.mock('../src/renderer', () => {
  return {
    Renderer: vi.fn().mockImplementation(function() {
      return {
        calculateGeometry: () => ({ leftWidth: 40, rightWidth: 40, height: 24 }),
        updateGeometry: () => ({ leftWidth: 40, rightWidth: 40, height: 24 }),
        renderSplit: vi.fn(),
        renderFullscreen: vi.fn(),
        invalidate: vi.fn(),
        setGameWidthPercent: vi.fn(),
      };
    }),
  };
});

function readPortFile(portFile: string): { port: number; token: string } {
  const content = fs.readFileSync(portFile, 'utf-8').trim().split('\n');
  return { port: parseInt(content[0], 10), token: content[1] };
}

function authenticate(client: net.Socket, token: string): Promise<void> {
  return new Promise((resolve) => {
    client.write(JSON.stringify({ auth: token }) + '\n');
    setTimeout(resolve, 100);
  });
}

describe('MCP Integration', () => {
  const PORT_FILE = path.join(os.homedir(), '.splitgame', 'ipc-port');
  let orchestrator: Orchestrator;

  beforeEach(() => {
    if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
  });

  afterEach(() => {
    if (orchestrator) (orchestrator as any).cleanup();
    if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
  });

  it('should launch tictactoe with -g flag and respond to IPC', async () => {
    orchestrator = new Orchestrator({
      command: 'echo',
      args: ['hello'],
      gameId: 'tictactoe'
    });

    orchestrator.start();

    // Wait for IPC port file
    let port = 0;
    let token = '';
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(PORT_FILE)) {
        ({ port, token } = readPortFile(PORT_FILE));
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    expect(port).toBeGreaterThan(0);

    // Connect mock MCP client and authenticate
    const client = net.createConnection({ port });
    await new Promise(r => client.once('connect', r));
    await authenticate(client, token);

    const responsePromise = new Promise<any>((resolve) => {
      client.on('data', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    client.write(JSON.stringify({ id: 1, method: 'get_game_state' }) + '\n');
    const response = await responsePromise;

    expect(response.result.game).toBe('tictactoe');
    expect(response.result.turn).toBe('player');

    client.end();
  });

  it('should transition to Claude turn after player move when MCP selects game', async () => {
    orchestrator = new Orchestrator({
      command: 'echo',
      args: ['hello'],
    });

    orchestrator.start();

    // Wait for IPC port file
    let port = 0;
    let token = '';
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(PORT_FILE)) {
        ({ port, token } = readPortFile(PORT_FILE));
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    expect(port).toBeGreaterThan(0);
    const client = net.createConnection({ port });
    await new Promise(r => client.once('connect', r));
    await authenticate(client, token);

    // Use select_game to start in claude mode
    const selectPromise = new Promise<any>((resolve) => {
      client.once('data', (data) => resolve(JSON.parse(data.toString())));
    });
    client.write(JSON.stringify({ id: 1, method: 'select_game', params: { gameId: 'tictactoe' } }) + '\n');
    await selectPromise;

    // Simulate player move (center)
    (orchestrator as any).onGameInput('enter');

    // Check state via IPC
    const responsePromise = new Promise<any>((resolve) => {
      client.once('data', (data) => resolve(JSON.parse(data.toString())));
    });

    client.write(JSON.stringify({ id: 2, method: 'get_game_state' }) + '\n');
    const response = await responsePromise;

    // It should now be Claude's turn
    expect(response.result.turn).toBe('claude');
    expect(response.result.status).toBe('waiting_for_claude');
    expect(response.result.board).toContain('X');

    client.end();
  });

  it('should use AI mode when game launched from menu (not via select_game)', async () => {
    orchestrator = new Orchestrator({
      command: 'echo',
      args: ['hello'],
    });

    orchestrator.start();

    // Wait for IPC port file
    let port = 0;
    let token = '';
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(PORT_FILE)) {
        ({ port, token } = readPortFile(PORT_FILE));
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    const client = net.createConnection({ port });
    await new Promise(r => client.once('connect', r));
    await authenticate(client, token);

    // Launch game from menu (NOT via select_game) — should be AI mode
    (orchestrator as any).launchGame('tictactoe');

    // Simulate player move (center)
    (orchestrator as any).onGameInput('enter');

    // Check state via IPC
    const responsePromise = new Promise<any>((resolve) => {
      client.once('data', (data) => resolve(JSON.parse(data.toString())));
    });

    client.write(JSON.stringify({ id: 3, method: 'get_game_state' }) + '\n');
    const response = await responsePromise;

    // AI mode: after player move, AI responds immediately — still player's turn
    expect(response.result.game).toBe('tictactoe');
    expect(response.result.turn).toBe('player');

    client.end();
  });
});
