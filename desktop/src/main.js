const {
  app,
  BrowserWindow,
  dialog,
  session,
  utilityProcess
} = require('electron');
const fs = require('fs');
const path = require('path');
const { isAllowedNavigation } = require('./navigation-policy');

let mainWindow = null;
let coreChild = null;
let isShuttingDown = false;
let shutdownPromise = null;
let pendingSecondInstanceFocus = false;
let allowedOrigin = null;
let smokeCloseTimer = null;
const smokeEnabled = process.env.LDDECRYPT_DESKTOP_SMOKE === '1';
const smokeCloseDelayMs = Number.parseInt(
  process.env.LDDECRYPT_DESKTOP_SMOKE_CLOSE_DELAY_MS || '1000',
  10
);
const smokeReportPath = process.env.LDDECRYPT_DESKTOP_SMOKE_REPORT;
const smokeState = {
  coreReady: false,
  coreReadyCount: 0,
  host: null,
  port: null,
  windowLoaded: false,
  gracefulShutdown: false,
  coreStopped: false,
  coreExited: false,
  fallbackKillUsed: false,
  runtimeDataIsolated: false,
  secondInstanceFocused: false,
  rootLoaded: false,
  monitorNavigationAllowed: false,
  monitorLoaded: false,
  externalNavigationBlocked: false,
  cspApplied: false
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    smokeState.secondInstanceFocused = true;
    recordSmoke();
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    } else {
      pendingSecondInstanceFocus = true;
    }
  });
}

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
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'src',
      'core-runner.js'
    );
  }

  return path.join(__dirname, 'core-runner.js');
}

function recordSmoke(update) {
  if (!smokeEnabled || !smokeReportPath) {
    return;
  }

  Object.assign(smokeState, update || {});
  fs.writeFileSync(smokeReportPath, JSON.stringify(smokeState));
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
    smokeState.coreReadyCount += 1;
    allowedOrigin = `http://127.0.0.1:${message.port}`;
    recordSmoke({
      coreReady: true,
      host: '127.0.0.1',
      port: message.port,
      runtimeDataIsolated: true
    });
    createMainWindow(message.port);
    return;
  }

  if (message.type === 'stopped') {
    recordSmoke({ coreStopped: true });
    return;
  }

  if (message.type === 'fatal') {
    recordSmoke({ fatalMessage: message.message || 'Core fatal' });
    showError(message.message);
    isShuttingDown = true;
    stopCore().finally(() => {
      app.quit();
    });
  }
}

function installContentSecurityPolicy() {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    let responseUrl;

    try {
      responseUrl = new URL(details.url);
    } catch {
      callback({ responseHeaders: details.responseHeaders || {} });
      return;
    }

    let responseHeaders = details.responseHeaders || {};
    if (
      details.resourceType === 'mainFrame' &&
      responseUrl.origin === allowedOrigin
    ) {
      responseHeaders = {
        ...responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer']
      };

      if (smokeEnabled) {
        smokeState.cspApplied = true;
        recordSmoke();
      }
    }

    callback({ responseHeaders });
  });
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'ldDecrypt',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.on('will-navigate', (details) => {
    const navigationAllowed = isAllowedNavigation(details.url, allowedOrigin);

    if (smokeEnabled) {
      recordSmoke({
        navigationUrl: details.url,
        navigationAllowed
      });
    }

    if (!navigationAllowed) {
      smokeState.externalNavigationBlocked = true;
      recordSmoke();
      if (smokeEnabled && smokeCloseTimer === null) {
        smokeCloseTimer = setTimeout(() => {
          mainWindow?.close();
        }, smokeCloseDelayMs);
      }
      details.preventDefault();
    }
  });

  mainWindow.webContents.on('will-redirect', (details) => {
    if (!isAllowedNavigation(details.url, allowedOrigin)) {
      details.preventDefault();
    }
  });

  mainWindow.webContents.on('did-fail-load', (
    _event,
    errorCode,
    errorDescription,
    validatedURL,
    isMainFrame
  ) => {
    if (!isMainFrame || errorCode === -3 || isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    showError(`主页面加载失败 (${errorCode}): ${errorDescription}\n${validatedURL}`);
    stopCore().finally(() => {
      app.quit();
    });
  });

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    if (pendingSecondInstanceFocus) {
      pendingSecondInstanceFocus = false;
      mainWindow.focus();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    recordSmoke({ windowLoaded: true });

    if (!smokeEnabled) {
      return;
    }

    const currentUrl = mainWindow.webContents.getURL();
    if (new URL(currentUrl).pathname !== '/monitor') {
      recordSmoke({ rootLoaded: true });
      mainWindow.webContents
        .executeJavaScript(
          `(() => {
             const monitorLink = document.querySelector('a[href="/monitor"]');
             if (!monitorLink) {
               throw new Error('Monitor link not found');
             }
             monitorLink.click();
           })();`
        )
        .catch((error) => {
          recordSmoke({ smokeError: error.message });
        });
      return;
    }

    mainWindow.webContents
      .executeJavaScript('document.title')
      .then((monitorTitle) => {
        recordSmoke({
          monitorNavigationAllowed: true,
          monitorLoaded: true,
          monitorUrl: currentUrl,
          monitorTitle
        });

        mainWindow.webContents
          .executeJavaScript(
            `(() => {
               const externalLink = document.createElement('a');
               externalLink.href = 'https://example.invalid/';
               document.body.appendChild(externalLink);
               externalLink.click();
               externalLink.remove();
             })();`
          )
          .catch((error) => {
            recordSmoke({ smokeError: error.message });
          });
      })
      .catch((error) => {
        recordSmoke({ smokeError: error.message });
      });
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
  recordSmoke({ runtimeDataIsolated: runtimeDir === path.join(app.getPath('userData'), 'runtime') });

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
    recordSmoke({ coreExited: true, unexpectedCoreExit: !isShuttingDown });

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
        smokeState.fallbackKillUsed = true;
        child.kill();
        resolve();
      }, 5000);

      recordSmoke({ gracefulShutdown: true });

      child.once('exit', () => {
        clearTimeout(timeout);
        coreChild = null;
        recordSmoke({ coreExited: true });
        resolve();
      });

      child.postMessage({ type: 'shutdown' });
    });
  }

  return shutdownPromise;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  installContentSecurityPolicy();

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

app.on('will-quit', () => {
  recordSmoke();
});
