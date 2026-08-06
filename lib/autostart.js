#!/usr/bin/env node

/**
 * Windows 开机自启：开启 / 关闭（完全静默，无黑窗）
 * 供 CLI（ld-decrypt-tool enable|disable）与安装脚本复用
 *
 * 实现：启动文件夹放入 VBS，用 WScript.Shell.Run 窗口样式 0 拉起 node
 * 禁止使用 .bat（会弹出黑色 CMD 窗口）
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const service = require('./service');

/** 任务计划名称 */
const SERVICE_NAME = 'LdDecryptTool';

/** 包根目录（本文件在 lib/ 下） */
const PKG_ROOT = path.resolve(__dirname, '..');

/**
 * 是否 Windows
 * @returns {boolean}
 */
function isWindows() {
  return process.platform === 'win32';
}

/**
 * VBS 字符串内转义双引号
 * @param {string} value
 * @returns {string}
 */
function vbsEscape(value) {
  return String(value).replace(/"/g, '""');
}

/**
 * 用户「启动」文件夹
 * @returns {string}
 */
function getStartupDir() {
  return path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  );
}

/** 旧版会弹黑窗的 bat（enable 时必须清掉） */
function getStartupBatPath() {
  return path.join(getStartupDir(), 'ld-decrypt-tool.bat');
}

/** 静默启动 VBS（放在启动文件夹） */
function getStartupVbsPath() {
  return path.join(getStartupDir(), 'ld-decrypt-tool-silent.vbs');
}

/** 任务计划用的包内 VBS */
function getPackageVbsPath() {
  return path.join(__dirname, 'start-hidden.vbs');
}

/**
 * 生成完全静默启动的 VBS 正文
 * Run 第二个参数 0 = 隐藏窗口，不出现黑框
 * @returns {string}
 */
function buildSilentVbsContent() {
  const nodePath = vbsEscape(process.execPath);
  const indexJs = vbsEscape(path.join(PKG_ROOT, 'index.js'));
  const workDir = vbsEscape(PKG_ROOT);

  return [
    "' ld-decrypt-tool 静默自启 — 勿改成 bat，否则会弹黑窗",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${workDir}"`,
    // 0 = 隐藏窗口；False = 异步，不等待进程结束",
    `sh.Run """${nodePath}"" ""${indexJs}""", 0, False`,
    ''
  ].join('\r\n');
}

/**
 * 写入启动文件夹静默 VBS（登录即后台起服务，一般无需管理员）
 * @returns {boolean}
 */
function createSilentStartupVbs() {
  const vbsPath = getStartupVbsPath();
  try {
    if (!fs.existsSync(getStartupDir())) {
      fs.mkdirSync(getStartupDir(), { recursive: true });
    }
    fs.writeFileSync(vbsPath, buildSilentVbsContent(), 'utf8');
    console.log('已创建静默自启项（无黑窗）:', vbsPath);
    return true;
  } catch (error) {
    console.log('无法写入启动目录:', error.message);
    return false;
  }
}

/**
 * 回退：注册隐藏任务计划（登录触发，Hidden）
 * @returns {boolean}
 */
function createHiddenScheduledTask() {
  const nodePath = process.execPath;
  const indexJs = path.join(PKG_ROOT, 'index.js');
  const vbsPath = getPackageVbsPath();

  try {
    fs.writeFileSync(vbsPath, buildSilentVbsContent(), 'utf8');

    // 用 PowerShell 注册隐藏任务：直接跑 wscript 执行静默 VBS
    const ps1 = path.join(os.tmpdir(), `ld-decrypt-autostart-${Date.now()}.ps1`);
    const psContent = [
      `$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '//B //Nologo "${vbsPath.replace(/'/g, "''")}"'`,
      `$trigger = New-ScheduledTaskTrigger -AtLogOn`,
      `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -Hidden`,
      `$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited`,
      `Register-ScheduledTask -TaskName '${SERVICE_NAME}' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null`
    ].join('\r\n');

    fs.writeFileSync(ps1, psContent, 'utf8');
    execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`,
      { stdio: 'ignore' }
    );
    try {
      fs.unlinkSync(ps1);
    } catch (_) {
      // 忽略临时文件清理失败
    }

    console.log('已注册隐藏任务计划开机自启:', SERVICE_NAME);
    return true;
  } catch (error) {
    console.log('任务计划注册失败:', error.message);
    return false;
  }
}

/**
 * 删除文件（存在才删）
 * @param {string} filePath
 * @param {string} label
 */
function removeFileIfExists(filePath, label) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`已移除${label}:`, filePath);
    }
  } catch (error) {
    console.log(`移除${label}失败:`, error.message);
  }
}

/**
 * 移除任务计划
 */
function removeScheduledTask() {
  try {
    execSync(`schtasks /delete /tn "${SERVICE_NAME}" /f`, { stdio: 'ignore' });
    console.log('已移除任务计划:', SERVICE_NAME);
  } catch (error) {
    // 不存在则忽略
  }
}

/**
 * 清理所有自启残留（含旧版会弹黑窗的 bat）
 */
function cleanupAllAutostartArtifacts() {
  removeFileIfExists(getStartupBatPath(), '旧版 bat 自启（会弹黑窗）');
  removeFileIfExists(getStartupVbsPath(), '静默 VBS 自启');
  removeFileIfExists(getPackageVbsPath(), '包内静默脚本');
  removeScheduledTask();
}

/**
 * 开启开机自启（仅 Windows，完全静默）
 * 同时：若当前服务未启动，则立即后台静默拉起
 * @returns {Promise<boolean>}
 */
async function enable() {
  if (!isWindows()) {
    console.log('');
    console.log('开机自启仅支持 Windows。当前系统:', process.platform);
    console.log('');
    return false;
  }

  console.log('');
  console.log('===========================================');
  console.log('  开启开机自启（静默后台，无黑窗）');
  console.log('===========================================');
  console.log('');

  // 先清掉旧 bat，避免登录仍弹黑窗
  removeFileIfExists(getStartupBatPath(), '旧版 bat 自启（会弹黑窗）');

  const ok = createSilentStartupVbs() || createHiddenScheduledTask();
  if (ok) {
    console.log('');
    console.log('下次登录将在后台静默启动服务（无黑窗）');
    // 当前未启动则马上静默拉起；已运行则打日志
    await service.ensureServiceStarted();
    console.log('关闭自启: ld-decrypt-tool disable');
    console.log('');
  } else {
    console.log('');
    console.log('开启失败。可尝试以管理员身份运行:');
    console.log('  ld-decrypt-tool enable');
    console.log('');
  }
  return ok;
}

/**
 * 关闭开机自启（仅 Windows）
 * @returns {boolean}
 */
function disable() {
  if (!isWindows()) {
    console.log('');
    console.log('开机自启仅支持 Windows。当前系统:', process.platform);
    console.log('');
    return false;
  }

  console.log('');
  console.log('===========================================');
  console.log('  关闭开机自启（ld-decrypt-tool）');
  console.log('===========================================');
  console.log('');

  cleanupAllAutostartArtifacts();

  console.log('');
  console.log('开机自启已关闭。重新开启: ld-decrypt-tool enable');
  console.log('说明: disable 只关自启，不会停止当前已运行的服务；停服务请用: ld-decrypt-tool stop');
  console.log('');
  return true;
}

module.exports = {
  SERVICE_NAME,
  isWindows,
  enable,
  disable
};
