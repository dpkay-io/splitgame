import { describe, it, expect } from 'vitest';
import * as ansi from '../src/utils/ansi';

describe('ansi utils', () => {
  it('moveTo generates correct escape sequence', () => {
    expect(ansi.moveTo(1, 1)).toBe('\x1b[1;1H');
    expect(ansi.moveTo(10, 20)).toBe('\x1b[10;20H');
  });

  it('hideCursor and showCursor', () => {
    expect(ansi.hideCursor()).toBe('\x1b[?25l');
    expect(ansi.showCursor()).toBe('\x1b[?25h');
  });

  it('alternateScreen and mainScreen', () => {
    expect(ansi.alternateScreen()).toBe('\x1b[?1049h');
    expect(ansi.mainScreen()).toBe('\x1b[?1049l');
  });

  it('fgColor handles default', () => {
    expect(ansi.fgColor({ mode: 'default', value: 0 })).toBe('\x1b[39m');
  });

  it('fgColor handles basic palette (0-7)', () => {
    expect(ansi.fgColor({ mode: 'palette', value: 1 })).toBe('\x1b[31m');
    expect(ansi.fgColor({ mode: 'palette', value: 7 })).toBe('\x1b[37m');
  });

  it('fgColor handles bright palette (8-15)', () => {
    expect(ansi.fgColor({ mode: 'palette', value: 8 })).toBe('\x1b[90m');
    expect(ansi.fgColor({ mode: 'palette', value: 15 })).toBe('\x1b[97m');
  });

  it('fgColor handles 256-color palette', () => {
    expect(ansi.fgColor({ mode: 'palette', value: 200 })).toBe('\x1b[38;5;200m');
  });

  it('fgColor handles RGB', () => {
    expect(ansi.fgColor({ mode: 'rgb', value: 0xFF8000 })).toBe('\x1b[38;2;255;128;0m');
  });

  it('bgColor handles default', () => {
    expect(ansi.bgColor({ mode: 'default', value: 0 })).toBe('\x1b[49m');
  });

  it('bgColor handles basic palette', () => {
    expect(ansi.bgColor({ mode: 'palette', value: 1 })).toBe('\x1b[41m');
  });

  it('bgColor handles RGB', () => {
    expect(ansi.bgColor({ mode: 'rgb', value: 0x00FF00 })).toBe('\x1b[48;2;0;255;0m');
  });

  it('attribute helpers return correct sequences', () => {
    expect(ansi.bold()).toBe('\x1b[1m');
    expect(ansi.dim()).toBe('\x1b[2m');
    expect(ansi.italic()).toBe('\x1b[3m');
    expect(ansi.underline()).toBe('\x1b[4m');
    expect(ansi.inverse()).toBe('\x1b[7m');
    expect(ansi.strikethrough()).toBe('\x1b[9m');
  });
});
