import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShellProfileInstaller } from '../src/shell-installer';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'splitgame-shell-test-'));
}

describe('ShellProfileInstaller', () => {
  let tempDir: string;
  let splitgameDir: string;
  let fakeHome: string;
  let origShell: string | undefined;

  beforeEach(() => {
    tempDir = makeTempDir();
    splitgameDir = path.join(tempDir, '.splitgame');
    fakeHome = path.join(tempDir, 'home');
    fs.mkdirSync(fakeHome, { recursive: true });
    origShell = process.env.SHELL;
  });

  afterEach(() => {
    if (origShell !== undefined) {
      process.env.SHELL = origShell;
    } else {
      delete process.env.SHELL;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createInstaller() {
    return new ShellProfileInstaller({ splitgameDir, homeDir: fakeHome });
  }

  function withSplitgameInPath(fn: () => void) {
    const origPath = process.env.PATH;
    const binDir = path.join(tempDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'splitgame'), '', { mode: 0o755 });
    process.env.PATH = `${binDir}${path.delimiter}${origPath}`;
    try {
      fn();
    } finally {
      process.env.PATH = origPath;
    }
  }

  describe('install', () => {
    it('patches .bashrc for bash shell', () => {
      process.env.SHELL = '/bin/bash';
      const bashrc = path.join(fakeHome, '.bashrc');
      fs.writeFileSync(bashrc, 'export PATH="/usr/local/bin:$PATH"\n');

      withSplitgameInPath(() => {
        const installer = createInstaller();
        const result = installer.install();

        expect(result.alreadyInstalled).toBe(false);
        expect(result.shell).toBe('bash');
        expect(result.profilePath).toBe(bashrc);

        const content = fs.readFileSync(bashrc, 'utf-8');
        expect(content).toContain('>>> splitgame auto-launch >>>');
        expect(content).toContain('exec splitgame "$SHELL"');
        expect(content).toContain('SPLITGAME_ACTIVE');
        expect(content).toContain('<<< splitgame auto-launch <<<');
        // Original content preserved
        expect(content).toContain('export PATH="/usr/local/bin:$PATH"');
      });
    });

    it('patches .zshrc for zsh shell', () => {
      process.env.SHELL = '/bin/zsh';
      const zshrc = path.join(fakeHome, '.zshrc');
      fs.writeFileSync(zshrc, 'autoload -U compinit\n');

      withSplitgameInPath(() => {
        const installer = createInstaller();
        const result = installer.install();

        expect(result.alreadyInstalled).toBe(false);
        expect(result.shell).toBe('zsh');
        expect(result.profilePath).toBe(zshrc);

        const content = fs.readFileSync(zshrc, 'utf-8');
        expect(content).toContain('exec splitgame "$SHELL"');
      });
    });

    it('patches config.fish for fish shell', () => {
      process.env.SHELL = '/usr/bin/fish';
      const fishDir = path.join(fakeHome, '.config', 'fish');
      fs.mkdirSync(fishDir, { recursive: true });
      const configFish = path.join(fishDir, 'config.fish');
      fs.writeFileSync(configFish, 'set -x EDITOR vim\n');

      withSplitgameInPath(() => {
        const installer = createInstaller();
        const result = installer.install();

        expect(result.alreadyInstalled).toBe(false);
        expect(result.shell).toBe('fish');

        const content = fs.readFileSync(configFish, 'utf-8');
        expect(content).toContain('exec splitgame $SHELL');
        expect(content).toContain('status is-interactive');
      });
    });

    it('creates profile file if it does not exist', () => {
      process.env.SHELL = '/bin/bash';
      const bashrc = path.join(fakeHome, '.bashrc');
      expect(fs.existsSync(bashrc)).toBe(false);

      withSplitgameInPath(() => {
        const installer = createInstaller();
        const result = installer.install();

        expect(result.alreadyInstalled).toBe(false);
        expect(fs.existsSync(bashrc)).toBe(true);
        const content = fs.readFileSync(bashrc, 'utf-8');
        expect(content).toContain('splitgame auto-launch');
      });
    });

    it('creates a backup of the original profile', () => {
      process.env.SHELL = '/bin/bash';
      const bashrc = path.join(fakeHome, '.bashrc');
      fs.writeFileSync(bashrc, 'original content\n');

      withSplitgameInPath(() => {
        const installer = createInstaller();
        const result = installer.install();

        expect(fs.existsSync(result.backupPath)).toBe(true);
        const backup = fs.readFileSync(result.backupPath, 'utf-8');
        expect(backup).toBe('original content\n');
      });
    });

    it('is idempotent — second install reports already installed', () => {
      process.env.SHELL = '/bin/bash';
      fs.writeFileSync(path.join(fakeHome, '.bashrc'), '');

      withSplitgameInPath(() => {
        const installer = createInstaller();
        installer.install();
        const result2 = installer.install();
        expect(result2.alreadyInstalled).toBe(true);
      });
    });

    it('detects existing marker even without manifest', () => {
      process.env.SHELL = '/bin/bash';
      const bashrc = path.join(fakeHome, '.bashrc');
      fs.writeFileSync(bashrc, '# >>> splitgame auto-launch >>>\nexec splitgame\n# <<< splitgame auto-launch <<<\n');

      withSplitgameInPath(() => {
        const installer = createInstaller();
        const result = installer.install();
        expect(result.alreadyInstalled).toBe(true);
      });
    });

    it('throws when splitgame is not in PATH', () => {
      process.env.SHELL = '/bin/bash';
      fs.writeFileSync(path.join(fakeHome, '.bashrc'), '');

      const origPath = process.env.PATH;
      process.env.PATH = '';
      try {
        const installer = createInstaller();
        expect(() => installer.install()).toThrow('not globally installed');
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('falls back to bash for unknown shells', () => {
      process.env.SHELL = '/usr/bin/unknown-shell';
      fs.writeFileSync(path.join(fakeHome, '.bashrc'), '');

      withSplitgameInPath(() => {
        const installer = createInstaller();
        const result = installer.install();
        expect(result.shell).toBe('bash');
      });
    });
  });

  describe('uninstall', () => {
    it('removes the splitgame snippet from the profile', () => {
      process.env.SHELL = '/bin/bash';
      const bashrc = path.join(fakeHome, '.bashrc');
      fs.writeFileSync(bashrc, 'before\n');

      withSplitgameInPath(() => {
        const installer = createInstaller();
        installer.install();

        const contentBefore = fs.readFileSync(bashrc, 'utf-8');
        expect(contentBefore).toContain('splitgame auto-launch');

        const result = installer.uninstall();
        expect(result.notInstalled).toBe(false);

        const contentAfter = fs.readFileSync(bashrc, 'utf-8');
        expect(contentAfter).not.toContain('splitgame auto-launch');
        expect(contentAfter).toContain('before');
      });
    });

    it('reports not installed when no manifest and no marker', () => {
      process.env.SHELL = '/bin/bash';
      fs.writeFileSync(path.join(fakeHome, '.bashrc'), 'clean\n');

      const installer = createInstaller();
      const result = installer.uninstall();
      expect(result.notInstalled).toBe(true);
    });

    it('deletes the manifest after uninstall', () => {
      process.env.SHELL = '/bin/bash';
      fs.writeFileSync(path.join(fakeHome, '.bashrc'), '');

      withSplitgameInPath(() => {
        const installer = createInstaller();
        installer.install();
        expect(installer.getManifest()).not.toBeNull();
        installer.uninstall();
        expect(installer.getManifest()).toBeNull();
      });
    });

    it('cleans up even without manifest if marker exists', () => {
      process.env.SHELL = '/bin/bash';
      const bashrc = path.join(fakeHome, '.bashrc');
      fs.writeFileSync(bashrc, 'before\n# >>> splitgame auto-launch >>>\nstuff\n# <<< splitgame auto-launch <<<\nafter\n');

      const installer = createInstaller();
      const result = installer.uninstall();
      expect(result.notInstalled).toBe(false);

      const content = fs.readFileSync(bashrc, 'utf-8');
      expect(content).not.toContain('splitgame');
      expect(content).toContain('before');
      expect(content).toContain('after');
    });
  });
});
