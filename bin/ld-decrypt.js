#!/usr/bin/env node

const path = require('path');

// 启动Web服务器
console.log('');
console.log('===========================================');
console.log('  天锐绿盾文件解密工具');
console.log('===========================================');
console.log('');
console.log('正在启动服务...');
console.log('访问地址: http://localhost:3000');
console.log('按 Ctrl+C 停止服务');
console.log('');

// 设置环境变量
process.env.PORT = process.env.PORT || 3000;

// 启动主程序
require('../index.js');
