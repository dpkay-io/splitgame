import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ScoreEntry {
  score: number;
  date: string;
}

interface ScoreData {
  [gameName: string]: ScoreEntry[];
}

const MAX_ENTRIES_PER_GAME = 10;

export class HighScoreManager {
  private filePath: string;
  private data: ScoreData = {};

  constructor() {
    const dir = path.join(os.homedir(), '.splitgame');
    this.filePath = path.join(dir, 'scores.json');
    this.ensureDir(dir);
    this.load();
  }

  getHighScore(gameName: string): number {
    const entries = this.data[gameName];
    if (!entries || entries.length === 0) return 0;
    return entries[0].score;
  }

  getTopScores(gameName: string, limit = 5): ScoreEntry[] {
    return (this.data[gameName] || []).slice(0, limit);
  }

  submit(gameName: string, score: number): boolean {
    if (score <= 0) return false;
    if (!this.data[gameName]) this.data[gameName] = [];

    const entries = this.data[gameName];
    const isHighScore = entries.length === 0 || score > entries[0].score;

    entries.push({ score, date: new Date().toISOString() });
    entries.sort((a, b) => b.score - a.score);
    if (entries.length > MAX_ENTRIES_PER_GAME) {
      entries.length = MAX_ENTRIES_PER_GAME;
    }

    this.save();
    return isHighScore;
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch {
      // Silently fail — not critical
    }
  }

  private ensureDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Already exists or can't create
    }
  }
}
