#!/usr/bin/env node

/**
 * npm preuninstall 脚本
 * 卸载前自动移除 Windows 服务和启动项
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVICE_NAME = 'LdDecryptTool';

// 检测是否为 Windows 系统
function isWindows() {
  return process.platform === 'win32';
}

// 移除启动项
function removeStartupItem() {
  const startupDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
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

// 移除任务计划
function removeScheduledTask() {
  try {
    execSync(`schtasks /delete /tn "${SERVICE_NAME}" /f`, { stdio: 'ignore' });
    console.log('已移除任务计划:', SERVICE_NAME);
  } catch (error) {
    // 任务可能不存在，忽略错误
  }
}

// 移除 VBS 启动脚本
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

// 主逻辑
if (isWindows()) {
  console.log('正在清理天锐绿盾文件解密工具...');
  
  removeStartupItem();
  removeScheduledTask();
  removeVBSScript();
  
  console.log('清理完成');
}
