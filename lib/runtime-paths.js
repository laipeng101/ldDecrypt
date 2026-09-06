/**
 * 运行期数据路径解析。
 * 程序资源必须从包根读取，可写数据必须由调用方通过环境变量隔离。
 */

const path = require('path');

/**
 * 运行期数据根目录
 * @returns {string}
 */
function getDataRoot() {
  return process.env.LDDECRYPT_DATA_DIR
    ? path.resolve(process.env.LDDECRYPT_DATA_DIR)
    : process.cwd();
}

/**
 * 上传临时文件目录
 * @returns {string}
 */
function getUploadDir() {
  return path.join(getDataRoot(), 'uploads');
}

/**
 * 解密输出目录
 * @returns {string}
 */
function getDecryptedDir() {
  return path.join(getDataRoot(), 'decrypted');
}

module.exports = {
  getDataRoot,
  getUploadDir,
  getDecryptedDir
};
