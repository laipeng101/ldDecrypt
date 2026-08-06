#!/usr/bin/env node

/**
 * 全局安装到系统：注册 ld-decrypt / ld-decrypt-tool / unlock 全局命令
 * Windows 额外配置开机自启 ld-decrypt-tool
 * macOS / Linux 只装全局命令，不配自启
 *
 * 用法：npm run globalinstall
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
 * Windows：写入启动项 bat
 * @returns {boolean}
 */
function createStartupBat() {
  const nodePath = process.execPath;
  const startupDir = path.join(
    process.env.APPDATA,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  );
  const batPath = path.join(startupDir, 'ld-decrypt-tool.bat');
  const batContent = `@echo off
cd /d "${ROOT}"
"${nodePath}" index.js
`;

  try {
    fs.writeFileSync(batPath, batContent);
    console.log('已创建开机自启项:', batPath);
    return true;
  } catch (error) {
    console.log('无法写入启动目录，尝试任务计划...', error.message);
    return false;
  }
}

/**
 * Windows：任务计划回退方案
 * @returns {boolean}
 */
function createScheduledTask() {
  const nodePath = process.execPath;
  const scriptPath = path.join(ROOT, 'index.js');

  try {
    const vbsPath = path.resolve(__dirname, 'start-hidden.vbs');
    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${nodePath}"" ""${scriptPath}""", 0, False
`;
    fs.writeFileSync(vbsPath, vbsContent);

    const taskCmd = `schtasks /create /tn "${SERVICE_NAME}" /tr "wscript.exe \"${vbsPath}\"" /sc onlogon /rl highest /f`;
    execSync(taskCmd, { stdio: 'ignore' });
    console.log('已注册任务计划开机自启:', SERVICE_NAME);
    return true;
  } catch (error) {
    console.log('任务计划注册失败:', error.message);
    console.log('可手动以管理员运行: node scripts/setup-autostart.js');
    return false;
  }
}

/**
 * Windows 开机自启：优先启动项，失败再任务计划
 */
function setupWindowsAutostart() {
  console.log('');
  console.log('[Windows] 配置开机自启 ld-decrypt-tool ...');
  const ok = createStartupBat();
  if (!ok) {
    createScheduledTask();
  }
}

function main() {
  console.log('===========================================');
  console.log('  全局安装到系统');
  console.log('===========================================');
  console.log(`包名: ${PKG.name}`);
  console.log(`目录: ${ROOT}`);
  console.log('');

  ensureDeps();

  // 注册全局命令：ld-decrypt / ld-decrypt-tool / unlock
  run('npm link');

  if (isWindows()) {
    setupWindowsAutostart();
  } else {
    console.log('');
    console.log('当前非 Windows，跳过开机自启配置。');
  }

  console.log('');
  console.log('===========================================');
  console.log('  全局安装完成');
  console.log('===========================================');
  console.log('');
  console.log('可用全局命令:');
  console.log('  ld-decrypt          # 启动 Web 服务');
  console.log('  ld-decrypt-tool     # 同上');
  console.log('  unlock <源> [目标]  # 命令行解密');
  console.log('');
  console.log('卸载请执行:');
  console.log('  npm run globalunstall');
  console.log('');
}

try {
  main();
} catch (error) {
  console.error('');
  console.error('全局安装失败:', error.message || error);
  process.exit(1);
}
