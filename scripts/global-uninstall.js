#!/usr/bin/env node

/**
 * 从系统卸载：移除全局命令，服务与 unlock 命令行均不可再用
 * Windows 额外清除开机自启 ld-decrypt-tool
 * macOS / Linux 只卸全局命令，不碰自启
 *
 * 用法：npm run globalunstall
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SERVICE_NAME = 'LdDecryptTool';

/**
 * 是否 Windows
 * @returns {boolean}
 */
function isWindows() {
  return process.platform === 'win32';
}

/**
 * 执行命令（允许失败，不抛出）
 * @param {string} command - shell 命令
 * @returns {boolean} 是否成功
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

/**
 * 移除 Windows「启动」文件夹中的 bat
 */
function removeStartupItem() {
  const startupDir = path.join(
    process.env.APPDATA,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  );
  const batPath = path.join(startupDir, 'ld-decrypt-tool.bat');

  try {
    if (fs.existsSync(batPath)) {
      fs.unlinkSync(batPath);
      console.log('已移除启动项:', batPath);
    }
  } catch (error) {
    console.log('移除启动项失败:', error.message);
  }
}

/**
 * 移除登录时任务计划
 */
function removeScheduledTask() {
  try {
    execSync(`schtasks /delete /tn "${SERVICE_NAME}" /f`, { stdio: 'ignore' });
    console.log('已移除任务计划:', SERVICE_NAME);
  } catch (error) {
    // 任务可能不存在
  }
}

/**
 * 移除隐藏启动用 VBS
 */
function removeVBSScript() {
  const vbsPath = path.resolve(__dirname, 'start-hidden.vbs');
  try {
    if (fs.existsSync(vbsPath)) {
      fs.unlinkSync(vbsPath);
      console.log('已移除启动脚本:', vbsPath);
    }
  } catch (error) {
    console.log('移除启动脚本失败:', error.message);
  }
}

/**
 * Windows：清除开机自启
 */
function cleanupWindowsAutostart() {
  console.log('');
  console.log('[Windows] 清除开机自启 ld-decrypt-tool ...');
  removeStartupItem();
  removeScheduledTask();
  removeVBSScript();
}

/**
 * 移除全局包 / 链接，使 ld-decrypt、ld-decrypt-tool、unlock 均失效
 */
function removeGlobalCommands() {
  console.log('');
  console.log('移除全局命令（link 与 install -g 两种来源都尝试）...');

  // 源码 npm link 装上的
  runSoft(`npm unlink -g ${PKG.name}`);
  // 从 npm 仓库 npm install -g 装上的
  runSoft(`npm uninstall -g ${PKG.name}`);
}

function main() {
  console.log('===========================================');
  console.log('  从系统卸载');
  console.log('===========================================');
  console.log(`包名: ${PKG.name}`);
  console.log('');

  if (isWindows()) {
    cleanupWindowsAutostart();
  } else {
    console.log('当前非 Windows，跳过开机自启清理。');
  }

  removeGlobalCommands();

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
