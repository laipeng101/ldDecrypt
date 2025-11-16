const express = require('express');
const path = require('path');
const multer = require('multer');
const chokidar = require('chokidar');
const fs = require('fs');
const { decryptFile, decryptDirectory } = require('./lib/decrypt');

const app = express();
const PORT = process.env.PORT || 3000;

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
  res.render('index');
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
        addLog(`监控解密完成: ${filePath} -> ${targetPath}`);
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
  const { sourceDir, targetDir } = req.body;
  
  if (!sourceDir || !targetDir) {
    return res.status(400).json({ error: '源目录和目标目录不能为空' });
  }
  
  // 停止所有当前监控
  currentWatchers.forEach(watcherInfo => {
    watcherInfo.watcher.close();
    addLog(`停止监控目录: ${watcherInfo.sourceDir} -> ${watcherInfo.targetDir}`);
  });
  currentWatchers = [];
  
  // 开始新的监控
  try {
    watchDirectory(sourceDir, targetDir);
    res.json({ message: `成功开始监控目录: ${sourceDir} -> ${targetDir}` });
  } catch (error) {
    addLog(`启动监控失败: ${error.message}`);
    res.status(500).json({ error: `启动监控失败: ${error.message}` });
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