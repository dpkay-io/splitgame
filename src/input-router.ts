import { InputFocus } from './types';
import { ToggleKey, ModifierKey } from './config';

type InputCallback = (data: Buffer) => void;

export class InputRouter {
  private lastEscapeTime: number = 0;
  private escapeTimer: NodeJS.Timeout | null = null;
  private readonly DOUBLE_TAP_WINDOW_MS = 300;
  private readonly ESC_FORWARD_DELAY_MS = 50;
  private toggleKey: ToggleKey;
  private modifierKey: ModifierKey;

  constructor(
    private onToggle: () => void,
    private onChildInput: InputCallback,
    private onGameInput: (key: string) => void,
    private getFocus: () => InputFocus,
    toggleKey: ToggleKey = 'esc+esc',
    modifierKey: ModifierKey = 'ctrl',
  ) {
    this.toggleKey = toggleKey;
    this.modifierKey = modifierKey;
  }

  setToggleKey(key: ToggleKey): void {
    this.toggleKey = key;
    if (this.escapeTimer) {
      clearTimeout(this.escapeTimer);
      this.escapeTimer = null;
    }
    this.lastEscapeTime = 0;
  }

  setModifierKey(key: ModifierKey): void {
    this.modifierKey = key;
  }

  start(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('data', this.handleData);
  }

  stop(): void {
    process.stdin.removeListener('data', this.handleData);
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    try {
      process.stdin.pause();
    } catch {
      // May already be closed
    }
  }

  private handleData = (data: Buffer): void => {
    if (this.checkSingleKeyToggle(data)) {
      this.onToggle();
      return;
    }

    if (this.toggleKey === 'esc+esc') {
      if (data.length === 2 && data[0] === 0x1b && data[1] === 0x1b) {
        this.lastEscapeTime = 0;
        if (this.escapeTimer) {
          clearTimeout(this.escapeTimer);
          this.escapeTimer = null;
        }
        this.onToggle();
        return;
      }

      if (data.length === 1 && data[0] === 0x1b) {
        const now = Date.now();
        if (now - this.lastEscapeTime < this.DOUBLE_TAP_WINDOW_MS) {
          this.lastEscapeTime = 0;
          if (this.escapeTimer) {
            clearTimeout(this.escapeTimer);
            this.escapeTimer = null;
          }
          this.onToggle();
          return;
        }
        this.lastEscapeTime = now;
        this.escapeTimer = setTimeout(() => {
          this.escapeTimer = null;
          this.forwardInput(Buffer.from([0x1b]));
        }, this.ESC_FORWARD_DELAY_MS);
        return;
      }

      if (this.escapeTimer) {
        clearTimeout(this.escapeTimer);
        this.escapeTimer = null;
        this.lastEscapeTime = 0;
        const combined = Buffer.concat([Buffer.from([0x1b]), data]);
        this.forwardInput(combined);
        return;
      }
    }

    this.forwardInput(data);
  };

  private checkSingleKeyToggle(data: Buffer): boolean {
    if (this.toggleKey === 'ctrl+g' && data.length === 1 && data[0] === 0x07) return true;
    if (this.toggleKey === 'ctrl+]' && data.length === 1 && data[0] === 0x1d) return true;
    return false;
  }

  private forwardInput(data: Buffer): void {
    const focus = this.getFocus();
    if (focus === InputFocus.CHILD) {
      this.onChildInput(data);
    } else {
      const key = this.parseKey(data);
      if (key) this.onGameInput(key);
    }
  }

  private parseKey(data: Buffer): string | null {
    const s = data.toString('utf8');

    // Modifier + arrow keys (resize)
    const modParam = this.modifierKey === 'ctrl' ? '5' : '3';
    if (s === `\x1b[1;${modParam}C`) return 'resize-right';
    if (s === `\x1b[1;${modParam}D`) return 'resize-left';

    if (s === '\x1b[A') return 'up';
    if (s === '\x1b[B') return 'down';
    if (s === '\x1b[C') return 'right';
    if (s === '\x1b[D') return 'left';

    if (s === 'w' || s === 'W') return 'up';
    if (s === 'a' || s === 'A') return 'left';
    if (s === 's' || s === 'S') return 'down';
    if (s === 'd' || s === 'D') return 'right';

    if (data.length === 1 && data[0] === 0) return 'pause';
    if (s === 'm' || s === 'M') return 'minimize';
    if (s === 'r' || s === 'R') return 'reset';
    if (s === 'q' || s === 'Q') return 'quit';
    if (s === 'f' || s === 'F') return 'flag';
    if (s === 'n' || s === 'N') return 'next-game';
    if (s === ' ') return 'space';
    if (s === '\r' || s === '\n') return 'enter';
    if (s === '\t') return 'tab';
    if (s === '\x1b[Z') return 'shift-tab';

    if (data.length === 1 && data[0] === 3) return 'ctrl-c';

    return null;
  }
}
