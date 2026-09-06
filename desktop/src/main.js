const {
  app,
  BrowserWindow,
  dialog,
  utilityProcess
} = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow = null;
let coreChild = null;
let isShuttingDown = false;
let shutdownPromise = null;

function getCoreRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'core');
  }

  return path.resolve(__dirname, '..', '..');
}

function getCoreEntry() {
  return path.join(getCoreRoot(), 'index.js');
}

function getRunnerEntry() {
  return path.join(__dirname, 'core-runner.js');
}

function getRuntimeDataDir() {
  return path.join(app.getPath('userData'), 'runtime');
}

function writeCoreLog(streamName, chunk, prefix) {
  const lines = String(chunk).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    streamName === 'stderr'
      ? console.error(`${prefix}${line}`)
      : console.log(`${prefix}${line}`);
  }
}

function handleCoreMessage(message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'ready' && !isShuttingDown) {
    createMainWindow(message.port);
    return;
  }

  if (message.type === 'fatal') {
    showError(message.message);
    isShuttingDown = true;
    stopCore().finally(() => {
      app.quit();
    });
  }
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'ldDecrypt',
    show: false
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

function showError(message) {
  const detail = message || '未知错误';
  dialog.showErrorBox('ldDecrypt 启动失败', detail);
}

function startCore() {
  const coreEntry = getCoreEntry();
  if (!fs.existsSync(coreEntry)) {
    showError(`找不到 Core 入口文件: ${coreEntry}`);
    app.quit();
    return;
  }

  const runtimeDir = getRuntimeDataDir();
  fs.mkdirSync(runtimeDir, { recursive: true });

  coreChild = utilityProcess.fork(
    getRunnerEntry(),
    [coreEntry],
    {
      cwd: getCoreRoot(),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        LDDECRYPT_DATA_DIR: runtimeDir
      },
      stdio: 'pipe',
      serviceName: 'ldDecrypt Core'
    }
  );

  coreChild.on('message', handleCoreMessage);

  coreChild.on('exit', () => {
    coreChild = null;

    if (!isShuttingDown) {
      isShuttingDown = true;
      showError('ldDecrypt Core 意外退出。');
      app.quit();
    }
  });

  coreChild.stdout.setEncoding('utf8');
  coreChild.stdout.on('data', (chunk) => {
    writeCoreLog('stdout', chunk, '[core] ');
  });

  coreChild.stderr.setEncoding('utf8');
  coreChild.stderr.on('data', (chunk) => {
    writeCoreLog('stderr', chunk, '[core:error] ');
  });
}

function stopCore() {
  if (!shutdownPromise) {
    shutdownPromise = new Promise((resolve) => {
      if (!coreChild) {
        resolve();
        return;
      }

      isShuttingDown = true;
      const child = coreChild;
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 5000);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      child.postMessage({ type: 'shutdown' });
    });
  }

  return shutdownPromise;
}

app.whenReady().then(() => {
  startCore();
});

app.on('window-all-closed', () => {
  stopCore().finally(() => {
    app.quit();
  });
});

app.on('before-quit', (event) => {
  if (!isShuttingDown) {
    event.preventDefault();
    stopCore().finally(() => {
      app.quit();
    });
  }
});
