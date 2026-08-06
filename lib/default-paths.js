/**
 * 解析默认监控根路径：Windows 优先 D 盘，没有则用 C 盘；非 Windows 用用户目录
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Windows 上选可用盘符：优先 D，其次 C
 * @returns {string} 如 'D:' / 'C:'
 */
function resolveWindowsDrive() {
  for (const letter of ['D', 'C']) {
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) {
        return `${letter}:`;
      }
    } catch (error) {
      // 盘符不可访问则试下一个
    }
  }
  // 极端情况仍回退 C:（后续 mkdir 失败会有明确日志）
  return 'C:';
}

/**
 * 默认监控源目录 / 解密输出目录
 * 环境变量 MONITORED_PATH / MONITORED_DECRYPT_PATH 优先
 * @returns {{ sourceDir: string, targetDir: string, drive: string|null }}
 */
function getDefaultWatchPaths() {
  if (process.env.MONITORED_PATH && process.env.MONITORED_DECRYPT_PATH) {
    return {
      sourceDir: process.env.MONITORED_PATH,
      targetDir: process.env.MONITORED_DECRYPT_PATH,
      drive: null
    };
  }

  if (process.platform === 'win32') {
    const drive = resolveWindowsDrive();
    const sourceDir = process.env.MONITORED_PATH || `${drive}/fileWatch`;
    const targetDir = process.env.MONITORED_DECRYPT_PATH || `${drive}/fileWatch_解密`;
    return { sourceDir, targetDir, drive };
  }

  // macOS / Linux：放用户主目录，避免写死 Windows 盘符
  const base = path.join(os.homedir(), 'fileWatch');
  return {
    sourceDir: process.env.MONITORED_PATH || base,
    targetDir: process.env.MONITORED_DECRYPT_PATH || `${base}_解密`,
    drive: null
  };
}

module.exports = {
  resolveWindowsDrive,
  getDefaultWatchPaths
};
