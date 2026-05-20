import { Terminal } from '@xterm/headless';
import { ScreenCell, ANSIColor } from './types';

export class TerminalEmulator {
  private terminal: Terminal;
  private _dirty: boolean = true;

  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback: 1000,
      allowProposedApi: true,
    });

    this.terminal.onWriteParsed(() => {
      this._dirty = true;
    });
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  consumeDirty(): boolean {
    const was = this._dirty;
    this._dirty = false;
    return was;
  }

  markDirty(): void {
    this._dirty = true;
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(Math.max(1, cols), Math.max(1, rows));
    this._dirty = true;
  }

  getCell(row: number, col: number): ScreenCell {
    const buffer = this.terminal.buffer.active;
    const line = buffer.getLine(row + buffer.viewportY);
    if (!line) return this.emptyCell();

    const cell = line.getCell(col);
    if (!cell) return this.emptyCell();

    return {
      char: cell.getChars() || ' ',
      width: cell.getWidth(),
      fg: this.extractColor(cell.isFgDefault(), cell.isFgPalette(), cell.isFgRGB(), cell.getFgColor()),
      bg: this.extractColor(cell.isBgDefault(), cell.isBgPalette(), cell.isBgRGB(), cell.getBgColor()),
      bold: cell.isBold() !== 0,
      italic: cell.isItalic() !== 0,
      underline: cell.isUnderline() !== 0,
      dim: cell.isDim() !== 0,
      inverse: cell.isInverse() !== 0,
      strikethrough: cell.isStrikethrough() !== 0,
    };
  }

  getCursor(): { x: number; y: number } {
    const buf = this.terminal.buffer.active;
    return { x: buf.cursorX, y: buf.cursorY };
  }

  getRow(row: number): ScreenCell[] {
    const cells: ScreenCell[] = [];
    for (let c = 0; c < this.terminal.cols; c++) {
      cells.push(this.getCell(row, c));
    }
    return cells;
  }

  get cols(): number { return this.terminal.cols; }
  get rows(): number { return this.terminal.rows; }

  dispose(): void { this.terminal.dispose(); }

  private extractColor(
    isDefault: boolean, isPalette: boolean, isRGB: boolean, value: number
  ): ANSIColor {
    if (isDefault) return { mode: 'default', value: 0 };
    if (isPalette) return { mode: 'palette', value };
    if (isRGB) return { mode: 'rgb', value };
    return { mode: 'default', value: 0 };
  }

  private emptyCell(): ScreenCell {
    return {
      char: ' ', width: 1,
      fg: { mode: 'default', value: 0 },
      bg: { mode: 'default', value: 0 },
      bold: false, italic: false, underline: false,
      dim: false, inverse: false, strikethrough: false,
    };
  }
}
