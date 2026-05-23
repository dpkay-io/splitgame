import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONNECT_RETRIES = 3;
const CONNECT_DELAY_MS = 500;
const IPC_TIMEOUT_MS = 10000;
const MAX_IPC_BUFFER_SIZE = 1024 * 1024; // 1 MB

let ipcSocket: net.Socket | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();
let ipcBuffer = '';

function connectIpc(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let port = 0;
    let authToken = '';
    try {
      const dir = path.join(os.homedir(), '.splitgame');
      const files = fs.readdirSync(dir)
        .filter(f => f.startsWith('ipc-port'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const file of files) {
        try {
          const lines = fs.readFileSync(path.join(dir, file.name), 'utf-8').trim().split('\n');
          const p = parseInt(lines[0].trim(), 10);
          const t = (lines[1] || '').trim();
          if (p && t) { port = p; authToken = t; break; }
        } catch { continue; }
      }
      if (!port || !authToken) throw new Error('no valid port files');
    } catch {
      reject(new Error('splitgame is not running (no ipc-port file)'));
      return;
    }

    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.removeListener('error', onConnectError);
      socket.on('error', () => {
        ipcSocket = null;
      });
      // Authenticate before any JSON-RPC requests
      socket.write(JSON.stringify({ auth: authToken }) + '\n');
      resolve(socket);
    });

    function onConnectError(err: Error) { reject(err); }
    socket.on('error', onConnectError);

    socket.on('data', (data) => {
      ipcBuffer += data.toString();
      if (ipcBuffer.length > MAX_IPC_BUFFER_SIZE) {
        process.stderr.write('splitgame MCP: IPC buffer exceeded 1MB limit, clearing\n');
        ipcBuffer = '';
        for (const p of pending.values()) {
          p.reject(new Error('IPC buffer overflow'));
        }
        pending.clear();
        return;
      }
      let idx: number;
      while ((idx = ipcBuffer.indexOf('\n')) !== -1) {
        const line = ipcBuffer.slice(0, idx).trim();
        ipcBuffer = ipcBuffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message));
            else p.resolve(msg.result);
          }
        } catch {}
      }
    });

    socket.on('close', () => {
      for (const p of pending.values()) {
        p.reject(new Error('IPC connection closed'));
      }
      pending.clear();
      ipcSocket = null;
    });
  });
}

async function ensureConnection(): Promise<net.Socket> {
  if (ipcSocket && !ipcSocket.destroyed) return ipcSocket;

  for (let i = 0; i < CONNECT_RETRIES; i++) {
    try {
      ipcSocket = await connectIpc();
      return ipcSocket;
    } catch {
      if (i < CONNECT_RETRIES - 1) {
        await new Promise(r => setTimeout(r, CONNECT_DELAY_MS));
      }
    }
  }
  throw new Error('Cannot connect to splitgame IPC server');
}

function ipcCall(method: string, params?: Record<string, unknown>): Promise<any> {
  return new Promise(async (resolve, reject) => {
    try {
      const socket = await ensureConnection();
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`IPC call '${method}' timed out`));
      }, IPC_TIMEOUT_MS);
      pending.set(id, {
        resolve: (val: any) => { clearTimeout(timer); resolve(val); },
        reject: (err: Error) => { clearTimeout(timer); reject(err); },
      });
      socket.write(JSON.stringify({ id, method, params: params || {} }) + '\n');
    } catch (err) {
      reject(err);
    }
  });
}

function formatGameState(state: any): string {
  if (!state || state.error) return 'No active game. Toggle the game panel and select a game first.';

  const lines: string[] = [];
  lines.push(`Game: ${state.game}`);
  if (state.board) lines.push(`Board: ${state.board}`);
  lines.push(`Score: ${state.score}`);
  lines.push(`Status: ${state.status}`);
  if (state.turn) lines.push(`Turn: ${state.turn}`);
  if (state.validMoves?.length) lines.push(`Valid moves: ${state.validMoves.join(';')}`);
  if (state.message) lines.push(`Message: ${state.message}`);
  return lines.join('\n');
}

