import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TerminalInstaller } from '../src/installer';
import { parseJsonc } from '../src/jsonc';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gamecli-test-'));
}

function writeSettings(dir: string, settings: object): string {
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), 'utf-8');
  return settingsPath;
}

const BASE_SETTINGS = {
  profiles: {
    defaults: {},
    list: [
      { guid: '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}', hidden: false, name: 'Windows PowerShell' },
      { guid: '{0caa0dad-35be-5f56-a8ff-afceeeaa6101}', hidden: false, name: 'Command Prompt' },
      { guid: '{b453ae62-4e3d-5e58-b989-0a998ec441b8}', hidden: false, name: 'Azure Cloud Shell', source: 'Windows.Terminal.Azure' },
      { guid: '{d6ccebf6-b511-5337-b194-8c2ee71081fb}', hidden: false, name: 'Developer Command Prompt for VS 2022', source: 'Windows.Terminal.VisualStudio', commandline: 'cmd.exe /k "C:\\VS\\DevCmd.bat"' },
      { guid: '{16208362-94fc-5b1f-a491-5b2624d5ab56}', hidden: true, name: 'Visual Studio Debug Console', source: 'VSDebugConsole' },
      { guid: '{2c4de342-38b7-51cf-b940-2309a097f518}', hidden: true, name: 'Ubuntu', source: 'Windows.Terminal.Wsl' },
    ],
  },
};

