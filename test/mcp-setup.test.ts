import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let fakeHome: string;
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => fakeHome };
});

import { setupMcp } from '../src/mcp-setup';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'splitgame-mcp-test-'));
}

describe('setupMcp', () => {
  let tempDir: string;
  let fakeBaseDir: string;
  let mcpServerPath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    fakeHome = path.join(tempDir, 'home');
    fakeBaseDir = path.join(tempDir, 'pkg');
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(path.join(fakeBaseDir, 'bin'), { recursive: true });
    mcpServerPath = path.join(fakeBaseDir, 'bin', 'mcp-server.js');
    fs.writeFileSync(mcpServerPath, '// mcp server stub');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns mcpServerFound=false when bin/mcp-server.js is missing', () => {
    fs.unlinkSync(mcpServerPath);
    const result = setupMcp(fakeBaseDir);
    expect(result.mcpServerFound).toBe(false);
    expect(result.configs).toHaveLength(0);
  });

  it('targets ~/.claude/settings.json for Claude Code', () => {
    const result = setupMcp(fakeBaseDir);
    const ccConfig = result.configs.find(c => c.name === 'Claude Code');
    expect(ccConfig).toBeDefined();
    expect(ccConfig!.path).toBe(path.join(fakeHome, '.claude', 'settings.json'));
  });

  it('creates ~/.claude/settings.json when it does not exist', () => {
    const result = setupMcp(fakeBaseDir);
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('configured');

    const written = JSON.parse(fs.readFileSync(ccConfig.path, 'utf-8'));
    expect(written.mcpServers.splitgame).toEqual({
      command: 'node',
      args: [mcpServerPath],
    });
  });

  it('adds splitgame to existing settings without clobbering other keys', () => {
    const settingsDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      model: 'claude-opus-4-6',
      mcpServers: { other: { command: 'other-cmd', args: [] } },
    }, null, 2));

    const result = setupMcp(fakeBaseDir);
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('configured');

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.model).toBe('claude-opus-4-6');
    expect(written.mcpServers.other).toEqual({ command: 'other-cmd', args: [] });
    expect(written.mcpServers.splitgame).toEqual({ command: 'node', args: [mcpServerPath] });
  });

  it('returns exists when splitgame already configured', () => {
    const settingsDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
      mcpServers: { splitgame: { command: 'node', args: ['/old/path'] } },
    }, null, 2));

    const result = setupMcp(fakeBaseDir);
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('exists');

    const written = JSON.parse(fs.readFileSync(path.join(settingsDir, 'settings.json'), 'utf-8'));
    expect(written.mcpServers.splitgame.args[0]).toBe('/old/path');
  });

  it('force overwrites existing entry with updated path', () => {
    const settingsDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
      mcpServers: { splitgame: { command: 'node', args: ['/old/path'] } },
    }, null, 2));

    const result = setupMcp(fakeBaseDir, { force: true });
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('configured');

    const written = JSON.parse(fs.readFileSync(path.join(settingsDir, 'settings.json'), 'utf-8'));
    expect(written.mcpServers.splitgame.args[0]).toBe(mcpServerPath);
  });

  it('force does not produce duplicate splitgame entries', () => {
    const settingsDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      mcpServers: { splitgame: { command: 'node', args: ['/old/path'] } },
    }, null, 2));

    setupMcp(fakeBaseDir, { force: true });

    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const occurrences = raw.split('"splitgame"').length - 1;
    expect(occurrences).toBe(1);
  });

  it('returns parse-error for corrupt JSON without force', () => {
    const settingsDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'settings.json'), '{corrupt!!!');

    const result = setupMcp(fakeBaseDir);
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('parse-error');
  });

  it('force recovers from corrupt JSON with backup', () => {
    const settingsDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, 'settings.json');
    fs.writeFileSync(settingsPath, '{corrupt!!!');

    const result = setupMcp(fakeBaseDir, { force: true });
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('configured');

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.mcpServers.splitgame).toEqual({ command: 'node', args: [mcpServerPath] });

    const backupDir = path.join(fakeHome, '.splitgame', 'backups');
    const backups = fs.readdirSync(backupDir);
    expect(backups.length).toBe(1);
    expect(fs.readFileSync(path.join(backupDir, backups[0]), 'utf-8')).toBe('{corrupt!!!');
  });

  it('skips Claude Desktop when its parent directory does not exist', () => {
    const result = setupMcp(fakeBaseDir);
    const desktopConfig = result.configs.find(c => c.name === 'Claude Desktop')!;
    expect(desktopConfig.status).toBe('skipped');
  });

  it('written config is valid JSON with correct structure', () => {
    setupMcp(fakeBaseDir);
    const settingsPath = path.join(fakeHome, '.claude', 'settings.json');
    const raw = fs.readFileSync(settingsPath, 'utf-8');

    expect(() => JSON.parse(raw)).not.toThrow();

    const data = JSON.parse(raw);
    expect(data.mcpServers.splitgame.command).toBe('node');
    expect(data.mcpServers.splitgame.args).toHaveLength(1);
    expect(data.mcpServers.splitgame.args[0]).toMatch(/mcp-server\.js$/);
  });
});
