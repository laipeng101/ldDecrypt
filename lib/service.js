/**
 * 服务启停与运行探测
 * 供 ld-decrypt-tool（前台 / start / stop / enable）复用
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');

const PKG_ROOT = path.resolve(__dirname, '..');

/**
 * 服务监听端口
 * @returns {number}
 */
function getServicePort() {
  const port = Number(process.env.PORT || 3000);
  return Number.isFinite(port) && port > 0 ? port : 3000;
}

/**
 * PID 文件路径（跨会话记录后台进程）
 * @returns {string}
 */
function getPidPath() {
  return path.join(os.tmpdir(), 'ld-decrypt-tool.pid');
}

/**
 * 写入 PID
 * @param {number} pid
 */
function writePid(pid) {
  try {
    fs.writeFileSync(getPidPath(), String(pid), 'utf8');
  } catch (_) {
    // 忽略
  }
}

/**
 * 读取 PID
 * @returns {number|null}
 */
function readPid() {
  try {
    const raw = fs.readFileSync(getPidPath(), 'utf8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch (_) {
    return null;
  }
}

/**
 * 清除 PID 文件
 */
function clearPid() {
  try {
    if (fs.existsSync(getPidPath())) {
      fs.unlinkSync(getPidPath());
    }
  } catch (_) {
    // 忽略
  }
}

/**
 * 探测端口是否在监听
 * @returns {Promise<boolean>}
 */
function isServiceRunning() {
  const port = getServicePort();

  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 1500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(true));
      req.on('timeout', () => {
        req.destroy();
        resolve(true);
      });
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * 等待服务就绪
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitUntilRunning(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServiceRunning()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * 等待服务停止
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitUntilStopped(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isServiceRunning())) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * 按端口查监听进程 PID（跨平台）
 * @param {number} port
 * @returns {number|null}
 */
function findPidByPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      const lines = out.split(/\r?\n/);
      for (const line of lines) {
        if (!line.includes('LISTENING')) {
          continue;
        }
        // 匹配 *:3000 或 0.0.0.0:3000 或 [::]:3000 或 127.0.0.1:3000
        const m = line.match(new RegExp(`[:\\[]${port}\\]?\\s+.*?LISTENING\\s+(\\d+)`, 'i'))
          || line.match(new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'i'));
        if (m) {
          const pid = Number(m[1]);
          if (pid > 0) {
            return pid;
          }
        }
      }
      return null;
    }

    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
    const pid = Number(out.split(/\s+/)[0]);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch (_) {
    return null;
  }
}

/**
 * 结束指定 PID
 * @param {number} pid
 * @returns {boolean}
 */
function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch (_) {
    try {
      if (process.platform !== 'win32') {
        process.kill(pid, 'SIGKILL');
        return true;
      }
    } catch (__) {
      // 忽略
    }
    return false;
  }
}

/**
 * 后台静默启动（无黑窗）
 * @returns {{ ok: boolean, pid?: number }}
 */
function startServiceSilent() {
  const indexJs = path.join(PKG_ROOT, 'index.js');
  try {
    const child = spawn(process.execPath, [indexJs], {
      cwd: PKG_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(getServicePort())
      }
    });
    if (child.pid) {
      writePid(child.pid);
    }
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (error) {
    console.log('静默启动服务失败:', error.message);
    return { ok: false };
  }
}

/**
 * 前台启动：若已在跑则只提示并退出；否则阻塞运行服务
 * @returns {Promise<'already'|'started'>}
 */
async function startForeground() {
  const port = getServicePort();
  if (await isServiceRunning()) {
    console.log('');
    console.log(`服务已在运行（端口 ${port}），无需重复前台启动`);
    console.log(`访问: http://localhost:${port}`);
    console.log('停止请用: ld-decrypt-tool stop');
    console.log('');
    return 'already';
  }

  console.log('');
  console.log('===========================================');
  console.log('  天锐绿盾文件解密工具（前台）');
  console.log('===========================================');
  console.log('');
  console.log('正在启动服务...');
  console.log(`访问地址: http://localhost:${port}`);
  console.log('按 Ctrl+C 停止服务');
  console.log('');

  process.env.PORT = String(port);
  writePid(process.pid);
  process.on('exit', clearPid);
  process.on('SIGINT', () => {
    clearPid();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    clearPid();
    process.exit(0);
  });

  require('../index.js');
  return 'started';
}

