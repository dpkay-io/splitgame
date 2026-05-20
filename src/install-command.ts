import { TerminalInstaller } from './installer';
import { ShellProfileInstaller } from './shell-installer';

export function handleInstallCommand(_args: string[]): void {
  if (process.platform === 'win32') {
    handleWindowsInstall();
  } else {
    handleShellInstall();
  }
}

export function handleUninstallCommand(_args: string[]): void {
  if (process.platform === 'win32') {
    handleWindowsUninstall();
  } else {
    handleShellUninstall();
  }
}

function handleWindowsInstall(): void {
  const installer = new TerminalInstaller();

  try {
    const result = installer.install();

    if (result.alreadyInstalled) {
      process.stdout.write('\ngamecli is already installed in Windows Terminal.\n');
      process.stdout.write(`Settings: ${result.settingsPath}\n`);
      process.stdout.write(`Backup:   ${result.backupPath}\n\n`);
      process.stdout.write('Patched profiles:\n');
      for (const p of result.patched) {
        process.stdout.write(`  ${p.name}  (${p.installedCommandline})\n`);
      }
      process.stdout.write('\nTo undo: gamecli uninstall\n\n');
      return;
    }

    process.stdout.write('\ngamecli: patching Windows Terminal profiles\n\n');
    process.stdout.write(`Backed up settings to ${result.backupPath}\n\n`);

    process.stdout.write('Profiles:\n');
    for (const p of result.patched) {
      const original = p.originalCommandline ?? '(default)';
      process.stdout.write(`  [x] ${p.name.padEnd(30)} ${original} -> ${p.installedCommandline}\n`);
    }
    for (const s of result.skipped) {
      process.stdout.write(`  [ ] ${s.name.padEnd(30)} (skipped: ${s.reason})\n`);
    }

    process.stdout.write('\nDone! Open a new terminal tab to start with gamecli.\n');
    process.stdout.write('To undo: gamecli uninstall\n\n');
  } catch (e: any) {
    process.stderr.write(`gamecli install: ${e.message}\n`);
    process.exit(1);
  }
}

function handleWindowsUninstall(): void {
  const installer = new TerminalInstaller();

  try {
    const result = installer.uninstall();

    if (result.notInstalled) {
      process.stdout.write('\ngamecli is not installed in Windows Terminal. Nothing to do.\n\n');
      return;
    }

    process.stdout.write('\ngamecli: restored Windows Terminal profiles\n\n');
    for (const r of result.restored) {
      process.stdout.write(`  [x] ${r.name}\n`);
    }
    process.stdout.write('\nDone! New terminal tabs will use the original shell.\n\n');
  } catch (e: any) {
    process.stderr.write(`gamecli uninstall: ${e.message}\n`);
    process.exit(1);
  }
}

function handleShellInstall(): void {
  const installer = new ShellProfileInstaller();

  try {
    const result = installer.install();

    if (result.alreadyInstalled) {
      process.stdout.write('\ngamecli is already installed.\n');
      process.stdout.write(`Shell:   ${result.shell}\n`);
      process.stdout.write(`Profile: ${result.profilePath}\n`);
      process.stdout.write('\nTo undo: gamecli uninstall\n\n');
      return;
    }

    process.stdout.write('\ngamecli: patching shell profile\n\n');
    process.stdout.write(`Shell:   ${result.shell}\n`);
    process.stdout.write(`Profile: ${result.profilePath}\n`);
    process.stdout.write(`Backup:  ${result.backupPath}\n`);

    process.stdout.write('\nDone! Open a new terminal to start with gamecli.\n');
    process.stdout.write('To undo: gamecli uninstall\n\n');
  } catch (e: any) {
    process.stderr.write(`gamecli install: ${e.message}\n`);
    process.exit(1);
  }
}

function handleShellUninstall(): void {
  const installer = new ShellProfileInstaller();

  try {
    const result = installer.uninstall();

    if (result.notInstalled) {
      process.stdout.write('\ngamecli is not installed. Nothing to do.\n\n');
      return;
    }

    process.stdout.write('\ngamecli: removed auto-launch from shell profile\n\n');
    process.stdout.write(`Profile: ${result.profilePath}\n`);
    process.stdout.write('\nDone! New terminals will use the original shell.\n\n');
  } catch (e: any) {
    process.stderr.write(`gamecli uninstall: ${e.message}\n`);
    process.exit(1);
  }
}
