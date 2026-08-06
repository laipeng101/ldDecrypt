#!/usr/bin/env node

/**
 * CLI 入口：
 *   ld-decrypt-tool              前台启动
 *   ld-decrypt-tool start        后台启动
 *   ld-decrypt-tool stop         停止服务
 *   ld-decrypt-tool enable       开开机自启（Windows）；未运行则同时后台启动
 *   ld-decrypt-tool disable      关开机自启（Windows）
 */

const autostart = require('../lib/autostart');
const service = require('../lib/service');

const args = process.argv.slice(2);
const cmd = (args[0] || '').toLowerCase();

/**
 * 统一处理 async 命令退出码
 * @param {Promise<boolean|string>} promise
 */
function runAsync(promise) {
  Promise.resolve(promise)
    .then((result) => {
      // 前台启动成功后进程需保持运行，不能 exit
      if (result === 'started') {
        return;
      }
      if (result === false) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('命令失败:', err.message || err);
      process.exit(1);
    });
}

if (cmd === 'start') {
  runAsync(service.startBackground());
  return;
}

if (cmd === 'stop') {
  runAsync(service.stopService());
  return;
}

if (cmd === 'enable') {
  runAsync(autostart.enable());
  return;
}

if (cmd === 'disable') {
  const ok = autostart.disable();
  process.exit(ok ? 0 : 1);
}

if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
  console.log('');
  console.log('用法:');
  console.log('  ld-decrypt-tool              前台启动 Web 服务');
  console.log('  ld-decrypt-tool start        后台静默启动');
  console.log('  ld-decrypt-tool stop         停止服务');
  console.log('  ld-decrypt-tool enable       开自启；未运行则同时后台启动（仅 Windows）');
  console.log('  ld-decrypt-tool disable      关闭开机自启（仅 Windows）');
  console.log('  unlock <源> [目标]           命令行解密');
  console.log('');
  process.exit(0);
}

if (cmd && !cmd.startsWith('-')) {
  console.log('');
  console.log(`未知参数: ${cmd}`);
  console.log('可用: start | stop | enable | disable | help（无参数则前台启动）');
  console.log('');
  process.exit(1);
}

// 默认：前台启动（已运行则只提示，不重复拉起）
runAsync(service.startForeground());
