import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { parseJsonc } from './jsonc';

export interface InstallManifest {
  version: 1;
  installedAt: string;
  settingsPath: string;
  backupPath: string;
  profiles: ProfilePatch[];
}

export interface ProfilePatch {
  guid: string;
  name: string;
  originalCommandline: string | null;
  installedCommandline: string;
}

interface WTProfile {
  guid: string;
  name: string;
  hidden?: boolean;
  commandline?: string;
  source?: string;
}

interface WTSettings {
  profiles: {
    defaults: Record<string, unknown>;
    list: WTProfile[];
  };
  [key: string]: unknown;
}

export interface InstallResult {
  settingsPath: string;
  backupPath: string;
  patched: ProfilePatch[];
  skipped: Array<{ name: string; reason: string }>;
  alreadyInstalled: boolean;
}

export interface UninstallResult {
  restored: Array<{ name: string; guid: string }>;
  notInstalled: boolean;
}

const WELL_KNOWN_PROFILES: Record<string, string> = {
  '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}': 'powershell.exe',
  '{0caa0dad-35be-5f56-a8ff-afceeeaa6101}': 'cmd.exe',
  '{574e775e-4f2a-5b96-ac1e-a2962a402336}': 'pwsh.exe',
};

const SKIP_SOURCES = [
  'Windows.Terminal.Azure',
  'Windows.Terminal.Wsl',
  'VSDebugConsole',
];

const SKIP_SOURCE_PREFIXES = [
  'CanonicalGroupLimited.',
];

export class TerminalInstaller {
  private splitgameDir: string;
  private manifestPath: string;
  private settingsSearchPaths: string[];

