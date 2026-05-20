import { IGame, GameRenderState, GameCell, ANSIColor } from '../types';
import { getGameList, createGame, GameInfo } from '../game-registry';
import { HighScoreManager } from '../high-scores';
import { ConfigManager, ConfigKey, CONFIG_KEYS } from '../config';

const DEFAULT: ANSIColor = { mode: 'default', value: 0 };
const WHITE: ANSIColor = { mode: 'palette', value: 15 };
const YELLOW: ANSIColor = { mode: 'palette', value: 11 };
const GRAY: ANSIColor = { mode: 'palette', value: 7 };
const DARK_GRAY: ANSIColor = { mode: 'palette', value: 8 };
const HIGHLIGHT_BG: ANSIColor = { mode: 'palette', value: 236 };
const CYAN: ANSIColor = { mode: 'palette', value: 14 };
const GREEN: ANSIColor = { mode: 'palette', value: 10 };
const MAGENTA: ANSIColor = { mode: 'palette', value: 13 };
const TAB_ACTIVE_BG: ANSIColor = { mode: 'palette', value: 238 };
const TAB_INACTIVE_FG: ANSIColor = { mode: 'palette', value: 245 };

const TAB_NAMES = ['Games', 'High Scores', 'Config'];

const CONFIG_LABELS: Record<ConfigKey, string> = {
  toggleKey: 'Toggle Key',
  modifierKey: 'Modifier Key',
  gameWidthPercent: 'Game Width',
};

export class GameMenu implements IGame {
  readonly name = 'Game Menu';

  private width = 0;
  private height = 0;
  private games: GameInfo[] = [];
  private cursor = 0;
  private _selected: GameInfo | null = null;
  private currentTab = 0;
  private configCursor = 0;
  private claudeConnected = false;

  constructor(
    private highScores?: HighScoreManager,
    private configManager?: ConfigManager,
    private onConfigChanged?: (key: ConfigKey) => void,
  ) {}

  get selectedGame(): GameInfo | null {
    return this._selected;
  }

  clearSelection(): void {
    this._selected = null;
  }

  setClaudeConnected(connected: boolean): void {
    this.claudeConnected = connected;
  }

  init(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.games = getGameList();
    this.cursor = 0;
    this._selected = null;
  }

  tick(_deltaMs: number): void {}

  handleInput(key: string): void {
    if (this._selected) return;

    if (key === 'tab') {
      this.currentTab = (this.currentTab + 1) % TAB_NAMES.length;
      return;
    }
    if (key === 'shift-tab') {
      this.currentTab = (this.currentTab - 1 + TAB_NAMES.length) % TAB_NAMES.length;
      return;
    }

    switch (this.currentTab) {
      case 0: this.handleGamesInput(key); break;
      case 1: break; // High scores is read-only
      case 2: this.handleConfigInput(key); break;
    }
  }

  private handleGamesInput(key: string): void {
    switch (key) {
      case 'up':
        this.cursor = (this.cursor - 1 + this.games.length) % this.games.length;
        break;
      case 'down':
        this.cursor = (this.cursor + 1) % this.games.length;
        break;
      case 'space':
      case 'enter':
        this._selected = this.games[this.cursor];
        break;
    }
  }

  private handleConfigInput(key: string): void {
    switch (key) {
      case 'up':
        this.configCursor = (this.configCursor - 1 + CONFIG_KEYS.length) % CONFIG_KEYS.length;
        break;
      case 'down':
        this.configCursor = (this.configCursor + 1) % CONFIG_KEYS.length;
        break;
      case 'left':
        this.cycleConfigValue(CONFIG_KEYS[this.configCursor], -1);
        break;
      case 'right':
        this.cycleConfigValue(CONFIG_KEYS[this.configCursor], 1);
        break;
      case 'reset':
        if (this.configManager) {
          this.configManager.resetKey(CONFIG_KEYS[this.configCursor]);
          this.onConfigChanged?.(CONFIG_KEYS[this.configCursor]);
        }
        break;
    }
  }

