const express = require('express');
const path = require('path');
const multer = require('multer');
const chokidar = require('chokidar');
const fs = require('fs');
const { decryptFile, decryptDirectory } = require('./lib/decrypt');
const { getDefaultWatchPaths } = require('./lib/default-paths');
const { getUploadDir, getDecryptedDir } = require('./lib/runtime-paths');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST;

// 默认监控路径：Windows 优先 D 盘，无 D 则用 C；可用环境变量覆盖
const defaultWatchPaths = getDefaultWatchPaths();

// 配置模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 静态程序资源固定从包根读取，不受运行 cwd 影响
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 配置multer用于文件上传
const uploadDir = getUploadDir();
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  // 单文件接口；为可选 deleteFlag 和额外表单字段留出余量，不限制文件大小。
  limits: {
    files: 1,
    fields: 4,
    parts: 5
  }
});

let logMessages = [];
let currentWatchers = [];
let watcherLogHeaders = new Map(); // 存储每个监控任务的日志头部信息

// 添加日志消息的函数
function addLog(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  logMessages.push(logEntry);
  console.log(logEntry);
  
  // 保持日志数量在合理范围内
  if (logMessages.length > 1000) {
    logMessages = logMessages.slice(-500);
  }
}

// 主页路由
app.get('/', (req, res) => {
  res.render('index', {
    sourceDir: defaultWatchPaths.sourceDir,
    targetDir: defaultWatchPaths.targetDir
  });
});

// API解密端点
app.post('/api/decrypt', upload.single('file'), async (req, res, next) => {
  let inputFile;
  let transferOutput;
  let requestError;

  try {
    if (!req.file) {
      return res.status(400).json({ error: '未提供文件' });
    }

    inputFile = req.file.path;
    const originalName = path.basename(req.file.originalname);
    const decryptedDir = getDecryptedDir();
    transferOutput = path.join(decryptedDir, `${req.file.filename}.transfer`);
    const retainedOutput = path.join(decryptedDir, originalName);
    
    // 确保输出目录存在
    fs.mkdirSync(decryptedDir, { recursive: true });

    await decryptFile(inputFile, transferOutput);
    if (req.body.deleteFlag === '0') {
      await fs.promises.copyFile(transferOutput, retainedOutput);
    }
    addLog(`API解密完成: ${req.file.originalname} -> ${transferOutput}`);

    // 返回解密后的文件；响应始终从请求独占的 transfer output 发送。
    await downloadFile(res, transferOutput, originalName);
  } catch (error) {
    addLog(`API解密失败: ${error.message}`);
    requestError = error;
  } finally {
    await removeFileIfPresent(inputFile, '上传临时文件');
    await removeFileIfPresent(transferOutput, '临时解密输出');
  }

  if (requestError) {
    return next(requestError);
  }
});

// 获取日志
app.get('/api/logs', (req, res) => {
  res.json({ logs: logMessages });
});

// 清空日志
app.post('/api/clear-logs', (req, res) => {
  logMessages = [];
  res.json({ message: '日志已清空' });
});

// 监控页面
app.get('/monitor', (req, res) => {
  res.render('monitor');
});

// 目录监控功能
const watchedDirs = new Map();

function watchDirectory(sourceDir, targetDir) {
  // 确保源目录存在，如果不存在则创建
  if (!fs.existsSync(sourceDir)) {
    try {
      fs.mkdirSync(sourceDir, { recursive: true });
      addLog(`已创建源目录: ${sourceDir}`);
    } catch (error) {
      addLog(`创建源目录失败: ${sourceDir}，原因: ${error.message}`);
      throw error;
    }
  }

  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (error) {
      addLog(`创建目标目录失败: ${targetDir}，原因: ${error.message}`);
      throw error;
    }
  }

  const watcher = chokidar.watch(sourceDir, {
    ignored: /(^|[\/\\])\../, // 忽略隐藏文件
    persistent: true
  });

  watcher
    .on('add', async (filePath) => {
      try {
        const relativePath = path.relative(sourceDir, filePath);
        const targetPath = path.join(targetDir, relativePath);
        
        // 确保目标文件的目录存在
        const targetDirName = path.dirname(targetPath);
        if (!fs.existsSync(targetDirName)) {
          fs.mkdirSync(targetDirName, { recursive: true });
        }
        
        await decryptFile(filePath, targetPath);
        
        // 检查是否已经输出过监控目录信息
        if (!watcherLogHeaders.has(sourceDir)) {
          addLog(`监控目录：${sourceDir}, 输出目录：${targetDir}`);
          watcherLogHeaders.set(sourceDir, true);
        }
        
        // 获取文件大小并转换为MB
        const stats = fs.statSync(filePath);
        const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        // 输出相对路径和文件大小(MB)
        addLog(`解密文件：${relativePath}, ${fileSizeInMB} MB`);
      } catch (error) {
        addLog(`监控解密失败: ${error.message}`);
      }
    })
    .on('error', error => {
      addLog(`监控出错: ${error.message}`);
    });

  watchedDirs.set(sourceDir, { watcher, targetDir });
  currentWatchers.push({ sourceDir, targetDir, watcher });
  addLog(`开始监控目录: ${sourceDir} -> ${targetDir}`);
}

// 启动默认目录监控（无环境变量时：Windows 有 D 用 D，否则用 C）
const monitoredPath = defaultWatchPaths.sourceDir;
const monitoredDecryptPath = defaultWatchPaths.targetDir;
if (defaultWatchPaths.drive) {
  addLog(`默认盘符: ${defaultWatchPaths.drive}（优先 D，无 D 则 C）`);
}
watchDirectory(monitoredPath, monitoredDecryptPath);