describe('parseJsonc', () => {
  it('parses standard JSON', () => {
    const result = parseJsonc('{"a": 1, "b": "hello"}');
    expect(result).toEqual({ a: 1, b: 'hello' });
  });

  it('strips single-line comments', () => {
    const result = parseJsonc('{\n// comment\n"a": 1\n}');
    expect(result).toEqual({ a: 1 });
  });

  it('strips block comments', () => {
    const result = parseJsonc('{\n/* block\ncomment */\n"a": 1\n}');
    expect(result).toEqual({ a: 1 });
  });

  it('strips trailing commas', () => {
    const result = parseJsonc('{"a": 1, "b": 2,}');
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('handles trailing comma in arrays', () => {
    const result = parseJsonc('[1, 2, 3,]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('preserves URLs in string values', () => {
    const result = parseJsonc('{"$help": "https://aka.ms/terminal-documentation", "a": 1}');
    expect(result).toEqual({ $help: 'https://aka.ms/terminal-documentation', a: 1 });
  });

  it('strips comments but preserves // in strings', () => {
    const result = parseJsonc('{\n"url": "https://example.com", // a comment\n"b": 2\n}');
    expect(result).toEqual({ url: 'https://example.com', b: 2 });
  });
});

describe('TerminalInstaller', () => {
  let tempDir: string;
  let gamecliDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    gamecliDir = path.join(tempDir, '.gamecli');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createInstaller(settingsPath: string) {
    return new TerminalInstaller({
      gamecliDir,
      settingsSearchPaths: [settingsPath],
    });
  }

  describe('findSettingsFile', () => {
    it('returns the settings file path when it exists', () => {
      const settingsPath = writeSettings(tempDir, BASE_SETTINGS);
      const installer = createInstaller(settingsPath);
      expect(installer.findSettingsFile()).toBe(settingsPath);
    });

    it('returns null when no settings file exists', () => {
      const installer = new TerminalInstaller({
        gamecliDir,
        settingsSearchPaths: [path.join(tempDir, 'nonexistent.json')],
      });
      expect(installer.findSettingsFile()).toBeNull();
    });
  });

  describe('install', () => {
    it('patches PowerShell and Command Prompt profiles', () => {
      const settingsPath = writeSettings(tempDir, BASE_SETTINGS);
      const installer = createInstaller(settingsPath);

      // Mock PATH to include gamecli
      const origPath = process.env.PATH;
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(binDir, 'gamecli.cmd'), '', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${origPath}`;

      try {
        const result = installer.install();

        expect(result.alreadyInstalled).toBe(false);
        expect(result.patched).toHaveLength(3);
        expect(result.patched[0].name).toBe('Windows PowerShell');
        expect(result.patched[0].installedCommandline).toBe('cmd.exe /c gamecli powershell.exe');
        expect(result.patched[0].originalCommandline).toBeNull();
        expect(result.patched[1].name).toBe('Command Prompt');
        expect(result.patched[1].installedCommandline).toBe('cmd.exe /c gamecli cmd.exe');
        expect(result.patched[2].name).toBe('Developer Command Prompt for VS 2022');
        expect(result.patched[2].installedCommandline).toBe('cmd.exe /c gamecli -- cmd.exe /k "C:\\VS\\DevCmd.bat"');

        const updated = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const ps = updated.profiles.list.find((p: any) => p.name === 'Windows PowerShell');
        expect(ps.commandline).toBe('cmd.exe /c gamecli powershell.exe');
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('skips Azure, WSL, and debug console profiles', () => {
      const settingsPath = writeSettings(tempDir, BASE_SETTINGS);
      const installer = createInstaller(settingsPath);

      const origPath = process.env.PATH;
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(binDir, 'gamecli.cmd'), '', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${origPath}`;

      try {
        const result = installer.install();
        const skippedNames = result.skipped.map(s => s.name);
        expect(skippedNames).toContain('Azure Cloud Shell');
        expect(skippedNames).toContain('Visual Studio Debug Console');
        expect(skippedNames).toContain('Ubuntu');
        expect(skippedNames).not.toContain('Developer Command Prompt for VS 2022');
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('is idempotent — second install reports already installed', () => {
      const settingsPath = writeSettings(tempDir, BASE_SETTINGS);
      const installer = createInstaller(settingsPath);

      const origPath = process.env.PATH;
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(binDir, 'gamecli.cmd'), '', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${origPath}`;

      try {
        installer.install();
        const result2 = installer.install();
        expect(result2.alreadyInstalled).toBe(true);
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('creates a backup of the original settings', () => {
      const settingsPath = writeSettings(tempDir, BASE_SETTINGS);
      const installer = createInstaller(settingsPath);

      const origPath = process.env.PATH;
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(binDir, 'gamecli.cmd'), '', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${origPath}`;

      try {
        const result = installer.install();
        expect(fs.existsSync(result.backupPath)).toBe(true);
        const backup = JSON.parse(fs.readFileSync(result.backupPath, 'utf-8'));
        const ps = backup.profiles.list.find((p: any) => p.name === 'Windows PowerShell');
        expect(ps.commandline).toBeUndefined();
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('wraps profiles with existing commandline using --', () => {
      const settings = {
        profiles: {
          defaults: {},
          list: [
            { guid: '{aaa}', hidden: false, name: 'Custom Shell', commandline: 'C:\\my shell\\shell.exe -flag' },
          ],
        },
      };
      const settingsPath = writeSettings(tempDir, settings);
      const installer = createInstaller(settingsPath);

      const origPath = process.env.PATH;
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(binDir, 'gamecli.cmd'), '', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${origPath}`;

      try {
        const result = installer.install();
        expect(result.patched[0].installedCommandline).toBe('cmd.exe /c gamecli -- C:\\my shell\\shell.exe -flag');
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('skips source-only profiles when source cannot be resolved', () => {
      const settings = {
        profiles: {
          defaults: {},
          list: [
            { guid: '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}', hidden: false, name: 'Windows PowerShell' },
            { guid: '{aaa}', hidden: false, name: 'Unknown Tool', source: 'SomeUnknown.Source' },
          ],
        },
      };
      const settingsPath = writeSettings(tempDir, settings);
      const installer = createInstaller(settingsPath);

      const origPath = process.env.PATH;
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(binDir, 'gamecli.cmd'), '', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${origPath}`;

      try {
        const result = installer.install();
        expect(result.patched).toHaveLength(1);
        expect(result.patched[0].name).toBe('Windows PowerShell');
        const unknownSkipped = result.skipped.find(s => s.name === 'Unknown Tool');
        expect(unknownSkipped).toBeDefined();
        expect(unknownSkipped!.reason).toBe('unknown shell');
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('throws when gamecli is not in PATH', () => {
      const settingsPath = writeSettings(tempDir, BASE_SETTINGS);
      const installer = createInstaller(settingsPath);

      const origPath = process.env.PATH;
      process.env.PATH = '';

      try {
        expect(() => installer.install()).toThrow('not globally installed');
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('does not double-wrap profiles already containing gamecli', () => {
      const settings = {
        profiles: {
          defaults: {},
          list: [
            { guid: '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}', hidden: false, name: 'Windows PowerShell', commandline: 'gamecli powershell.exe' },
          ],
        },
      };
      const settingsPath = writeSettings(tempDir, settings);
      const installer = createInstaller(settingsPath);

      const origPath = process.env.PATH;
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(binDir, 'gamecli.cmd'), '', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${origPath}`;

      try {
        expect(() => installer.install()).toThrow('No eligible profiles');
      } finally {
        process.env.PATH = origPath;
      }
    });
  });

  describe('uninstall', () => {
    it('restores profiles to original state', () => {
      const settingsPath = writeSettings(tempDir, BASE_SETTINGS);
      const installer = createInstaller(settingsPath);

      const origPath = process.env.PATH;
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(binDir, 'gamecli.cmd'), '', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${origPath}`;

      try {
        installer.install();
        const result = installer.uninstall();

        expect(result.notInstalled).toBe(false);
        expect(result.restored).toHaveLength(3);

        const restored = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const ps = restored.profiles.list.find((p: any) => p.name === 'Windows PowerShell');
        expect(ps.commandline).toBeUndefined();
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('reports not installed when no manifest exists', () => {
      const settingsPath = writeSettings(tempDir, BASE_SETTINGS);
      const installer = createInstaller(settingsPath);
      const result = installer.uninstall();
      expect(result.notInstalled).toBe(true);
    });

    it('deletes the manifest after uninstall', () => {
      const settingsPath = writeSettings(tempDir, BASE_SETTINGS);
      const installer = createInstaller(settingsPath);

      const origPath = process.env.PATH;
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(binDir, 'gamecli.cmd'), '', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${origPath}`;

      try {
        installer.install();
        expect(installer.getManifest()).not.toBeNull();
        installer.uninstall();
        expect(installer.getManifest()).toBeNull();
      } finally {
        process.env.PATH = origPath;
      }
    });
  });
});
