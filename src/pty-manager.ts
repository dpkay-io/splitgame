import * as pty from 'node-pty';
import { execFileSync } from 'child_process';

export class PtyManager {
  private ptyProcess: pty.IPty | null = null;

  constructor(
    private onData: (data: string) => void,
    private onExit: (code: number) => void,
  ) {}

  private resolveCommand(command: string): string {
    if (process.platform !== 'win32') return command;
    if (/\.\w+$/.test(command) || command.includes('\\') || command.includes('/')) {
      return command;
    }
    try {
      const result = execFileSync('where.exe', [command], { encoding: 'utf-8', timeout: 5000 });
      const paths = result.trim().split(/\r?\n/).map(p => p.trim()).filter(Boolean);
      return paths.find(p => /\.exe$/i.test(p))
        || paths.find(p => /\.(cmd|bat)$/i.test(p))
        || paths[0];
    } catch {
      throw new Error(`command not found: ${command}`);
    }
  }

  spawn(command: string, args: string[], cols: number, rows: number): void {
    let resolved = this.resolveCommand(command);
    let spawnArgs = args;

    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
      spawnArgs = ['/c', resolved, ...args];
      resolved = 'cmd.exe';
    }

    this.ptyProcess = pty.spawn(resolved, spawnArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.cwd(),
      env: (() => {
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined) env[k] = v;
        }
        env.SPLITGAME_ACTIVE = '1';
        return env;
      })(),
      ...(process.platform === 'win32' ? { useConpty: true } : {}),
    });

    this.ptyProcess.onData(this.onData);
    this.ptyProcess.onExit(({ exitCode }) => this.onExit(exitCode ?? 1));
  }

  write(data: string): void {
    // ConPTY double-translation fix: outer terminal uses VT convention (0x7F=Backspace,
    // 0x08=Ctrl+Backspace) but inner ConPTY uses Win32 convention (0x08=Backspace,
    // 0x7F=Ctrl+Backspace). Swap so the child shell sees the correct key events.
    if (process.platform === 'win32' && (data.includes('\x7f') || data.includes('\x08'))) {
      let fixed = '';
      for (let i = 0; i < data.length; i++) {
        const c = data.charCodeAt(i);
        fixed += c === 0x7f ? '\x08' : c === 0x08 ? '\x7f' : data[i];
      }
      this.ptyProcess?.write(fixed);
      return;
    }
    this.ptyProcess?.write(data);
  }

  resize(cols: number, rows: number): void {
    try {
      this.ptyProcess?.resize(Math.max(1, cols), Math.max(1, rows));
    } catch {
      // Process may have already exited
    }
  }

  kill(): void {
    try {
      this.ptyProcess?.kill();
    } catch {
      // Already dead
    }
  }

  get pid(): number | undefined {
    return this.ptyProcess?.pid;
  }
}
