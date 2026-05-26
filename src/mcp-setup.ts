import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseJsonc } from './jsonc';

export interface McpConfigResult {
  path: string;
  name: string;
  status: 'configured' | 'skipped' | 'parse-error' | 'exists';
}

export interface McpSetupResult {
  mcpServerFound: boolean;
  mcpServerPath: string;
  configs: McpConfigResult[];
}

export interface McpSetupOptions {
  force?: boolean;
}

export function setupMcp(baseDir: string, options?: McpSetupOptions): McpSetupResult {
  const mcpServerPath = path.resolve(baseDir, 'bin', 'mcp-server.js');
  const result: McpSetupResult = {
    mcpServerFound: fs.existsSync(mcpServerPath),
    mcpServerPath,
    configs: [],
  };

  if (!result.mcpServerFound) return result;

  const targets = [
    { path: path.join(os.homedir(), '.claude', 'settings.json'), name: 'Claude Code' },
    {
      path: process.platform === 'win32'
        ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
        : process.platform === 'linux'
          ? path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json')
          : path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      name: 'Claude Desktop',
    },
  ];

  for (const target of targets) {
    if (target.name === 'Claude Desktop' && !fs.existsSync(path.dirname(target.path))) {
      result.configs.push({ ...target, status: 'skipped' });
      continue;
    }

    let data: any = {};
    const fileExists = fs.existsSync(target.path);

    if (fileExists) {
      try {
        data = parseJsonc(fs.readFileSync(target.path, 'utf-8'));
      } catch {
        if (options?.force) {
          const backupDir = path.join(os.homedir(), '.splitgame', 'backups');
          if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
          const backupName = path.basename(target.path) + '.backup.' + Date.now();
          fs.copyFileSync(target.path, path.join(backupDir, backupName));
          data = {};
        } else {
          result.configs.push({ ...target, status: 'parse-error' });
          continue;
        }
      }
    }

    if (!data.mcpServers) data.mcpServers = {};
    if (data.mcpServers['splitgame'] && !options?.force) {
      result.configs.push({ ...target, status: 'exists' });
      continue;
    }

    try {
      const dir = path.dirname(target.path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmpPath = target.path + '.tmp';
      data.mcpServers['splitgame'] = { command: 'node', args: [mcpServerPath] };
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      fs.renameSync(tmpPath, target.path);
      result.configs.push({ ...target, status: 'configured' });
    } catch {
      result.configs.push({ ...target, status: 'skipped' });
    }
  }

  return result;
}
