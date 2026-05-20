import { ScreenCell, GameRenderState, PanelGeometry, GameCell, ANSIColor } from './types';
import { TerminalEmulator } from './terminal-emulator';
import * as ansi from './utils/ansi';

export class Renderer {
  private geometry: PanelGeometry;
  private prevChildHash: string[] = [];
  private prevGameHash: string[] = [];
  private forceFullRedraw: boolean = true;
  private gameWidthPercent: number = 50;

  constructor(private emulator: TerminalEmulator, gameWidthPercent: number = 50) {
    this.gameWidthPercent = gameWidthPercent;
    this.geometry = this.calculateGeometry();
  }

  setGameWidthPercent(pct: number): void {
    this.gameWidthPercent = pct;
  }

  calculateGeometry(): PanelGeometry {
    const totalCols = process.stdout.columns || 80;
    const totalRows = process.stdout.rows || 24;
    const rightWidth = Math.max(20, Math.floor(totalCols * this.gameWidthPercent / 100));
    const leftWidth = Math.max(20, totalCols - rightWidth - 1);
    return {
      leftWidth,
      rightWidth,
      height: totalRows,
      borderCol: leftWidth,
    };
  }

  updateGeometry(): PanelGeometry {
    this.geometry = this.calculateGeometry();
    this.forceFullRedraw = true;
    return this.geometry;
  }

  get currentGeometry(): PanelGeometry {
    return this.geometry;
  }

  renderSplit(gameState: GameRenderState, statusBar?: string): void {
    const { leftWidth, rightWidth, height, borderCol } = this.geometry;
    let output = ansi.hideCursor();

    for (let row = 0; row < height; row++) {
      const childRow = this.emulator.getRow(row);
      const childRowStr = this.renderChildRow(childRow, leftWidth, row);
      const gameRow = gameState.grid[row];
      const gameRowStr = this.renderGameRow(gameRow, rightWidth, borderCol, row);

      // Border
      output += ansi.moveTo(row + 1, borderCol + 1);
      output += ansi.resetAttributes();
      output += `\x1b[38;5;240m│`;

      // Only update rows that changed
      const childHash = childRowStr;
      const gameHash = gameRowStr;

      if (this.forceFullRedraw || this.prevChildHash[row] !== childHash) {
        output += childRowStr;
      }
      if (this.forceFullRedraw || this.prevGameHash[row] !== gameHash) {
        output += gameRowStr;
      }

      this.prevChildHash[row] = childHash;
      this.prevGameHash[row] = gameHash;
    }

    // Status bar
    const barText = statusBar ?? this.defaultStatusBar(gameState, rightWidth);
    const truncated = barText.slice(0, rightWidth);
    output += ansi.moveTo(height, borderCol + 2);
    output += ansi.resetAttributes();
    output += `\x1b[48;5;236m\x1b[38;5;252m`;
    output += truncated.padEnd(rightWidth, ' ');

    // Cursor
    const cursor = this.emulator.getCursor();
    output += ansi.moveTo(cursor.y + 1, Math.min(cursor.x + 1, leftWidth));
    output += ansi.resetAttributes();
    output += ansi.showCursor();

    process.stdout.write(output);
    this.forceFullRedraw = false;
  }

  private defaultStatusBar(gameState: GameRenderState, width: number): string {
    const statusMsg = gameState.statusMessage || '';
    return ` Score: ${gameState.score} | ${gameState.status.toUpperCase()} ${statusMsg ? '| ' + statusMsg + ' ' : ''}`;
  }

  renderFullscreen(): void {
    const totalCols = process.stdout.columns || 80;
    const totalRows = process.stdout.rows || 24;
    let output = ansi.hideCursor();

    for (let row = 0; row < totalRows; row++) {
      output += ansi.moveTo(row + 1, 1);
      const childRow = this.emulator.getRow(row);
      let prevFg: ANSIColor = { mode: 'default', value: 0 };
      let prevBg: ANSIColor = { mode: 'default', value: 0 };
      let prevAttrs = '';
      output += ansi.resetAttributes();

      for (let col = 0; col < totalCols; col++) {
        const cell = childRow[col] || this.emptyCell();
        if (cell.width === 0) continue;

        const attrs = this.buildAttrs(cell);
        if (attrs !== prevAttrs) {
          output += ansi.resetAttributes() + attrs;
          prevAttrs = attrs;
          prevFg = cell.fg;
          prevBg = cell.bg;
        }
        output += cell.char;
      }
    }

    const cursor = this.emulator.getCursor();
    output += ansi.moveTo(cursor.y + 1, cursor.x + 1);
    output += ansi.resetAttributes();
    output += ansi.showCursor();

    process.stdout.write(output);
  }

  invalidate(): void {
    this.forceFullRedraw = true;
    this.prevChildHash = [];
    this.prevGameHash = [];
  }

  private renderChildRow(cells: ScreenCell[], width: number, row: number): string {
    let out = ansi.moveTo(row + 1, 1);
    out += ansi.resetAttributes();
    for (let col = 0; col < width; col++) {
      const cell = cells[col] || this.emptyCell();
      if (cell.width === 0) continue;
      out += ansi.resetAttributes();
      out += this.buildAttrs(cell);
      out += cell.char;
    }
    return out;
  }

  private renderGameRow(cells: GameCell[] | undefined, width: number, borderCol: number, row: number): string {
    let out = ansi.moveTo(row + 1, borderCol + 2);
    out += ansi.resetAttributes();
    for (let col = 0; col < width; col++) {
      const cell = cells?.[col] || { char: ' ', fg: { mode: 'default' as const, value: 0 }, bg: { mode: 'default' as const, value: 0 } };
      out += ansi.resetAttributes();
      out += ansi.fgColor(cell.fg);
      out += ansi.bgColor(cell.bg);
      out += cell.char;
    }
    return out;
  }

  private buildAttrs(cell: ScreenCell): string {
    let s = '';
    if (cell.bold) s += ansi.bold();
    if (cell.dim) s += ansi.dim();
    if (cell.italic) s += ansi.italic();
    if (cell.underline) s += ansi.underline();
    if (cell.inverse) s += ansi.inverse();
    if (cell.strikethrough) s += ansi.strikethrough();
    s += ansi.fgColor(cell.fg);
    s += ansi.bgColor(cell.bg);
    return s;
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