/**
 * 后台启动：已在跑则提示；否则静默拉起
 * @returns {Promise<boolean>}
 */
async function startBackground() {
  const port = getServicePort();
  console.log('');
  console.log('===========================================');
  console.log('  后台启动服务');
  console.log('===========================================');
  console.log('');

  if (await isServiceRunning()) {
    console.log(`服务已在运行（端口 ${port}），跳过启动`);
    console.log(`访问: http://localhost:${port}`);
    console.log('停止请用: ld-decrypt-tool stop');
    console.log('');
    return true;
  }

  console.log(`服务未运行，正在后台静默启动（端口 ${port}）...`);
  const result = startServiceSilent();
  if (!result.ok) {
    console.log('后台启动失败，请检查 Node 环境或手动执行: ld-decrypt-tool');
    console.log('');
    return false;
  }

  const ready = await waitUntilRunning(8000);
  if (ready) {
    console.log(`服务已后台启动${result.pid ? `（pid ${result.pid}）` : ''}`);
    console.log(`访问: http://localhost:${port}`);
    console.log('停止请用: ld-decrypt-tool stop');
    console.log('');
    return true;
  }

  console.log('已发起后台启动，但暂未探测到端口就绪，请稍后访问或执行 stop 后重试');
  console.log('');
  return false;
}

/**
 * 停止服务：未运行则提示；否则杀进程
 * @returns {Promise<boolean>}
 */
async function stopService() {
  const port = getServicePort();
  console.log('');
  console.log('===========================================');
  console.log('  停止服务');
  console.log('===========================================');
  console.log('');

  if (!(await isServiceRunning())) {
    console.log(`服务未在运行（端口 ${port}），无需停止`);
    clearPid();
    console.log('');
    return true;
  }

  let pid = readPid();
  if (!pid) {
    pid = findPidByPort(port);
  }

  if (!pid) {
    console.log(`服务端口 ${port} 在监听，但未能解析 PID，请手动结束占用该端口的进程`);
    console.log('');
    return false;
  }

  console.log(`正在停止服务（pid ${pid}，端口 ${port}）...`);
  const killed = killPid(pid);
  if (!killed) {
    console.log(`结束进程 pid ${pid} 失败，尝试按端口再查...`);
    // pid 文件可能过期，再按端口试一次
    const portPid = findPidByPort(port);
    if (portPid && portPid !== pid) {
      console.log(`改用端口对应进程 pid ${portPid} 重试...`);
      const retryOk = killPid(portPid);
      if (!retryOk) {
        console.log(`结束进程 pid ${portPid} 仍失败，请手动结束占用端口 ${port} 的进程`);
        console.log('');
        return false;
      }
    } else if (!portPid) {
      console.log(`未能找到端口 ${port} 对应进程，请手动检查`);
      console.log('');
      return false;
    }
  }

  const stopped = await waitUntilStopped(5000);
  clearPid();
  if (stopped) {
    console.log('服务已停止');
    console.log('');
    return true;
  }

  console.log('停止指令已发出，但端口仍在监听，请检查是否有残留进程');
  console.log('');
  return false;
}

/**
 * enable 用：未运行则后台拉起并打日志
 * @returns {Promise<void>}
 */
async function ensureServiceStarted() {
  const port = getServicePort();
  if (await isServiceRunning()) {
    console.log(`服务已在运行（端口 ${port}）`);
    console.log(`访问: http://localhost:${port}`);
    console.log('停止请用: ld-decrypt-tool stop');
    return;
  }
  console.log(`服务未运行，正在后台静默启动（端口 ${port}）...`);
  const result = startServiceSilent();
  if (!result.ok) {
    console.log('后台启动失败，请手动执行: ld-decrypt-tool start');
    return;
  }
  const ready = await waitUntilRunning(8000);
  if (ready) {
    console.log(`服务已后台启动，访问 http://localhost:${port}`);
    console.log('停止请用: ld-decrypt-tool stop');
  } else {
    console.log('已发起后台启动，但暂未探测到端口就绪，请稍后访问或执行: ld-decrypt-tool stop / start');
  }
}

module.exports = {
  PKG_ROOT,
  getServicePort,
  isServiceRunning,
  startServiceSilent,
  startForeground,
  startBackground,
  stopService,
  ensureServiceStarted
};
