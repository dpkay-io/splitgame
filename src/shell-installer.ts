import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ShellInstallManifest {
  version: 1;
  installedAt: string;
  platform: 'linux' | 'darwin';
  shell: string;
  profilePath: string;
  backupPath: string;
}

export interface ShellInstallResult {
  shell: string;
  profilePath: string;
  backupPath: string;
  alreadyInstalled: boolean;
}

export interface ShellUninstallResult {
  profilePath: string;
  notInstalled: boolean;
}

const MARKER_START = '# >>> gamecli auto-launch >>>';
const MARKER_END = '# <<< gamecli auto-launch <<<';

const SHELL_PROFILES: Record<string, string[]> = {
  bash: ['.bashrc'],
  zsh: ['.zshrc'],
  fish: [path.join('.config', 'fish', 'config.fish')],
};

function buildSnippet(shell: string): string {
  if (shell === 'fish') {
    return [
      MARKER_START,
      'if not set -q GAMECLI_ACTIVE; and status is-interactive; and isatty stdout',
      '  set -gx GAMECLI_ACTIVE 1',
      '  exec gamecli $SHELL',
      'end',
      MARKER_END,
    ].join('\n');
  }
  return [
    MARKER_START,
    'if [ -z "$GAMECLI_ACTIVE" ] && [ -t 1 ]; then',
    '  export GAMECLI_ACTIVE=1',
    '  exec gamecli "$SHELL"',
    'fi',
    MARKER_END,
  ].join('\n');
}

export class ShellProfileInstaller {
  private gamecliDir: string;
  private manifestPath: string;
  private homeDir: string;

  constructor(options?: { gamecliDir?: string; homeDir?: string }) {
    this.homeDir = options?.homeDir ?? os.homedir();
    this.gamecliDir = options?.gamecliDir ?? path.join(this.homeDir, '.gamecli');
    this.manifestPath = path.join(this.gamecliDir, 'install-manifest.json');
  }

  install(): ShellInstallResult {
    this.ensureGamecliInPath();

    const existing = this.getManifest();
    if (existing) {
      return {
        shell: existing.shell,
        profilePath: existing.profilePath,
        backupPath: existing.backupPath,
        alreadyInstalled: true,
      };
    }

    const shell = this.detectShell();
    const profilePath = this.findProfilePath(shell);
    if (!profilePath) {
      throw new Error(
        `Could not find shell profile for ${shell}.\n` +
        `Checked: ${(SHELL_PROFILES[shell] || []).map(f => path.join(this.homeDir, f)).join(', ')}`
      );
    }

    const backupDir = path.join(this.gamecliDir, 'backups');
    this.ensureDir(backupDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `${path.basename(profilePath)}.${timestamp}.bak`);

    let originalContent = '';
    try {
      originalContent = fs.readFileSync(profilePath, 'utf-8');
    } catch {
      // File doesn't exist yet — will be created
    }

    if (originalContent.includes(MARKER_START)) {
      return {
        shell,
        profilePath,
        backupPath,
        alreadyInstalled: true,
      };
    }

    if (originalContent) {
      fs.writeFileSync(backupPath, originalContent, 'utf-8');
    }

    const snippet = buildSnippet(shell);
    const newContent = originalContent
      ? originalContent.replace(/\n*$/, '\n\n') + snippet + '\n'
      : snippet + '\n';
    fs.writeFileSync(profilePath, newContent, 'utf-8');

    const manifest: ShellInstallManifest = {
      version: 1,
      installedAt: new Date().toISOString(),
      platform: process.platform as 'linux' | 'darwin',
      shell,
      profilePath,
      backupPath,
    };
    this.ensureDir(this.gamecliDir);
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    return { shell, profilePath, backupPath, alreadyInstalled: false };
  }

  uninstall(): ShellUninstallResult {
    const manifest = this.getManifest();

    if (!manifest) {
      // No manifest — check if marker exists in common profiles
      const shell = this.detectShell();
      const profilePath = this.findProfilePath(shell);
      if (profilePath) {
        try {
          const content = fs.readFileSync(profilePath, 'utf-8');
          if (content.includes(MARKER_START)) {
            this.removeSnippet(profilePath, content);
            return { profilePath, notInstalled: false };
          }
        } catch {
          // file doesn't exist
        }
      }
      return { profilePath: '', notInstalled: true };
    }

    try {
      const content = fs.readFileSync(manifest.profilePath, 'utf-8');
      if (content.includes(MARKER_START)) {
        this.removeSnippet(manifest.profilePath, content);
      }
    } catch {
      // Profile file gone — nothing to restore
    }

    try {
      fs.unlinkSync(this.manifestPath);
    } catch {
      // manifest already gone
    }

    return { profilePath: manifest.profilePath, notInstalled: false };
  }

  getManifest(): ShellInstallManifest | null {
    try {
      const raw = fs.readFileSync(this.manifestPath, 'utf-8');
      const manifest = JSON.parse(raw);
      if (manifest.shell) return manifest;
      return null;
    } catch {
      return null;
    }
  }

  private removeSnippet(profilePath: string, content: string): void {
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);
    if (startIdx === -1 || endIdx === -1) return;

    const before = content.slice(0, startIdx).replace(/\n+$/, '\n');
    const after = content.slice(endIdx + MARKER_END.length).replace(/^\n+/, '');
    const cleaned = before + (after ? '\n' + after : '');
    fs.writeFileSync(profilePath, cleaned, 'utf-8');
  }

  private detectShell(): string {
    const shellPath = process.env.SHELL || '/bin/bash';
    const shellName = path.basename(shellPath);
    if (SHELL_PROFILES[shellName]) return shellName;
    return 'bash';
  }

  private findProfilePath(shell: string): string | null {
    const candidates = SHELL_PROFILES[shell];
    if (!candidates) return null;

    for (const rel of candidates) {
      const full = path.join(this.homeDir, rel);
      try {
        fs.accessSync(full, fs.constants.R_OK);
        return full;
      } catch {
        continue;
      }
    }

    // Profile doesn't exist yet — return the first candidate so we can create it
    return path.join(this.homeDir, candidates[0]);
  }

  private ensureGamecliInPath(): void {
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
      try {
        fs.accessSync(path.join(dir, 'gamecli'), fs.constants.X_OK);
        return;
      } catch {
        continue;
      }
    }

    throw new Error(
      'gamecli is not globally installed (not found in PATH).\n\n' +
      'Run one of:\n' +
      '  npm install -g gamecli\n' +
      '  npm link           (from the gamecli project directory)'
    );
  }

  private ensureDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // already exists
    }
  }
}
