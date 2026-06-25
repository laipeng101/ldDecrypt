#!/usr/bin/env node

/**
 * 手动配置开机自启脚本
 * 需要以管理员权限运行
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVICE_NAME = 'LdDecryptTool';

// 检测是否以管理员权限运行
function isAdmin() {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!isAdmin()) {
  console.log('');
  console.log('错误: 需要管理员权限运行此脚本');
  console.log('');
  console.log('请右键点击 PowerShell/CMD，选择"以管理员身份运行"，然后执行：');
  console.log(`  node "${__filename}"`);
  console.log('');
  process.exit(1);
}

const nodePath = process.execPath;
const scriptPath = path.resolve(__dirname, '..', 'index.js');

// 创建 VBS 脚本来隐藏命令行窗口
const vbsPath = path.resolve(__dirname, 'start-hidden.vbs');
const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${nodePath}"" ""${scriptPath}""", 0, False
`;

try {
  fs.writeFileSync(vbsPath, vbsContent);
  
  // 注册任务计划
  const taskCmd = `schtasks /create /tn "${SERVICE_NAME}" /tr "wscript.exe \\"${vbsPath}\\"" /sc onlogon /rl highest /f`;
  execSync(taskCmd, { stdio: 'ignore' });
  
  console.log('');
  console.log('===========================================');
  console.log('  开机自启配置成功！');
  console.log('===========================================');
  console.log('');
  console.log('下次登录时服务将自动启动');
  console.log('访问地址: http://localhost:3000');
  console.log('');
} catch (error) {
  console.log('');
  console.log('配置失败:', error.message);
  console.log('');
}
