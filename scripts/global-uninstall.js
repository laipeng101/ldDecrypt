#!/usr/bin/env node

/**
 * 从系统卸载：移除全局命令，服务与 unlock 命令行均不可再用
 * Windows 额外关闭开机自启（等价于 ld-decrypt-tool disable）
 *
 * 用法：npm run globalunstall
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const autostart = require('../lib/autostart');

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/**
 * 执行命令（允许失败）
 * @param {string} command - shell 命令
 * @returns {boolean}
 */
function runSoft(command) {
  console.log(`\n> ${command}\n`);
  try {
    execSync(command, {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
      shell: true
    });
    return true;
  } catch (error) {
    console.log(`命令未完全成功（可忽略若已卸载）: ${command}`);
    return false;
  }
}

function main() {
  console.log('===========================================');
  console.log('  从系统卸载');
  console.log('===========================================');
  console.log(`包名: ${PKG.name}`);
  console.log('');

  if (autostart.isWindows()) {
    autostart.disable();
  } else {
    console.log('当前非 Windows，跳过开机自启清理。');
  }

  console.log('');
  console.log('移除全局命令（link 与 install -g 两种来源都尝试）...');
  runSoft(`npm unlink -g ${PKG.name}`);
  runSoft(`npm uninstall -g ${PKG.name}`);

  console.log('');
  console.log('===========================================');
  console.log('  卸载完成');
  console.log('===========================================');
  console.log('');
  console.log('以下命令应已不可用:');
  console.log('  ld-decrypt / ld-decrypt-tool / unlock');
  console.log('');
  console.log('若终端仍能找到命令，请新开一个终端再试（PATH 缓存）。');
  console.log('若服务进程仍在跑，请手动结束对应 node 进程。');
  console.log('');
}

try {
  main();
} catch (error) {
  console.error('');
  console.error('卸载失败:', error.message || error);
  process.exit(1);
}