async function main() {
  const server = new McpServer(
    { name: 'splitgame', version: '1.0.0' },
    {
      instructions: `You are connected to a split-terminal game panel running alongside the user's CLI. The user can see a game on the right side of their terminal.

When the user asks you to play a game (e.g. "play tic tac toe", "your turn", "go", "make a move"):
1. Call get_game_state to see the current board
2. If there is no active game, call select_game to start one (e.g. gameId "tic-tac-toe")
3. If it's the player's turn, call wait_for_turn to wait for their move (up to 30s)
4. If it's your turn (Turn: claude), call make_move with your chosen move
5. After making a move, call wait_for_turn to wait for the player's next move
6. Repeat steps 3-5 until the game ends (Status: gameover), then report the result
7. If wait_for_turn returns "Game ended" — the player left the game. Stop playing and acknowledge.
8. If the user asks to play again after a game ended, call select_game again to start a new game.

For tic-tac-toe: you are O, the player is X. Moves are "row,col" (0-indexed). Play strategically — try to win! After starting the game, the player moves first — immediately call wait_for_turn.

IMPORTANT: Do NOT simulate or describe a game in text. Use the MCP tools to interact with the REAL game on the user's screen. Keep chat responses minimal — just play.`,
    },
  );

  server.tool(
    'get_game_state',
    'Get the current game board, score, whose turn, and valid moves. Board format: rows separated by |, _ for empty cells. For tic-tac-toe: X=player, O=claude. Example: "XO_|_X_|__O"',
    {},
    async () => {
      try {
        const state = await ipcCall('get_game_state');
        return { content: [{ type: 'text' as const, text: formatGameState(state) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
      }
    },
  );

  server.tool(
    'make_move',
    'Make a move in the current game. Only works for games that support external moves (marked [vs Claude] in get_game_info). For tic-tac-toe: "row,col" (0-indexed), e.g. "1,1" for center. Call get_game_state to see valid moves.',
    { move: z.string().describe('The move to make') },
    async ({ move }) => {
      try {
        const result = await ipcCall('make_move', { move });
        if (result.success) {
          const stateText = result.state ? '\n' + formatGameState(result.state) : '';
          return { content: [{ type: 'text' as const, text: `Move accepted.${stateText}` }] };
        }
        return { content: [{ type: 'text' as const, text: `Move rejected: ${result.error}` }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
      }
    },
  );

  server.tool(
    'wait_for_turn',
    'Wait for it to become Claude\'s turn. Blocks until the player makes a move (up to 30s). Use in a loop to play a full game: call wait_for_turn, then make_move, repeat until gameover. Returns null on timeout (call again to keep waiting).',
    {},
    async () => {
      try {
        const state = await ipcCall('wait_for_turn', { timeoutMs: 30000 });
        if (!state || state.timeout) {
          return { content: [{ type: 'text' as const, text: 'Timeout - player has not moved yet. Call wait_for_turn again to keep waiting.' }] };
        }
        if (state.status === 'ended') {
          return { content: [{ type: 'text' as const, text: 'Game ended. The player returned to the menu. Stop playing.' }] };
        }
        return { content: [{ type: 'text' as const, text: formatGameState(state) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
      }
    },
  );

  server.tool(
    'get_game_info',
    'List available games and which game is currently active. Shows which games support playing against Claude.',
    {},
    async () => {
      try {
        const info = await ipcCall('get_game_info');
        const lines = [`Current: ${info.currentGame || 'none (in menu)'}`];
        lines.push('Games:');
        for (const g of info.availableGames) {
          const tag = g.supportsExternalMoves ? ' [vs Claude]' : '';
          lines.push(`  ${g.id} - ${g.name}${tag}`);
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
      }
    },
  );

  server.tool(
    'select_game',
    'Open the game panel and start a specific game. Use when no game is active or to switch games. After starting tic-tac-toe, the player moves first (X) — call wait_for_turn immediately.',
    { gameId: z.string().describe('Game ID: "tictactoe", "snake", "2048", "tetris", "breakout", "minesweeper", "flappy"') },
    async ({ gameId }) => {
      try {
        const result = await ipcCall('select_game', { gameId });
        if (result.success) {
          const stateText = result.state ? '\n' + formatGameState(result.state) : '';
          return { content: [{ type: 'text' as const, text: `Game started.${stateText}` }] };
        }
        return { content: [{ type: 'text' as const, text: `Failed: ${result.error}` }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`splitgame MCP server error: ${err.message}\n`);
  process.exit(1);
});