// 动态配置监控目录
app.post('/api/watch', (req, res) => {
  // 确保返回JSON格式的错误
  try {
    const { sourceDir, targetDir } = req.body;
    
    // 如果sourceDir或targetDir为空，则停止所有监控
    if (!sourceDir || !targetDir) {
      // 停止所有当前监控
      const closePromises = currentWatchers.map(watcherInfo => {
        return watcherInfo.watcher.close().then(() => {
          addLog(`停止监控目录: ${watcherInfo.sourceDir} -> ${watcherInfo.targetDir}`);
        }).catch(err => {
          addLog(`停止监控目录时出错: ${watcherInfo.sourceDir} -> ${watcherInfo.targetDir}, 错误: ${err.message}`);
        });
      });
      
      Promise.all(closePromises).then(() => {
        currentWatchers = [];
        res.json({ message: '已停止所有监控' });
      }).catch(err => {
        addLog(`停止监控时出现错误: ${err.message}`);
        res.status(500).json({ error: `停止监控时出现错误: ${err.message}` });
      });
      return;
    }
    
    // 停止所有当前监控
    const closePromises = currentWatchers.map(watcherInfo => {
      return watcherInfo.watcher.close().then(() => {
        addLog(`停止监控目录: ${watcherInfo.sourceDir} -> ${watcherInfo.targetDir}`);
      }).catch(err => {
        addLog(`停止监控目录时出错: ${watcherInfo.sourceDir} -> ${watcherInfo.targetDir}, 错误: ${err.message}`);
      });
    });
    
    Promise.all(closePromises).then(() => {
      currentWatchers = [];
      // 清除对应的日志头部标记
      watchedDirs.clear();
      watcherLogHeaders.clear();
      
      // 开始新的监控
      try {
        watchDirectory(sourceDir, targetDir);
        res.json({ message: `成功开始监控目录: ${sourceDir} -> ${targetDir}` });
      } catch (error) {
        addLog(`启动监控失败: ${error.message}`);
        res.status(500).json({ error: `启动监控失败: ${error.message}` });
      }
    }).catch(err => {
      addLog(`停止监控时出现错误: ${err.message}`);
      res.status(500).json({ error: `停止监控时出现错误: ${err.message}` });
    });
  } catch (error) {
    addLog(`配置监控目录过程中出现未捕获的错误: ${error.message}`);
    // 确保即使在catch块中也返回JSON
    if (!res.headersSent) {
      res.status(500).json({ error: `配置监控目录过程中出现错误: ${error.message}` });
    }
  }
});

// 获取当前监控配置
app.get('/api/watch', (req, res) => {
  const watchers = currentWatchers.map(item => ({
    sourceDir: item.sourceDir,
    targetDir: item.targetDir
  }));
  res.json({ watchers });
});

// API 错误处理中间件必须位于 body parser、路由和 Multer 之后。
app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    return next(err);
  }

  if (res.headersSent) {
    return next(err);
  }

  const status = Number(err.statusCode || err.status);
  const clientStatus = err instanceof multer.MulterError
    ? 400
    : (Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500);
  const message = err instanceof multer.MulterError
    ? `上传请求无效: ${err.message}`
    : (err.message || '服务器内部错误');
  addLog(`API错误: ${message}`);
  return res.status(clientStatus).json({ error: message });
});

// 所有路由和错误处理中间件注册完成后再启动 HTTP 服务。
const server = HOST
  ? app.listen(PORT, HOST, () => {
      addLog(`服务器运行在 http://${HOST}:${PORT}`);
    })
  : app.listen(PORT, () => {
      addLog(`服务器运行在端口 ${PORT}`);
    });

// 导出函数供CLI与宿主进程使用
let shutdownPromise = null;

/**
 * 停止 HTTP 服务并关闭监控，可被宿主进程复用
 * @returns {Promise<void>}
 */
function shutdown() {
  if (!shutdownPromise) {
    shutdownPromise = (async () => {
      const watchers = currentWatchers;
      currentWatchers = [];
      await Promise.allSettled(watchers.map(({ sourceDir, targetDir, watcher }) => {
        return watcher.close().catch((error) => {
          addLog(`停止监控目录时出错: ${sourceDir} -> ${targetDir}, 错误: ${error.message}`);
        });
      }));

      await new Promise((resolve) => {
        server.close(resolve);
      });

      watchedDirs.clear();
      watcherLogHeaders.clear();
    })();
    shutdownPromise.catch(() => {});
    shutdownPromise.finally(() => {
      shutdownPromise = null;
    });
  }

  return shutdownPromise;
}

/**
 * 尝试删除请求拥有的临时文件。
 * 不存在视为成功；其他错误记录日志但不向上抛出，避免清理失败影响 Core。
 * @param {string|undefined} filePath
 * @param {string} label
 * @returns {Promise<void>}
 */
async function removeFileIfPresent(filePath, label) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.rm(filePath, { force: true });
  } catch (error) {
    addLog(`清理${label}失败: ${filePath}，原因: ${error.message}`);
  }
}

/**
 * 等待 res.download() 完成，以便在响应传输结束后再清理临时文件。
 * @param {import('express').Response} res
 * @param {string} filePath
 * @param {string} downloadName
 * @returns {Promise<void>}
 */
function downloadFile(res, filePath, downloadName) {
  return new Promise((resolve, reject) => {
    res.download(filePath, downloadName, {
      headers: {
        'Cache-Control': 'no-store'
      }
    }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

module.exports = { app, server, watchDirectory, addLog, shutdown };
