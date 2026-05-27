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

  it('targets ~/.claude.json for Claude Code', () => {
    const result = setupMcp(fakeBaseDir);
    const ccConfig = result.configs.find(c => c.name === 'Claude Code');
    expect(ccConfig).toBeDefined();
    expect(ccConfig!.path).toBe(path.join(fakeHome, '.claude.json'));
  });

  it('creates ~/.claude.json when it does not exist', () => {
    const result = setupMcp(fakeBaseDir);
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('configured');

    const written = JSON.parse(fs.readFileSync(ccConfig.path, 'utf-8'));
    expect(written.mcpServers.splitgame).toEqual({
      command: 'node',
      args: [mcpServerPath],
    });
  });

  it('adds splitgame to existing config without clobbering other keys', () => {
    const configPath = path.join(fakeHome, '.claude.json');
    fs.writeFileSync(configPath, JSON.stringify({
      numStartups: 10,
      mcpServers: { other: { command: 'other-cmd', args: [] } },
    }, null, 2));

    const result = setupMcp(fakeBaseDir);
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('configured');

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.numStartups).toBe(10);
    expect(written.mcpServers.other).toEqual({ command: 'other-cmd', args: [] });
    expect(written.mcpServers.splitgame).toEqual({ command: 'node', args: [mcpServerPath] });
  });

  it('returns exists when splitgame already configured', () => {
    const configPath = path.join(fakeHome, '.claude.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { splitgame: { command: 'node', args: ['/old/path'] } },
    }, null, 2));

    const result = setupMcp(fakeBaseDir);
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('exists');

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers.splitgame.args[0]).toBe('/old/path');
  });

  it('force overwrites existing entry with updated path', () => {
    const configPath = path.join(fakeHome, '.claude.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { splitgame: { command: 'node', args: ['/old/path'] } },
    }, null, 2));

    const result = setupMcp(fakeBaseDir, { force: true });
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('configured');

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers.splitgame.args[0]).toBe(mcpServerPath);
  });

  it('force does not produce duplicate splitgame entries', () => {
    const configPath = path.join(fakeHome, '.claude.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { splitgame: { command: 'node', args: ['/old/path'] } },
    }, null, 2));

    setupMcp(fakeBaseDir, { force: true });

    const raw = fs.readFileSync(configPath, 'utf-8');
    const occurrences = raw.split('"splitgame"').length - 1;
    expect(occurrences).toBe(1);
  });

  it('returns parse-error for corrupt JSON without force', () => {
    const configPath = path.join(fakeHome, '.claude.json');
    fs.writeFileSync(configPath, '{corrupt!!!');

    const result = setupMcp(fakeBaseDir);
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('parse-error');
  });

  it('force recovers from corrupt JSON with backup', () => {
    const configPath = path.join(fakeHome, '.claude.json');
    fs.writeFileSync(configPath, '{corrupt!!!');

    const result = setupMcp(fakeBaseDir, { force: true });
    const ccConfig = result.configs.find(c => c.name === 'Claude Code')!;
    expect(ccConfig.status).toBe('configured');

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
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
    const configPath = path.join(fakeHome, '.claude.json');
    const raw = fs.readFileSync(configPath, 'utf-8');

    expect(() => JSON.parse(raw)).not.toThrow();

    const data = JSON.parse(raw);
    expect(data.mcpServers.splitgame.command).toBe('node');
    expect(data.mcpServers.splitgame.args).toHaveLength(1);
    expect(data.mcpServers.splitgame.args[0]).toMatch(/mcp-server\.js$/);
  });
});