  private cycleConfigValue(key: ConfigKey, direction: number): void {
    if (!this.configManager) return;

    if (key === 'toggleKey') {
      const keys = ConfigManager.validToggleKeys();
      const current = keys.indexOf(this.configManager.get('toggleKey'));
      const next = (current + direction + keys.length) % keys.length;
      this.configManager.set('toggleKey', keys[next]);
      this.onConfigChanged?.('toggleKey');
    } else if (key === 'modifierKey') {
      const keys = ConfigManager.validModifierKeys();
      const current = keys.indexOf(this.configManager.get('modifierKey'));
      const next = (current + direction + keys.length) % keys.length;
      this.configManager.set('modifierKey', keys[next]);
      this.onConfigChanged?.('modifierKey');
    } else if (key === 'gameWidthPercent') {
      const current = this.configManager.get('gameWidthPercent');
      const next = Math.max(
        ConfigManager.minGameWidth(),
        Math.min(ConfigManager.maxGameWidth(), current + direction * 5),
      );
      if (next !== current) {
        this.configManager.set('gameWidthPercent', next);
        this.onConfigChanged?.('gameWidthPercent');
      }
    }
  }

  getState(): GameRenderState {
    const grid = this.createEmptyGrid();
    this.renderTabBar(grid);

    switch (this.currentTab) {
      case 0: this.renderGamesTab(grid); break;
      case 1: this.renderScoresTab(grid); break;
      case 2: this.renderConfigTab(grid); break;
    }

    const messages = ['Choose a game', 'High Scores', 'Configuration'];
    return {
      grid,
      score: 0,
      status: 'playing',
      statusMessage: messages[this.currentTab],
    };
  }

  private renderTabBar(grid: GameCell[][]): void {
    let col = 2;
    const row = 0;
    for (let i = 0; i < TAB_NAMES.length; i++) {
      const active = i === this.currentTab;
      const label = active ? `[ ${TAB_NAMES[i]} ]` : `  ${TAB_NAMES[i]}  `;
      const fg = active ? WHITE : TAB_INACTIVE_FG;
      const bg = active ? TAB_ACTIVE_BG : DEFAULT;
      for (let c = 0; c < label.length && col + c < this.width; c++) {
        if (col + c >= 0) {
          grid[row][col + c] = { char: label[c], fg, bg };
        }
      }
      col += label.length + 1;
    }

    const sepRow = 1;
    if (sepRow < this.height) {
      for (let c = 1; c < this.width - 1; c++) {
        grid[sepRow][c] = { char: '─', fg: DARK_GRAY, bg: DEFAULT };
      }
    }

  }

  private renderGamesTab(grid: GameCell[][]): void {
    const title = 'SELECT A GAME';
    this.writeText(grid, 3, title, CYAN, DEFAULT);

    const subtitle = 'Use ↑↓ and SPACE to select';
    this.writeText(grid, 5, subtitle, DARK_GRAY, DEFAULT);

    const startRow = 7;
    for (let i = 0; i < this.games.length; i++) {
      const row = startRow + i * 2;
      if (row >= this.height - 1) break;

      const isSelected = i === this.cursor;
      const prefix = isSelected ? '► ' : '  ';
      const text = prefix + this.games[i].name;
      const fg = isSelected ? YELLOW : GRAY;
      const bg = isSelected ? HIGHLIGHT_BG : DEFAULT;

      const col = Math.max(0, Math.floor((this.width - text.length) / 2));
      this.writeTextAt(grid, row, col, text, fg, bg);

      if (this.claudeConnected) {
        const instance = createGame(this.games[i].id);
        if (instance.supportsExternalMoves) {
          const tag = ' vs Claude';
          this.writeTextAt(grid, row, col + text.length, tag, MAGENTA, bg);
        }
      }
    }
  }

