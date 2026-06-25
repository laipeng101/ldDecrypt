#!/usr/bin/env node

/**
 * npm postinstall 脚本
 * 安装后自动注册为 Windows 服务，实现开机自启
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVICE_NAME = 'LdDecryptTool';
const SERVICE_DISPLAY = '天锐绿盾文件解密工具';

// 检测是否为 Windows 系统
function isWindows() {
  return process.platform === 'win32';
}

// 检测是否已以管理员权限运行
function isAdmin() {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 创建 Windows 服务（使用 sc 命令）
function createWindowsService() {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(__dirname, '..', 'index.js');
  
  // 使用 nssm 或直接创建启动脚本
  const startupDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const batPath = path.join(startupDir, 'ld-decrypt-tool.bat');
  
  // 创建启动批处理文件
  const batContent = `@echo off
cd /d "${path.resolve(__dirname, '..')}"
"${nodePath}" index.js
`;
  
  try {
    fs.writeFileSync(batPath, batContent);
    console.log('');
    console.log('===========================================');
    console.log('  天锐绿盾文件解密工具 - 安装成功！');
    console.log('===========================================');
    console.log('');
    console.log('已创建开机自启项：');
    console.log(`  ${batPath}`);
    console.log('');
    console.log('服务将在下次开机时自动启动');
    console.log('访问地址: http://localhost:3000');
    console.log('');
    console.log('手动启动命令:');
    console.log('  ld-decrypt');
    console.log('');
    return true;
  } catch (error) {
    // 如果没有写入启动目录的权限，尝试其他方式
    console.log('无法写入启动目录，尝试注册任务计划...');
    return false;
  }
}

// 使用任务计划程序实现开机自启
function createScheduledTask() {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(__dirname, '..', 'index.js');
  
  try {
    // 创建 VBS 脚本来隐藏命令行窗口
    const vbsPath = path.resolve(__dirname, 'start-hidden.vbs');
    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${nodePath}"" ""${scriptPath}""", 0, False
`;
    fs.writeFileSync(vbsPath, vbsContent);
    
    // 注册任务计划
    const taskCmd = `schtasks /create /tn "${SERVICE_NAME}" /tr "wscript.exe \"${vbsPath}\"" /sc onlogon /rl highest /f`;
    execSync(taskCmd, { stdio: 'ignore' });
    
    console.log('');
    console.log('===========================================');
    console.log('  天锐绿盾文件解密工具 - 安装成功！');
    console.log('===========================================');
    console.log('');
    console.log('已注册任务计划程序，开机自启已启用');
    console.log('访问地址: http://localhost:3000');
    console.log('');
    return true;
  } catch (error) {
    console.log('');
    console.log('===========================================');
    console.log('  天锐绿盾文件解密工具 - 安装成功！');
    console.log('===========================================');
    console.log('');
    console.log('注意: 无法自动配置开机自启');
    console.log('请以管理员身份运行以下命令来启用开机自启：');
    console.log(`  node "${path.resolve(__dirname, 'setup-autostart.js')}"`);
    console.log('');
    console.log('手动启动命令:');
    console.log('  ld-decrypt');
    console.log('');
    return false;
  }
}

// 主逻辑
if (isWindows()) {
  // 先尝试直接写入启动目录
  const success = createWindowsService();
  
  if (!success) {
    // 如果失败，尝试任务计划
    createScheduledTask();
  }
} else {
  console.log('');
  console.log('===========================================');
  console.log('  天锐绿盾文件解密工具 - 安装成功！');
  console.log('===========================================');
  console.log('');
  console.log('手动启动命令:');
  console.log('  ld-decrypt');
  console.log('');
  console.log('如需开机自启，请参考系统文档配置 systemd 或 launchd');
  console.log('');
}
