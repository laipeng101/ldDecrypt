#!/usr/bin/env node

/**
 * 手动开启开机自启（兼容旧用法）
 * 等价于：ld-decrypt-tool enable
 */

const autostart = require('../lib/autostart');

Promise.resolve(autostart.enable())
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error('enable 失败:', err.message || err);
    process.exit(1);
  });
