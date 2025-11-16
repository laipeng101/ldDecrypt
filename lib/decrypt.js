const fs = require('fs');
const path = require('path');

/**
 * 解密单个文件
 * @param {string} srcPath - 源文件路径
 * @param {string} destPath - 目标文件路径
 */
function decryptFile(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    try {
      // 确保目标目录存在
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const readStream = fs.createReadStream(srcPath, {
        highWaterMark: 16384
      });
      
      const writeStream = fs.createWriteStream(destPath);
      
      readStream.on('error', (error) => {
        reject(new Error(`读取文件 ${srcPath} 时发生错误: ${error.message}`));
      });
      
      writeStream.on('error', (error) => {
        reject(new Error(`写入文件 ${destPath} 时发生错误: ${error.message}`));
      });
      
      writeStream.on('close', () => {
        resolve();
      });
      
      readStream.pipe(writeStream);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 解密整个目录
 * @param {string} srcDir - 源目录路径
 * @param {string} destDir - 目标目录路径
 */
function decryptDirectory(srcDir, destDir) {
  return new Promise((resolve, reject) => {
    try {
      // 确保目标目录存在
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const items = fs.readdirSync(srcDir);
      
      const promises = items.map(item => {
        return new Promise((resolveItem, rejectItem) => {
          const itemPath = path.join(srcDir, item);
          const info = fs.statSync(itemPath);

          if (info.isDirectory() && item !== 'node_modules') {
            // 递归解密子目录
            decryptDirectory(
              itemPath,
              path.join(destDir, item)
            ).then(resolveItem).catch(rejectItem);
          } else if (info.isFile()) {
            // 解密文件
            decryptFile(
              itemPath,
              path.join(destDir, item)
            ).then(resolveItem).catch(rejectItem);
          } else {
            resolveItem(); // 对于其他类型，直接完成
          }
        });
      });

      Promise.all(promises).then(resolve).catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { decryptFile, decryptDirectory };