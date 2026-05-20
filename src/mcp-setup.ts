import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface McpConfigResult {
  path: string;
  name: string;
  status: 'configured' | 'skipped' | 'parse-error';
}

export interface McpSetupResult {
  mcpServerFound: boolean;
  mcpServerPath: string;
  configs: McpConfigResult[];
}

export function setupMcp(baseDir: string): McpSetupResult {
  const mcpServerPath = path.resolve(baseDir, 'bin', 'mcp-server.js');
  const result: McpSetupResult = {
    mcpServerFound: fs.existsSync(mcpServerPath),
    mcpServerPath,
    configs: [],
  };

  if (!result.mcpServerFound) return result;

  const targets = [
    { path: path.join(os.homedir(), '.claude.json'), name: 'Claude Code' },
    {
      path: process.platform === 'win32'
        ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
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
    if (fs.existsSync(target.path)) {
      try {
        data = JSON.parse(fs.readFileSync(target.path, 'utf-8'));
      } catch {
        result.configs.push({ ...target, status: 'parse-error' });
        continue;
      }
    }

    if (!data.mcpServers) data.mcpServers = {};
    data.mcpServers['splitgame'] = { command: 'node', args: [mcpServerPath] };

    try {
      const dir = path.dirname(target.path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmpPath = target.path + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      fs.renameSync(tmpPath, target.path);
      result.configs.push({ ...target, status: 'configured' });
    } catch {
      result.configs.push({ ...target, status: 'skipped' });
    }
  }

  return result;
}
