import { InputFocus } from './types';
import { ToggleKey, ModifierKey } from './config';

type InputCallback = (data: Buffer) => void;

export class InputRouter {
  private toggleKey: ToggleKey;
  private modifierKey: ModifierKey;

  constructor(
    private onToggle: () => void,
    private onChildInput: InputCallback,
    private onGameInput: (key: string) => void,
    private getFocus: () => InputFocus,
    private onScroll: (delta: number) => void,
    private isMouseIntercepted: () => boolean,
    toggleKey: ToggleKey = 'ctrl+]',
    modifierKey: ModifierKey = 'ctrl',
  ) {
    this.toggleKey = toggleKey;
    this.modifierKey = modifierKey;
  }

  setToggleKey(key: ToggleKey): void {
    this.toggleKey = key;
  }

  setModifierKey(key: ModifierKey): void {
    this.modifierKey = key;
  }

  start(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', this.handleData);
  }

  stop(): void {
    process.stdin.removeListener('data', this.handleData);
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
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

    if (this.isMouseIntercepted() && this.consumeMouseEvent(data)) return;

    this.forwardInput(data);
  };

  private consumeMouseEvent(data: Buffer): boolean {
    const s = data.toString('utf8');
    if (!s.startsWith('\x1b[<')) return false;
    const regex = /\x1b\[<(\d+);\d+;\d+[Mm]/g;
    for (const match of s.matchAll(regex)) {
      const button = parseInt(match[1]);
      if (button === 64) this.onScroll(-3);
      else if (button === 65) this.onScroll(3);
    }
    return true;
  }

  private checkSingleKeyToggle(data: Buffer): boolean {
    if (this.toggleKey === 'f12' && data.toString('utf8') === '\x1b[24~') return true;
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
    if (s === 'p' || s === 'P') return 'pause';
    if (s === 'x' || s === 'X') return 'minimize';
    if (s === 'r' || s === 'R') return 'reset';
    if (s === 'f' || s === 'F') return 'flag';
    if (s === 'h' || s === 'H') return 'help';
    if (s === 'm' || s === 'M') return 'next-game';
    if (s === ' ') return 'space';
    if (s === '\r' || s === '\n') return 'enter';
    if (s === '\t') return 'tab';
    if (s === '\x1b[Z') return 'shift-tab';

    if (data.length === 1 && data[0] === 3) return 'ctrl-c';
    if (data.length === 1 && data[0] === 0x1b) return 'escape';

    return null;
  }
}
