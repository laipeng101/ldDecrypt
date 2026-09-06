#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const stageRoot = path.join(desktopRoot, '.build', 'core');

function resolveNpmCliPath() {
  const environmentPath = process.env.npm_execpath;
  if (
    environmentPath &&
    fs.existsSync(environmentPath) &&
    fs.statSync(environmentPath).isFile()
  ) {
    return environmentPath;
  }

  const nodeRoot = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeRoot, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeRoot, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  const candidate = candidates.find((item) => fs.existsSync(item));

  if (!candidate) {
    throw new Error('无法解析 npm CLI 入口。请通过 npm run 执行 stage:core。');
  }

  return candidate;
}

const npmCliPath = resolveNpmCliPath();

function runNpm(args, cwd) {
  const executable = process.execPath;
  const commandArgs = [npmCliPath, ...args];
  const result = spawnSync(executable, commandArgs, {
    cwd,
    stdio: 'pipe',
    shell: false,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    throw new Error(`命令失败: ${executable} ${commandArgs.join(' ')}`);
  }

  return result.stdout;
}

function copyPayloadFiles() {
  const payloadJson = runNpm(['pack', '--dry-run', '--json'], repoRoot);
  const payload = JSON.parse(payloadJson);
  if (!Array.isArray(payload) || !Array.isArray(payload[0]?.files)) {
    throw new Error('npm pack 未返回有效文件清单。');
  }

  for (const file of payload[0].files) {
    const relativePath = file.path.replace(/\\/g, '/');
    if (
      relativePath === 'desktop' ||
      relativePath.startsWith('desktop/') ||
      relativePath === '.npmrc' ||
      relativePath.startsWith('.github/')
    ) {
      continue;
    }

    const sourcePath = path.join(repoRoot, relativePath);
    const targetPath = path.join(stageRoot, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function assertStageLayout() {
  const required = [
    'index.js',
    'package.json',
    'package-lock.json',
    'lib/runtime-paths.js',
    'views/index.ejs',
    'node_modules/express',
    'node_modules/chokidar',
    'node_modules/multer',
    'node_modules/ejs'
  ];
  const forbidden = [
    'desktop',
    '.npmrc',
    'uploads',
    'decrypted',
    'node_modules/nodemon',
    'node_modules/electron',
    'node_modules/electron-builder'
  ];

  for (const item of required) {
    if (!fs.existsSync(path.join(stageRoot, item))) {
      throw new Error(`staged Core 缺少 ${item}`);
    }
  }

  for (const item of forbidden) {
    if (fs.existsSync(path.join(stageRoot, item))) {
      throw new Error(`staged Core 不应包含 ${item}`);
    }
  }
}

function verifyProductionTree() {
  const packageJson = require(path.join(stageRoot, 'package.json'));
  const npmLsJson = runNpm(['ls', '--omit=dev', '--depth=0', '--json'], stageRoot);
  const installed = JSON.parse(npmLsJson).dependencies || {};
  const installedNames = new Set(Object.keys(installed));

  for (const dependency of Object.keys(packageJson.dependencies || {})) {
    if (!installedNames.has(dependency)) {
      throw new Error(`production dependency 缺失: ${dependency}`);
    }
  }

  const nativeAddons = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const itemPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(itemPath);
      } else if (entry.isFile() && entry.name.endsWith('.node')) {
        nativeAddons.push(itemPath);
      }
    }
  };
  walk(path.join(stageRoot, 'node_modules'));

  if (nativeAddons.length > 0) {
    throw new Error(`发现 native production addon，需要先确认 Electron ABI rebuild: ${nativeAddons.join(', ')}`);
  }

  console.log(`staged production dependencies: ${[...installedNames].join(', ')}`);
  console.log('native production addons: none');
}

fs.rmSync(stageRoot, { recursive: true, force: true });
fs.mkdirSync(stageRoot, { recursive: true });

copyPayloadFiles();
fs.copyFileSync(path.join(repoRoot, 'package-lock.json'), path.join(stageRoot, 'package-lock.json'));
runNpm(['ci', '--omit=dev', '--no-audit', '--no-fund'], stageRoot);
assertStageLayout();
verifyProductionTree();

console.log(`staged Core: ${stageRoot}`);
