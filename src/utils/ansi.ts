import { ANSIColor } from '../types';

const ESC = '\x1b[';

export function moveTo(row: number, col: number): string {
  return `${ESC}${row};${col}H`;
}

export function hideCursor(): string { return `${ESC}?25l`; }
export function showCursor(): string { return `${ESC}?25h`; }
export function resetAttributes(): string { return `${ESC}0m`; }
export function bold(): string { return `${ESC}1m`; }
export function dim(): string { return `${ESC}2m`; }
export function italic(): string { return `${ESC}3m`; }
export function underline(): string { return `${ESC}4m`; }
export function inverse(): string { return `${ESC}7m`; }
export function strikethrough(): string { return `${ESC}9m`; }
export function clearScreen(): string { return `${ESC}2J${ESC}H`; }
export function alternateScreen(): string { return `${ESC}?1049h`; }
export function mainScreen(): string { return `${ESC}?1049l`; }

export function fgColor(color: ANSIColor): string {
  switch (color.mode) {
    case 'default': return `${ESC}39m`;
    case 'palette':
      if (color.value < 8) return `${ESC}${30 + color.value}m`;
      if (color.value < 16) return `${ESC}${90 + color.value - 8}m`;
      return `${ESC}38;5;${color.value}m`;
    case 'rgb': {
      const r = (color.value >> 16) & 0xff;
      const g = (color.value >> 8) & 0xff;
      const b = color.value & 0xff;
      return `${ESC}38;2;${r};${g};${b}m`;
    }
  }
}

export function bgColor(color: ANSIColor): string {
  switch (color.mode) {
    case 'default': return `${ESC}49m`;
    case 'palette':
      if (color.value < 8) return `${ESC}${40 + color.value}m`;
      if (color.value < 16) return `${ESC}${100 + color.value - 8}m`;
      return `${ESC}48;5;${color.value}m`;
    case 'rgb': {
      const r = (color.value >> 16) & 0xff;
      const g = (color.value >> 8) & 0xff;
      const b = color.value & 0xff;
      return `${ESC}48;2;${r};${g};${b}m`;
    }
  }
}
