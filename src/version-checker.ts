import https from 'https';

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
}

function getLocalVersion(): string {
  try {
    return require('../package.json').version;
  } catch {
    return '0.0.0';
  }
}

function fetchLatestVersion(packageName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${packageName}/latest`,
      { timeout: 5000, headers: { 'Accept': 'application/json' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.version ?? null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const currentVersion = getLocalVersion();
  const latestVersion = await fetchLatestVersion('splitgame');
  return {
    currentVersion,
    latestVersion,
    updateAvailable: latestVersion !== null && compareVersions(latestVersion, currentVersion) > 0,
  };
}

export function getCurrentVersion(): string {
  return getLocalVersion();
}
