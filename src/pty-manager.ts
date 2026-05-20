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
      return result.trim().split(/\r?\n/)[0].trim();
    } catch {
      return command;
    }
  }

  spawn(command: string, args: string[], cols: number, rows: number): void {
    this.ptyProcess = pty.spawn(this.resolveCommand(command), args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.cwd(),
      env: { ...process.env, SPLITGAME_ACTIVE: '1' } as Record<string, string>,
      ...(process.platform === 'win32' ? { useConpty: true } : {}),
    });

    this.ptyProcess.onData(this.onData);
    this.ptyProcess.onExit(({ exitCode }) => this.onExit(exitCode));
  }

  write(data: string): void {
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
