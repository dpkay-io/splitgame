import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type ToggleKey = 'f12' | 'ctrl+]';
export type ModifierKey = 'ctrl' | 'alt';

export interface SplitGameConfig {
  toggleKey: ToggleKey;
  modifierKey: ModifierKey;
  gameWidthPercent: number;
}

const VALID_TOGGLE_KEYS: ToggleKey[] = ['f12', 'ctrl+]'];
const VALID_MODIFIER_KEYS: ModifierKey[] = ['ctrl', 'alt'];
const MIN_GAME_WIDTH = 20;
const MAX_GAME_WIDTH = 80;

const DEFAULTS: SplitGameConfig = {
  toggleKey: 'f12',
  modifierKey: 'ctrl',
  gameWidthPercent: 50,
};

export const CONFIG_KEYS = ['toggleKey', 'modifierKey', 'gameWidthPercent'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export class ConfigManager {
  private filePath: string;
  private config: SplitGameConfig;

  constructor() {
    const dir = path.join(os.homedir(), '.splitgame');
    this.filePath = path.join(dir, 'config.json');
    this.ensureDir(dir);
    this.config = this.load();
  }

  get<K extends keyof SplitGameConfig>(key: K): SplitGameConfig[K] {
    return this.config[key];
  }

  set<K extends keyof SplitGameConfig>(key: K, value: SplitGameConfig[K]): void {
    this.validate(key, value);
    this.config[key] = value;
    this.save();
  }

  getAll(): SplitGameConfig {
    return { ...this.config };
  }

  reset(): void {
    this.config = { ...DEFAULTS };
    this.save();
  }

  resetKey<K extends keyof SplitGameConfig>(key: K): void {
    this.config[key] = DEFAULTS[key];
    this.save();
  }

  static defaults(): SplitGameConfig {
    return { ...DEFAULTS };
  }

  static validToggleKeys(): ToggleKey[] {
    return [...VALID_TOGGLE_KEYS];
  }

  static validModifierKeys(): ModifierKey[] {
    return [...VALID_MODIFIER_KEYS];
  }

  static minGameWidth(): number {
    return MIN_GAME_WIDTH;
  }

  static maxGameWidth(): number {
    return MAX_GAME_WIDTH;
  }

  validate<K extends keyof SplitGameConfig>(key: K, value: SplitGameConfig[K]): void {
    switch (key) {
      case 'toggleKey':
        if (!VALID_TOGGLE_KEYS.includes(value as ToggleKey)) {
          throw new Error(`Invalid toggleKey "${value}". Valid: ${VALID_TOGGLE_KEYS.join(', ')}`);
        }
        break;
      case 'modifierKey':
        if (!VALID_MODIFIER_KEYS.includes(value as ModifierKey)) {
          throw new Error(`Invalid modifierKey "${value}". Valid: ${VALID_MODIFIER_KEYS.join(', ')}`);
        }
        break;
      case 'gameWidthPercent': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < MIN_GAME_WIDTH || n > MAX_GAME_WIDTH) {
          throw new Error(`Invalid gameWidthPercent "${value}". Must be integer ${MIN_GAME_WIDTH}–${MAX_GAME_WIDTH}`);
        }
        break;
      }
      default:
        throw new Error(`Unknown config key: ${String(key)}`);
    }
  }

  private load(): SplitGameConfig {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        toggleKey: VALID_TOGGLE_KEYS.includes(parsed.toggleKey) ? parsed.toggleKey : DEFAULTS.toggleKey,
        modifierKey: VALID_MODIFIER_KEYS.includes(parsed.modifierKey) ? parsed.modifierKey : DEFAULTS.modifierKey,
        gameWidthPercent: this.clampWidth(parsed.gameWidthPercent),
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private clampWidth(val: unknown): number {
    const n = Number(val);
    if (!Number.isInteger(n) || isNaN(n)) return DEFAULTS.gameWidthPercent;
    return Math.max(MIN_GAME_WIDTH, Math.min(MAX_GAME_WIDTH, n));
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e: any) {
      throw new Error(`Could not save to ${this.filePath}: ${e.message}`);
    }
  }

  private ensureDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Already exists
    }
  }
}
