import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const MAX_BUFFER_SIZE = 1024 * 1024; // 1 MB
const MAX_WAIT_TIMEOUT_MS = 60000;

export interface CompactGameState {
  game: string;
  board: string;
  score: number;
  status: string;
  turn: 'player' | 'claude' | null;
  validMoves: string[];
  message?: string;
}

export interface MoveResult {
  success: boolean;
  error?: string;
  state?: CompactGameState;
}

export interface GameBridge {
  getGameState(): CompactGameState | null;
  makeMove(move: string): MoveResult;
  getAvailableGames(): { id: string; name: string; supportsExternalMoves: boolean }[];
  getCurrentGame(): string | null;
  waitForTurn(timeoutMs: number): Promise<CompactGameState | null>;
  selectGame(gameId: string): { success: boolean; error?: string; state?: CompactGameState };
}

interface JsonRpcRequest {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class IpcServer {
  private server: net.Server | null = null;
  private client: net.Socket | null = null;
  private portFile: string;
  private authToken: string = '';
  private authenticated: boolean = false;
  private onClientConnect?: () => void;
  private onClientDisconnect?: () => void;

  constructor(
    private bridge: GameBridge,
    callbacks?: { onConnect?: () => void; onDisconnect?: () => void },
  ) {
    this.portFile = path.join(os.homedir(), '.splitgame', 'ipc-port');
    this.onClientConnect = callbacks?.onConnect;
    this.onClientDisconnect = callbacks?.onDisconnect;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.authToken = crypto.randomBytes(16).toString('hex');
      this.server = net.createServer((socket) => this.handleConnection(socket));
      this.server.on('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as net.AddressInfo;
        const dir = path.dirname(this.portFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.portFile, `${addr.port}\n${this.authToken}`, {
          encoding: 'utf-8',
          mode: 0o600,
        });
        resolve();
      });
    });
  }

  stop(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    try { fs.unlinkSync(this.portFile); } catch {}
  }

  get hasClient(): boolean {
    return this.client !== null && !this.client.destroyed && this.authenticated;
  }

  private handleConnection(socket: net.Socket): void {
    if (this.client && !this.client.destroyed) {
      this.client.destroy();
      this.onClientDisconnect?.();
    }

    this.client = socket;
    this.authenticated = false;
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      if (buffer.length > MAX_BUFFER_SIZE) {
        socket.destroy();
        return;
      }

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;

        if (!this.authenticated) {
          try {
            const msg = JSON.parse(line);
            if (msg.auth === this.authToken) {
              this.authenticated = true;
              this.onClientConnect?.();
              continue;
            }
          } catch {}
          socket.destroy();
          return;
        }

        this.handleMessage(socket, line);
      }
    });

    socket.on('close', () => {
      if (this.client === socket) {
        this.client = null;
        this.onClientDisconnect?.();
      }
    });

    socket.on('error', () => {
      if (this.client === socket) {
        this.client = null;
        this.onClientDisconnect?.();
      }
    });
  }

  private handleMessage(socket: net.Socket, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const obj = parsed as Record<string, unknown>;
    if (
      (typeof obj.id !== 'string' && typeof obj.id !== 'number') ||
      typeof obj.method !== 'string'
    ) {
      const errId = (typeof obj.id === 'string' || typeof obj.id === 'number') ? obj.id : 0;
      const errResp: JsonRpcResponse = {
        id: errId,
        error: { code: -32600, message: 'Invalid request: missing or invalid id/method' },
      };
      socket.write(JSON.stringify(errResp) + '\n');
      return;
    }

    const req = obj as unknown as JsonRpcRequest;

    if (req.method === 'wait_for_turn') {
      const raw_timeout = (req.params as any)?.timeoutMs ?? 30000;
      const timeout = Math.min(Number(raw_timeout) || 30000, MAX_WAIT_TIMEOUT_MS);
      this.bridge.waitForTurn(timeout).then((state) => {
        if (socket.destroyed) return;
        const response: JsonRpcResponse = {
          id: req.id,
          result: state || { timeout: true },
        };
        socket.write(JSON.stringify(response) + '\n');
      });
      return;
    }

    let response: JsonRpcResponse;

    switch (req.method) {
      case 'get_game_state': {
        const state = this.bridge.getGameState();
        response = { id: req.id, result: state || { error: 'No active game' } };
        break;
      }
      case 'make_move': {
        const move = (req.params as any)?.move;
        if (typeof move !== 'string') {
          response = { id: req.id, error: { code: -1, message: 'Missing move parameter' } };
        } else {
          const result = this.bridge.makeMove(move);
          response = { id: req.id, result };
        }
        break;
      }
      case 'select_game': {
        const gameId = (req.params as any)?.gameId;
        if (typeof gameId !== 'string') {
          response = { id: req.id, error: { code: -1, message: 'Missing gameId parameter' } };
        } else {
          const result = this.bridge.selectGame(gameId);
          response = { id: req.id, result };
        }
        break;
      }
      case 'get_game_info': {
        response = {
          id: req.id,
          result: {
            currentGame: this.bridge.getCurrentGame(),
            availableGames: this.bridge.getAvailableGames(),
          },
        };
        break;
      }
      default:
        response = { id: req.id, error: { code: -1, message: `Unknown method: ${req.method}` } };
    }

    socket.write(JSON.stringify(response) + '\n');
  }
}
