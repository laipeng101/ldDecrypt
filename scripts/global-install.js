#!/usr/bin/env node

/**
 * 全局安装到系统：注册 ld-decrypt / ld-decrypt-tool / unlock 全局命令
 * Windows 额外尝试开启开机自启（等价于 ld-decrypt-tool enable）
 *
 * 用法：npm run globalinstall
 *
 * 说明：Windows 用 npm install -g .（生成 .cmd），比 npm link 更稳
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const autostart = require('../lib/autostart');

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const BIN_NAMES = ['ld-decrypt-tool', 'ld-decrypt', 'unlock'];

/**
 * 执行命令并实时输出
 * @param {string} command - shell 命令
 */
function run(command) {
  console.log(`\n> ${command}\n`);
  execSync(command, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    shell: true
  });
}

/**
 * 执行命令，返回 stdout 文本
 * @param {string} command
 * @returns {string}
 */
function runCapture(command) {
  try {
    return execSync(command, {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (_) {
    return '';
  }
}

/**
 * 确保依赖已安装
 */
function ensureDeps() {
  const nm = path.join(ROOT, 'node_modules');
  if (!fs.existsSync(nm)) {
    console.log('未检测到 node_modules，先安装依赖...');
    run('npm install');
  }
}

/**
 * npm 全局可执行目录（Windows 即 prefix；Unix 为 prefix/bin）
 * @returns {string|null}
 */
function getNpmGlobalBinDir() {
  const prefix = runCapture('npm prefix -g');
  if (!prefix) {
    return null;
  }
  if (process.platform === 'win32') {
    return prefix;
  }
  return path.join(prefix, 'bin');
}

/**
 * PATH 是否包含某目录（Windows 忽略大小写）
 * @param {string} dir
 * @returns {boolean}
 */
function isDirInPath(dir) {
  const pathEnv = process.env.PATH || process.env.Path || '';
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  const target = path.resolve(dir);
  return parts.some((p) => {
    try {
      return path.resolve(p).toLowerCase() === target.toLowerCase();
    } catch (_) {
      return false;
    }
  });
}

/**
 * 检查全局命令 shim 是否生成，以及当前 shell 能否找到
 * @returns {{ binDir: string|null, filesOk: boolean, pathOk: boolean, whereOk: boolean }}
 */
function verifyGlobalCommands() {
  const binDir = getNpmGlobalBinDir();
  const result = {
    binDir,
    filesOk: false,
    pathOk: false,
    whereOk: false
  };

  if (!binDir) {
    console.log('警告: 无法获取 npm 全局目录（npm prefix -g）');
    return result;
  }

  console.log('');
  console.log('全局命令目录:', binDir);
  result.pathOk = isDirInPath(binDir);
  console.log(result.pathOk ? '该目录已在 PATH 中' : '该目录不在当前 PATH 中（这通常就是命令找不到的原因）');

  let allFiles = true;
  for (const name of BIN_NAMES) {
    const candidates =
      process.platform === 'win32'
        ? [path.join(binDir, `${name}.cmd`), path.join(binDir, name)]
        : [path.join(binDir, name)];
    const hit = candidates.find((f) => fs.existsSync(f));
    if (hit) {
      console.log(`  [OK] ${name} -> ${hit}`);
    } else {
      allFiles = false;
      console.log(`  [缺] ${name}（未在全局目录找到 .cmd/可执行文件）`);
    }
  }
  result.filesOk = allFiles;

  // where / which：看当前会话能否解析
  if (process.platform === 'win32') {
    const whereOut = runCapture('where ld-decrypt-tool');
    result.whereOk = Boolean(whereOut) && !/Could not find|找不到|INFO: Could not/i.test(whereOut);
    console.log(result.whereOk ? `where ld-decrypt-tool:\n${whereOut}` : 'where ld-decrypt-tool: 当前 CMD 找不到该命令');
  } else {
    const whichOut = runCapture('which ld-decrypt-tool');
    result.whereOk = Boolean(whichOut);
    console.log(result.whereOk ? `which ld-decrypt-tool: ${whichOut}` : 'which ld-decrypt-tool: 找不到');
  }

  return result;
}

/**
 * 打印命令找不到时的处理步骤
 * @param {{ binDir: string|null, filesOk: boolean, pathOk: boolean, whereOk: boolean }} verify
 */
function printPathFixHelp(verify) {
  if (verify.whereOk && verify.filesOk) {
    return;
  }

  console.log('');
  console.log('-------------------------------------------');
  console.log('  命令暂时不可用 — 请按下面处理');
  console.log('-------------------------------------------');

  if (!verify.filesOk) {
    console.log('1) 全局 shim 未生成。请以「普通用户」重试（或开开发者模式后再装）:');
    console.log('   npm uninstall -g ' + PKG.name);
    console.log('   npm install -g .');
  }

  if (verify.binDir && !verify.pathOk) {
    console.log('2) 把 npm 全局目录加入用户 PATH，然后【新开】一个 CMD:');
    console.log(`   ${verify.binDir}`);
    console.log('   设置方法: Win 搜索「环境变量」→ 用户变量 Path → 新建 → 粘贴上面路径 → 确定');
  }

  if (verify.filesOk && verify.pathOk && !verify.whereOk) {
    console.log('2) 文件和 PATH 都在，但当前窗口仍找不到 → 关掉本 CMD，新开一个再试:');
    console.log('   ld-decrypt-tool');
  }

  console.log('3) 也可不依赖 PATH，直接用完整路径调用，例如:');
  if (verify.binDir) {
    console.log(`   "${path.join(verify.binDir, 'ld-decrypt-tool.cmd')}"`);
  }
  console.log('');
}

async function main() {
  console.log('===========================================');
  console.log('  全局安装到系统');
  console.log('===========================================');
  console.log(`包名: ${PKG.name}`);
  console.log(`目录: ${ROOT}`);
  console.log('');

  ensureDeps();

  // Windows 上 install -g . 生成 .cmd 更稳；顺带兼容旧 link
  console.log('安装到 npm 全局（生成 ld-decrypt-tool 等命令）...');
  try {
    run(`npm uninstall -g ${PKG.name}`);
  } catch (_) {
    // 未安装过则忽略
  }
  run('npm install -g .');

  const verify = verifyGlobalCommands();

  if (autostart.isWindows()) {
    await autostart.enable();
  } else {
    console.log('');
    console.log('当前非 Windows，跳过开机自启。需要时可在 Windows 上执行:');
    console.log('  ld-decrypt-tool enable');
  }

  console.log('');
  console.log('===========================================');
  console.log('  全局安装完成');
  console.log('===========================================');
  console.log('');
  console.log('可用全局命令:');
  console.log('  ld-decrypt / ld-decrypt-tool   # 前台启动 Web 服务');
  console.log('  ld-decrypt-tool start          # 后台启动');
  console.log('  ld-decrypt-tool stop           # 停止服务');
  console.log('  ld-decrypt-tool enable         # 开自启；若未运行则同时后台启动');
  console.log('  ld-decrypt-tool disable        # 关闭开机自启（Windows）');
  console.log('  unlock <源> [目标]             # 命令行解密');
  console.log('');
  console.log('卸载请执行:');
  console.log('  npm run globalunstall');
  console.log('');

  printPathFixHelp(verify);
}

main().catch((error) => {
  console.error('');
  console.error('全局安装失败:', error.message || error);
  process.exit(1);
});