  constructor(options?: { splitgameDir?: string; settingsSearchPaths?: string[] }) {
    this.splitgameDir = options?.splitgameDir ?? path.join(os.homedir(), '.splitgame');
    this.manifestPath = path.join(this.splitgameDir, 'install-manifest.json');

    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    this.settingsSearchPaths = options?.settingsSearchPaths ?? [
      path.join(localAppData, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
      path.join(localAppData, 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
      path.join(localAppData, 'Microsoft', 'Windows Terminal', 'settings.json'),
    ];
  }

  findSettingsFile(): string | null {
    for (const p of this.settingsSearchPaths) {
      try {
        fs.accessSync(p, fs.constants.R_OK);
        return p;
      } catch {
        continue;
      }
    }
    return null;
  }

  install(): InstallResult {
    this.ensureSplitgameInPath();

    const settingsPath = this.findSettingsFile();
    if (!settingsPath) {
      throw new Error(
        'Could not find Windows Terminal settings.json. Checked:\n' +
        this.settingsSearchPaths.map(p => `  ${p}`).join('\n') +
        '\n\nIs Windows Terminal installed?'
      );
    }

    const existingManifest = this.getManifest();
    if (existingManifest) {
      return {
        settingsPath: existingManifest.settingsPath,
        backupPath: existingManifest.backupPath,
        patched: existingManifest.profiles,
        skipped: [],
        alreadyInstalled: true,
      };
    }

    const rawContent = fs.readFileSync(settingsPath, 'utf-8');
    const settings: WTSettings = parseJsonc(rawContent);

    const backupDir = path.join(this.splitgameDir, 'backups');
    this.ensureDir(backupDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `settings.${timestamp}.json`);
    fs.writeFileSync(backupPath, rawContent, 'utf-8');

    const patched: ProfilePatch[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const profile of settings.profiles.list) {
      const skipReason = this.getSkipReason(profile);
      if (skipReason) {
        skipped.push({ name: profile.name, reason: skipReason });
        continue;
      }

      const originalCmd = this.resolveProfileCommand(profile);
      if (!originalCmd) {
        skipped.push({ name: profile.name, reason: 'unknown shell' });
        continue;
      }

      const wrappedCmd = this.buildWrappedCommand(originalCmd);
      const patch: ProfilePatch = {
        guid: profile.guid,
        name: profile.name,
        originalCommandline: profile.commandline ?? null,
        installedCommandline: wrappedCmd,
      };

      patched.push(patch);
    }

    if (patched.length === 0) {
      throw new Error('No eligible profiles found to patch. All profiles were skipped.');
    }

    let patchedContent = rawContent;
    for (const patch of patched) {
      if (patch.originalCommandline !== null) {
        patchedContent = this.replaceCommandlineInProfile(patchedContent, patch.guid, patch.installedCommandline);
      } else {
        patchedContent = this.insertCommandlineInProfile(patchedContent, patch.guid, patch.installedCommandline);
      }
    }
    fs.writeFileSync(settingsPath, patchedContent, 'utf-8');

    const manifest: InstallManifest = {
      version: 1,
      installedAt: new Date().toISOString(),
      settingsPath,
      backupPath,
      profiles: patched,
    };
    this.ensureDir(this.splitgameDir);
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    return { settingsPath, backupPath, patched, skipped, alreadyInstalled: false };
  }

  uninstall(): UninstallResult {
    const manifest = this.getManifest();

    if (!manifest) {
      return { restored: [], notInstalled: true };
    }

    const settingsPath = manifest.settingsPath;
    let rawContent: string;
    try {
      rawContent = fs.readFileSync(settingsPath, 'utf-8');
    } catch {
      throw new Error(`Could not read settings file: ${settingsPath}`);
    }

    const restored: Array<{ name: string; guid: string }> = [];

    let patchedContent = rawContent;
    for (const patch of manifest.profiles) {
      const bounds = this.findProfileBounds(patchedContent, patch.guid);
      if (bounds.start === -1) continue;

      if (patch.originalCommandline === null) {
        patchedContent = this.removeCommandlineFromProfile(patchedContent, patch.guid);
      } else {
        patchedContent = this.replaceCommandlineInProfile(patchedContent, patch.guid, patch.originalCommandline);
      }
      restored.push({ name: patch.name, guid: patch.guid });
    }

    fs.writeFileSync(settingsPath, patchedContent, 'utf-8');

    try {
      fs.unlinkSync(this.manifestPath);
    } catch {
      // manifest already gone
    }

    return { restored, notInstalled: false };
  }

  getManifest(): InstallManifest | null {
    try {
      const raw = fs.readFileSync(this.manifestPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private resolveProfileCommand(profile: WTProfile): string | null {
    if (profile.commandline) return profile.commandline;
    const wellKnown = WELL_KNOWN_PROFILES[profile.guid];
    if (wellKnown) return wellKnown;
    if (profile.source) return this.resolveSourceCommand(profile);
    return null;
  }

  private resolveSourceCommand(profile: WTProfile): string | null {
    const source = profile.source!;
    if (source.startsWith('Windows.Terminal.VisualStudio')) {
      return this.resolveVsCommand(profile);
    }
    if (source.startsWith('ESP-IDF')) {
      return this.resolveEspIdfCommand(profile);
    }
    return null;
  }

  private resolveVsCommand(profile: WTProfile): string | null {
    const vsInstalls = this.findVsInstallations();
    if (vsInstalls.length === 0) return null;

    const yearMatch = profile.name.match(/\b(20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : null;

    const install = year
      ? vsInstalls.find(v => v.installationPath.includes(year)) ?? vsInstalls[0]
      : vsInstalls[0];

    const toolsDir = path.join(install.installationPath, 'Common7', 'Tools');

    const isPowerShell = /powershell/i.test(profile.name);
    if (isPowerShell) {
      const dllPath = path.join(toolsDir, 'Microsoft.VisualStudio.DevShell.dll');
      if (!fs.existsSync(dllPath)) return null;
      return `powershell.exe -NoExit -Command "& {Import-Module '${dllPath}'; Enter-VsDevShell -VsInstallPath '${install.installationPath}' -SkipAutomaticLocation}"`;
    }

    const batPath = path.join(toolsDir, 'VsDevCmd.bat');
    if (!fs.existsSync(batPath)) return null;
    return `cmd.exe /k "${batPath}"`;
  }

  private findVsInstallations(): Array<{ installationPath: string }> {
    const vswherePaths = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    ];

    for (const vswhere of vswherePaths) {
      try {
        const output = execFileSync(vswhere, ['-all', '-prerelease', '-format', 'json', '-property', 'installationPath'], {
          encoding: 'utf-8',
          timeout: 5000,
        });
        return JSON.parse(output);
      } catch {
        continue;
      }
    }
    return [];
  }

  private resolveEspIdfCommand(profile: WTProfile): string | null {
    const espressifDir = 'C:\\Espressif';
    const configPath = path.join(espressifDir, 'esp_idf.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const selectedId = config.idfSelectedId;
      const idfInfo = config.idfInstalled?.[selectedId];
      if (!idfInfo?.path) return null;

      const exportBat = path.join(idfInfo.path, 'export.bat');
      if (!fs.existsSync(exportBat)) return null;
      return `cmd.exe /k "${exportBat}"`;
    } catch {
      return null;
    }
  }

  private getSkipReason(profile: WTProfile): string | null {
    if (profile.commandline && profile.commandline.includes('splitgame')) {
      return 'already wrapped';
    }

    if (profile.source) {
      if (SKIP_SOURCES.includes(profile.source)) {
        return this.friendlySourceReason(profile.source);
      }
      for (const prefix of SKIP_SOURCE_PREFIXES) {
        if (profile.source.startsWith(prefix)) {
          return this.friendlySourceReason(profile.source);
        }
      }
    }

    return null;
  }

  private friendlySourceReason(source: string): string {
    if (source === 'Windows.Terminal.Azure') return 'cloud profile';
    if (source === 'Windows.Terminal.Wsl') return 'WSL profile';
    if (source === 'VSDebugConsole') return 'debug console';
    if (source.startsWith('CanonicalGroupLimited.')) return 'WSL profile';
    return 'unsupported source';
  }

  private buildWrappedCommand(originalCmd: string): string {
    if (this.isPowerShellExe(originalCmd)) {
      return `${originalCmd} -NoProfile -Command "if (Get-Command splitgame -ErrorAction SilentlyContinue) { splitgame ${originalCmd}; if ($LASTEXITCODE -ne 0) { ${originalCmd} } } else { ${originalCmd} }"`;
    }
    const hasSpaces = originalCmd.includes(' ');
    if (hasSpaces) {
      return `cmd.exe /c splitgame -- ${originalCmd} || ${originalCmd}`;
    }
    return `cmd.exe /c splitgame ${originalCmd} || ${originalCmd}`;
  }

  private isPowerShellExe(cmd: string): boolean {
    const lower = cmd.toLowerCase().trim();
    return lower === 'powershell.exe' || lower === 'pwsh.exe'
      || lower === 'powershell' || lower === 'pwsh';
  }

  private findProfileBounds(rawText: string, guid: string): { start: number; end: number } {
    const guidStr = `"${guid}"`;
    const guidIdx = rawText.indexOf(guidStr);
    if (guidIdx === -1) return { start: -1, end: -1 };

    let start = guidIdx;
    while (start > 0 && rawText[start] !== '{') start--;

    let depth = 1;
    let pos = start + 1;
    while (pos < rawText.length && depth > 0) {
      const ch = rawText[pos];
      if (ch === '"') {
        pos++;
        while (pos < rawText.length) {
          if (rawText[pos] === '\\') { pos += 2; continue; }
          if (rawText[pos] === '"') break;
          pos++;
        }
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) return { start, end: pos };
      }
      pos++;
    }

    return { start: -1, end: -1 };
  }

  private replaceCommandlineInProfile(rawText: string, guid: string, newValue: string): string {
    const bounds = this.findProfileBounds(rawText, guid);
    if (bounds.start === -1) return rawText;

    const profileSlice = rawText.substring(bounds.start, bounds.end + 1);
    const regex = /("commandline"\s*:\s*)"(?:[^"\\]|\\.)*"/;
    const match = regex.exec(profileSlice);
    if (!match) return rawText;

    const keyEnd = bounds.start + match.index + match[1].length;
    const valueEnd = bounds.start + match.index + match[0].length;
    return rawText.substring(0, keyEnd) + JSON.stringify(newValue) + rawText.substring(valueEnd);
  }

  private insertCommandlineInProfile(rawText: string, guid: string, value: string): string {
    const bounds = this.findProfileBounds(rawText, guid);
    if (bounds.start === -1) return rawText;

    const profileSlice = rawText.substring(bounds.start, bounds.end + 1);
    const guidPattern = /"guid"/;
    const guidMatch = guidPattern.exec(profileSlice);
    let indent = '            ';
    if (guidMatch) {
      const guidAbsPos = bounds.start + guidMatch.index;
      const lineStart = rawText.lastIndexOf('\n', guidAbsPos) + 1;
      const leadingWs = rawText.substring(lineStart, guidAbsPos).match(/^(\s*)/);
      if (leadingWs) indent = leadingWs[1];
    }

    let lastContentPos = bounds.end - 1;
    while (lastContentPos > bounds.start && /\s/.test(rawText[lastContentPos])) lastContentPos--;

    const needsComma = rawText[lastContentPos] !== ',';
    const comma = needsComma ? ',' : '';
    const insertion = `${comma}\n${indent}"commandline": ${JSON.stringify(value)}`;

    return rawText.substring(0, lastContentPos + 1) + insertion + rawText.substring(lastContentPos + 1);
  }

  private removeCommandlineFromProfile(rawText: string, guid: string): string {
    const bounds = this.findProfileBounds(rawText, guid);
    if (bounds.start === -1) return rawText;

    const profileSlice = rawText.substring(bounds.start, bounds.end + 1);
    const regex = /"commandline"\s*:\s*"(?:[^"\\]|\\.)*"/;
    const match = regex.exec(profileSlice);
    if (!match) return rawText;

    const matchAbsStart = bounds.start + match.index;
    const matchAbsEnd = matchAbsStart + match[0].length;

    let lineStart = matchAbsStart;
    while (lineStart > bounds.start && rawText[lineStart - 1] !== '\n') lineStart--;

    let lineEnd = matchAbsEnd;
    while (lineEnd <= bounds.end && rawText[lineEnd] !== '\n' && /[\s,]/.test(rawText[lineEnd])) lineEnd++;
    if (lineEnd <= bounds.end && rawText[lineEnd] === '\n') lineEnd++;

    let result = rawText.substring(0, lineStart) + rawText.substring(lineEnd);

    const beforeRemoval = result.substring(0, lineStart);
    const trailingCommaMatch = beforeRemoval.match(/,(\s*)$/);
    if (trailingCommaMatch) {
      const afterRemoval = result.substring(lineStart);
      const nextNonWs = afterRemoval.match(/^\s*(.)/);
      if (nextNonWs && nextNonWs[1] === '}') {
        result = beforeRemoval.replace(/,(\s*)$/, '$1') + afterRemoval;
      }
    }

    return result;
  }

  private ensureSplitgameInPath(): void {
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    const splitgameNames = process.platform === 'win32'
      ? ['splitgame.cmd', 'splitgame.ps1', 'splitgame', 'splitgame.exe']
      : ['splitgame'];

    for (const dir of pathDirs) {
      for (const name of splitgameNames) {
        try {
          fs.accessSync(path.join(dir, name), fs.constants.X_OK);
          return;
        } catch {
          continue;
        }
      }
    }

    throw new Error(
      'splitgame is not globally installed (not found in PATH).\n' +
      'Windows Terminal needs splitgame in PATH to launch it.\n\n' +
      'Run one of:\n' +
      '  npm install -g splitgame\n' +
      '  npm link           (from the splitgame project directory)'
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
