const express = require('express');
const path = require('path');
const multer = require('multer');
const chokidar = require('chokidar');
const fs = require('fs');
const { decryptFile, decryptDirectory } = require('./lib/decrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// 全局错误处理中间件，确保API错误返回JSON格式
app.use((err, req, res, next) => {
  if (req.path.startsWith('/api/')) {
    // API请求返回JSON错误
    res.status(500).json({ error: err.message || '服务器内部错误' });
  } else {
    // 非API请求使用默认错误处理
    next(err);
  }
});

// 配置模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 静态文件服务
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 配置multer用于文件上传
const upload = multer({ dest: 'uploads/' });

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
    sourceDir: process.env.MONITORED_PATH || 'D:/fileWatch',
    targetDir: process.env.MONITORED_DECRYPT_PATH || 'D:/fileWatch_解密'
  });
});

// API解密端点
app.post('/api/decrypt', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未提供文件' });
    }

    const inputFile = req.file.path;
    const outputFile = path.join('decrypted', path.basename(req.file.originalname));
    
    // 确保输出目录存在
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await decryptFile(inputFile, outputFile);
    addLog(`API解密完成: ${req.file.originalname} -> ${outputFile}`);

    // 返回解密后的文件
    res.download(outputFile, (err) => {
      if (err) {
        addLog(`下载文件出错: ${err.message}`);
      }
      
      // 清理临时文件
      fs.unlinkSync(req.file.path);
      if (req.body.deleteFlag !== '0') {
        fs.unlinkSync(outputFile);
      }
    });
  } catch (error) {
    addLog(`API解密失败: ${error.message}`);
    res.status(500).json({ error: error.message });
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

// 启动服务器
const server = app.listen(PORT, () => {
  addLog(`服务器运行在端口 ${PORT}`);
});

// 目录监控功能
const watchedDirs = new Map();

function watchDirectory(sourceDir, targetDir) {
  // 确保源目录存在，如果不存在则创建
  if (!fs.existsSync(sourceDir)) {
    fs.mkdirSync(sourceDir, { recursive: true });
    addLog(`已创建源目录: ${sourceDir}`);
  }
  
  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
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

// 如果提供了环境变量，则启动目录监控
const monitoredPath = process.env.MONITORED_PATH || 'D:/fileWatch';
const monitoredDecryptPath = process.env.MONITORED_DECRYPT_PATH || 'D:/fileWatch_解密';
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

// 导出函数供CLI使用
module.exports = { app, server, watchDirectory, addLog };