  private renderScoresTab(grid: GameCell[][]): void {
    const title = 'HIGH SCORES';
    this.writeText(grid, 3, title, CYAN, DEFAULT);

    const headerGame = 'Game';
    const headerScore = 'Best';
    const headerDate = 'Date';
    const colGame = 3;
    const colScore = Math.max(colGame + 16, this.width - 26);
    const colDate = Math.max(colScore + 8, this.width - 14);

    const headerRow = 5;
    this.writeTextAt(grid, headerRow, colGame, headerGame, WHITE, DEFAULT);
    this.writeTextAt(grid, headerRow, colScore, headerScore, WHITE, DEFAULT);
    this.writeTextAt(grid, headerRow, colDate, headerDate, WHITE, DEFAULT);

    const sepRow = 6;
    for (let c = colGame; c < Math.min(colDate + 12, this.width); c++) {
      if (c >= 0 && c < this.width) {
        grid[sepRow][c] = { char: '─', fg: DARK_GRAY, bg: DEFAULT };
      }
    }

    const games = getGameList();
    for (let i = 0; i < games.length; i++) {
      const row = 7 + i;
      if (row >= this.height - 1) break;

      this.writeTextAt(grid, row, colGame, games[i].name, GRAY, DEFAULT);

      if (this.highScores) {
        const scores = this.highScores.getTopScores(games[i].id, 1);
        if (scores.length > 0) {
          this.writeTextAt(grid, row, colScore, String(scores[0].score), GREEN, DEFAULT);
          const date = scores[0].date.slice(0, 10);
          this.writeTextAt(grid, row, colDate, date, DARK_GRAY, DEFAULT);
        } else {
          this.writeTextAt(grid, row, colScore, '---', DARK_GRAY, DEFAULT);
        }
      } else {
        this.writeTextAt(grid, row, colScore, '---', DARK_GRAY, DEFAULT);
      }
    }
  }

  private renderConfigTab(grid: GameCell[][]): void {
    const title = 'CONFIGURATION';
    this.writeText(grid, 3, title, CYAN, DEFAULT);

    if (!this.configManager) {
      this.writeText(grid, 6, 'Config not available', DARK_GRAY, DEFAULT);
      return;
    }

    const startRow = 6;
    for (let i = 0; i < CONFIG_KEYS.length; i++) {
      const row = startRow + i * 2;
      if (row >= this.height - 2) break;

      const key = CONFIG_KEYS[i];
      const isSelected = i === this.configCursor;
      const label = CONFIG_LABELS[key];
      const value = this.formatConfigValue(key);
      const fg = isSelected ? YELLOW : GRAY;
      const bg = isSelected ? HIGHLIGHT_BG : DEFAULT;

      const prefix = isSelected ? '► ' : '  ';
      const text = `${prefix}${label.padEnd(16)} [ ${value.padEnd(10)} ]`;
      const arrows = isSelected ? '  ◄ ►' : '';

      this.writeTextAt(grid, row, 3, text, fg, bg);
      if (arrows) {
        this.writeTextAt(grid, row, 3 + text.length, arrows, CYAN, DEFAULT);
      }
    }

    const helpRow = startRow + CONFIG_KEYS.length * 2 + 1;
    if (helpRow < this.height - 1) {
      this.writeText(grid, helpRow, '↑↓ Navigate  ◄► Change  R Reset', DARK_GRAY, DEFAULT);
    }
  }

  private formatConfigValue(key: ConfigKey): string {
    if (!this.configManager) return '?';
    const val = this.configManager.get(key);
    if (key === 'gameWidthPercent') return `${val}%`;
    return String(val);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  isPaused(): boolean { return false; }
  pause(): void {}
  resume(): void {}
  isGameOver(): boolean { return false; }
  reset(): void {
    this.cursor = 0;
    this._selected = null;
    this.currentTab = 0;
    this.configCursor = 0;
  }

  private createEmptyGrid(): GameCell[][] {
    const empty: GameCell = { char: ' ', fg: DEFAULT, bg: DEFAULT };
    const grid: GameCell[][] = [];
    for (let r = 0; r < this.height; r++) {
      grid[r] = [];
      for (let c = 0; c < this.width; c++) {
        grid[r][c] = { ...empty };
      }
    }
    return grid;
  }

  private writeText(grid: GameCell[][], row: number, text: string, fg: ANSIColor, bg: ANSIColor): void {
    if (row < 0 || row >= this.height) return;
    const startCol = Math.max(0, Math.floor((this.width - text.length) / 2));
    for (let i = 0; i < text.length && startCol + i < this.width; i++) {
      grid[row][startCol + i] = { char: text[i], fg, bg };
    }
  }

  private writeTextAt(grid: GameCell[][], row: number, col: number, text: string, fg: ANSIColor, bg: ANSIColor): void {
    if (row < 0 || row >= this.height) return;
    for (let i = 0; i < text.length && col + i < this.width; i++) {
      if (col + i >= 0) {
        grid[row][col + i] = { char: text[i], fg, bg };
      }
    }
  }

}
