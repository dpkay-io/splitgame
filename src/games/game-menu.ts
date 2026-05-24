import { IGame, GameRenderState, GameCell, ANSIColor } from '../types';
import { getGameList, GameInfo } from '../game-registry';
import { HighScoreManager } from '../high-scores';
import { ConfigManager, ConfigKey, CONFIG_KEYS } from '../config';
import { UpdateInfo } from '../version-checker';

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

const RED: ANSIColor = { mode: 'palette', value: 9 };

const TAB_NAMES = ['Games', 'High Scores', 'Config'];

const CONFIG_LABELS: Record<ConfigKey, string> = {
  toggleKey: 'Toggle Key',
  modifierKey: 'Modifier Key',
  gameWidthPercent: 'Game Width',
  scrollbackLines: 'Scrollback Lines',
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
  private externalMovesCache: Map<string, boolean> = new Map();
  private gamesScrollOffset = 0;
  private scoresScrollOffset = 0;
  private updateInfo: UpdateInfo | null = null;

  constructor(
    private highScores?: HighScoreManager,
    private configManager?: ConfigManager,
    private onConfigChanged?: (key: ConfigKey) => void,
  ) {}

  setUpdateInfo(info: UpdateInfo): void {
    this.updateInfo = info;
  }

  get selectedGame(): GameInfo | null {
    return this._selected;
  }

  clearSelection(): void {
    this._selected = null;
  }

  setClaudeConnected(connected: boolean): void {
    this.claudeConnected = connected;
    this.refreshExternalMovesCache();
  }

  init(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.games = getGameList();
    this.cursor = 0;
    this._selected = null;
    this.refreshExternalMovesCache();
  }

  private refreshExternalMovesCache(): void {
    this.externalMovesCache.clear();
    for (const game of this.games) {
      this.externalMovesCache.set(game.id, !!game.supportsExternalMoves);
    }
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
      case 1: this.handleScoresInput(key); break;
      case 2: this.handleConfigInput(key); break;
    }
  }

  private handleGamesInput(key: string): void {
    switch (key) {
      case 'up':
        this.cursor = (this.cursor - 1 + this.games.length) % this.games.length;
        this.ensureGameCursorVisible();
        break;
      case 'down':
        this.cursor = (this.cursor + 1) % this.games.length;
        this.ensureGameCursorVisible();
        break;
      case 'space':
      case 'enter':
        this._selected = this.games[this.cursor];
        break;
    }
  }

  private ensureGameCursorVisible(): void {
    // Each game item takes 2 rows; list starts at row 7, reserve 1 row at bottom
    const maxVisibleItems = Math.max(1, Math.floor((this.height - 1 - 7) / 2));
    if (this.cursor < this.gamesScrollOffset) {
      this.gamesScrollOffset = this.cursor;
    } else if (this.cursor >= this.gamesScrollOffset + maxVisibleItems) {
      this.gamesScrollOffset = this.cursor - maxVisibleItems + 1;
    }
  }

  private getScoresMaxScrollOffset(): number {
    const games = getGameList();
    const maxScoresPerGame = 5;
    let totalLines = 0;
    for (const game of games) {
      const scores = this.highScores ? this.highScores.getTopScores(game.id, maxScoresPerGame) : [];
      totalLines += scores.length === 0 ? 1 : scores.length;
    }
    const contentStartRow = 7;
    const availableRows = Math.max(0, this.height - contentStartRow - 2);
    return Math.max(0, totalLines - availableRows);
  }

  private handleScoresInput(key: string): void {
    switch (key) {
      case 'up':
        this.scoresScrollOffset = Math.max(0, this.scoresScrollOffset - 1);
        break;
      case 'down':
        this.scoresScrollOffset = Math.min(this.scoresScrollOffset + 1, this.getScoresMaxScrollOffset());
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
    } else if (key === 'scrollbackLines') {
      const current = this.configManager.get('scrollbackLines');
      const step = current < 1000 ? 100 : current < 10000 ? 1000 : 10000;
      const next = Math.max(
        ConfigManager.minScrollback(),
        Math.min(ConfigManager.maxScrollback(), current + direction * step),
      );
      if (next !== current) {
        this.configManager.set('scrollbackLines', next);
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
    const maxVisibleItems = Math.max(1, Math.floor((this.height - 1 - startRow) / 2));

    // Clamp scroll offset
    this.gamesScrollOffset = Math.max(0, Math.min(this.gamesScrollOffset, this.games.length - maxVisibleItems));

    const hasMore = this.games.length > maxVisibleItems;
    const hasItemsAbove = this.gamesScrollOffset > 0;
    const hasItemsBelow = this.gamesScrollOffset + maxVisibleItems < this.games.length;

    // Show scroll-up indicator
    if (hasMore && hasItemsAbove) {
      const indicator = `▲ ${this.gamesScrollOffset} more`;
      this.writeText(grid, startRow - 1, indicator, DARK_GRAY, DEFAULT);
    }

    const endIndex = Math.min(this.gamesScrollOffset + maxVisibleItems, this.games.length);
    for (let i = this.gamesScrollOffset; i < endIndex; i++) {
      const row = startRow + (i - this.gamesScrollOffset) * 2;
      if (row >= this.height - 1) break;

      const isSelected = i === this.cursor;
      const prefix = isSelected ? '► ' : '  ';
      const text = prefix + this.games[i].name;
      const fg = isSelected ? YELLOW : GRAY;
      const bg = isSelected ? HIGHLIGHT_BG : DEFAULT;

      const col = Math.max(0, Math.floor((this.width - text.length) / 2));
      this.writeTextAt(grid, row, col, text, fg, bg);

      if (this.claudeConnected && this.externalMovesCache.get(this.games[i].id)) {
        const tag = ' vs Claude';
        this.writeTextAt(grid, row, col + text.length, tag, MAGENTA, bg);
      }
    }

    // Show scroll-down indicator
    if (hasMore && hasItemsBelow) {
      const belowCount = this.games.length - (this.gamesScrollOffset + maxVisibleItems);
      const indicator = `▼ ${belowCount} more`;
      const indicatorRow = startRow + maxVisibleItems * 2 - 1;
      if (indicatorRow < this.height) {
        this.writeText(grid, indicatorRow, indicator, DARK_GRAY, DEFAULT);
      }
    }

    this.renderVersionInfo(grid);
  }

  private renderVersionInfo(grid: GameCell[][]): void {
    if (!this.updateInfo) return;

    const { currentVersion, updateAvailable, latestVersion } = this.updateInfo;

    if (updateAvailable && latestVersion) {
      const updateRow = this.height - 3;
      const cmdRow = this.height - 2;
      const versionRow = this.height - 1;
      if (updateRow > 8) {
        this.writeText(grid, updateRow, `Update available: v${latestVersion}`, GREEN, DEFAULT);
        this.writeText(grid, cmdRow, 'npm i -g splitgame', YELLOW, DEFAULT);
        this.writeText(grid, versionRow, `v${currentVersion}`, DARK_GRAY, DEFAULT);
      }
    } else {
      const versionRow = this.height - 1;
      this.writeText(grid, versionRow, `v${currentVersion}`, DARK_GRAY, DEFAULT);
    }
  }

  private renderScoresTab(grid: GameCell[][]): void {
    const title = 'HIGH SCORES';
    this.writeText(grid, 3, title, CYAN, DEFAULT);

    const headerGame = 'Game';
    const headerScore = 'Score';
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

    // Build all score lines (game name + up to 5 scores each)
    const games = getGameList();
    const maxScoresPerGame = 5;
    interface ScoreLine { gameName: string; rank: number; scoreText: string; dateText: string; isHeader: boolean }
    const allLines: ScoreLine[] = [];

    for (const game of games) {
      const scores = this.highScores ? this.highScores.getTopScores(game.id, maxScoresPerGame) : [];
      if (scores.length === 0) {
        allLines.push({ gameName: game.name, rank: 0, scoreText: '---', dateText: '', isHeader: true });
      } else {
        for (let s = 0; s < scores.length; s++) {
          allLines.push({
            gameName: s === 0 ? game.name : '',
            rank: s + 1,
            scoreText: String(scores[s].score),
            dateText: scores[s].date.slice(0, 10),
            isHeader: s === 0,
          });
        }
      }
    }

    // Reserve 1 row for bottom hint, 1 for possible scroll indicator
    const contentStartRow = 7;
    const availableRows = Math.max(0, this.height - contentStartRow - 2);

    // Clamp scroll offset
    const maxScrollOffset = Math.max(0, allLines.length - availableRows);
    this.scoresScrollOffset = Math.max(0, Math.min(this.scoresScrollOffset, maxScrollOffset));

    const hasItemsAbove = this.scoresScrollOffset > 0;
    const hasItemsBelow = this.scoresScrollOffset + availableRows < allLines.length;

    for (let i = 0; i < availableRows && this.scoresScrollOffset + i < allLines.length; i++) {
      const line = allLines[this.scoresScrollOffset + i];
      const row = contentStartRow + i;
      if (row >= this.height - 1) break;

      if (line.gameName) {
        this.writeTextAt(grid, row, colGame, line.gameName, GRAY, DEFAULT);
      }
      if (line.scoreText === '---') {
        this.writeTextAt(grid, row, colScore, '---', DARK_GRAY, DEFAULT);
      } else {
        const rankPrefix = line.isHeader ? '' : `  ${line.rank}. `;
        const scoreFg = line.isHeader ? GREEN : GRAY;
        if (!line.isHeader) {
          this.writeTextAt(grid, row, colGame + 1, rankPrefix, DARK_GRAY, DEFAULT);
        }
        this.writeTextAt(grid, row, colScore, line.scoreText, scoreFg, DEFAULT);
        this.writeTextAt(grid, row, colDate, line.dateText, DARK_GRAY, DEFAULT);
      }
    }

    // Show scroll indicators
    if (hasItemsAbove) {
      const indicator = '▲ scroll up';
      this.writeText(grid, contentStartRow - 1, indicator, DARK_GRAY, DEFAULT);
    }
    if (hasItemsBelow) {
      const indicatorRow = contentStartRow + availableRows;
      if (indicatorRow < this.height) {
        const indicator = '▼ scroll down';
        this.writeText(grid, indicatorRow, indicator, DARK_GRAY, DEFAULT);
      }
    }

    // Navigation hint at bottom
    const hintRow = this.height - 1;
    if (hintRow > contentStartRow) {
      this.writeText(grid, hintRow, '↑↓ Scroll  Tab: sections  Esc: back', DARK_GRAY, DEFAULT);
    }
  }

  private renderConfigTab(grid: GameCell[][]): void {
    const title = 'CONFIGURATION';
    this.writeText(grid, 3, title, CYAN, DEFAULT);

    if (!this.configManager) {
      this.writeText(grid, 6, 'Config not available', DARK_GRAY, DEFAULT);
      return;
    }

    const defaults = ConfigManager.defaults();
    const startRow = 6;
    for (let i = 0; i < CONFIG_KEYS.length; i++) {
      const row = startRow + i * 2;
      if (row >= this.height - 2) break;

      const key = CONFIG_KEYS[i];
      const isSelected = i === this.configCursor;
      const label = CONFIG_LABELS[key];
      const value = this.formatConfigValue(key);
      const isDefault = this.configManager.get(key) === defaults[key];
      const fg = isSelected ? YELLOW : GRAY;
      const bg = isSelected ? HIGHLIGHT_BG : DEFAULT;

      const prefix = isSelected ? '► ' : '  ';
      const text = `${prefix}${label.padEnd(16)} [ ${value.padEnd(10)} ]`;
      const arrows = isSelected ? '  ◄ ►' : '';
      const marker = isDefault ? '  (default)' : '  ● custom';

      this.writeTextAt(grid, row, 3, text, fg, bg);
      if (arrows) {
        this.writeTextAt(grid, row, 3 + text.length, arrows, CYAN, DEFAULT);
        this.writeTextAt(grid, row, 3 + text.length + arrows.length, marker, isDefault ? DARK_GRAY : MAGENTA, DEFAULT);
      } else {
        this.writeTextAt(grid, row, 3 + text.length, marker, isDefault ? DARK_GRAY : MAGENTA, DEFAULT);
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
    this.gamesScrollOffset = 0;
    this.scoresScrollOffset = 0;
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
