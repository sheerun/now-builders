import assert from 'assert';
import fs from 'fs-extra';
import path from 'path';
import { spawn, SpawnOptions } from 'child_process';

function spawnAsync(command: string, args: string[], cwd: string, opts: SpawnOptions = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd, ...opts });
    child.on('error', reject);
    child.on('close', (code, signal) => (code !== 0
      ? reject(new Error(`Exited with ${code || signal}`))
      : resolve()));
  });
}

async function chmodPlusX(fsPath: string) {
  const s = await fs.stat(fsPath);
  const newMode = s.mode | 64 | 8 | 1; // eslint-disable-line no-bitwise
  if (s.mode === newMode) return;
  const base8 = newMode.toString(8).slice(-3);
  await fs.chmod(fsPath, base8);
}

export async function runShellScript(fsPath: string) {
  assert(path.isAbsolute(fsPath));
  const destPath = path.dirname(fsPath);
  await chmodPlusX(fsPath);
  await spawnAsync(`./${path.basename(fsPath)}`, [], destPath);
  return true;
}

async function scanParentDirs(destPath: string, scriptName?: string) {
  assert(path.isAbsolute(destPath));

  let hasScript = false;
  let hasPackageLockJson = false;
  let currentDestPath = destPath;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const packageJsonPath = path.join(currentDestPath, 'package.json');
    // eslint-disable-next-line no-await-in-loop
    if (await fs.pathExists(packageJsonPath)) {
      // eslint-disable-next-line no-await-in-loop
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      hasScript = Boolean(
        packageJson.scripts && scriptName && packageJson.scripts[scriptName],
      );
      // eslint-disable-next-line no-await-in-loop
      hasPackageLockJson = await fs.pathExists(
        path.join(currentDestPath, 'package-lock.json'),
      );
      break;
    }

    const newDestPath = path.dirname(currentDestPath);
    if (currentDestPath === newDestPath) break;
    currentDestPath = newDestPath;
  }

  return { hasScript, hasPackageLockJson };
}

export async function installDependencies(destPath: string, args: string[] = []) {
  assert(path.isAbsolute(destPath));

  let commandArgs = args;
  console.log(`installing to ${destPath}`);
  const { hasPackageLockJson } = await scanParentDirs(destPath);

  const opts = {
    env: {
      ...process.env,
      // This is a little hack to force `node-gyp` to build for the
      // Node.js version that `@now/node` and `@now/node-server` use
      npm_config_target: '8.10.0',
    },
  };

  if (hasPackageLockJson) {
    commandArgs = args.filter(a => a !== '--prefer-offline');
    await spawnAsync('npm', ['install'].concat(commandArgs), destPath, opts);
  } else {
    await spawnAsync(
      'yarn',
      ['--cwd', destPath].concat(commandArgs),
      destPath,
      opts,
    );
  }
}

export async function runPackageJsonScript(destPath: string, scriptName: string) {
  assert(path.isAbsolute(destPath));
  const { hasScript, hasPackageLockJson } = await scanParentDirs(
    destPath,
    scriptName,
  );
  if (!hasScript) return false;

  if (hasPackageLockJson) {
    console.log(`running "npm run ${scriptName}"`);
    await spawnAsync('npm', ['run', scriptName], destPath);
  } else {
    console.log(`running "yarn run ${scriptName}"`);
    await spawnAsync('yarn', ['--cwd', destPath, 'run', scriptName], destPath);
  }

  return true;
}

export const runNpmInstall = installDependencies;
