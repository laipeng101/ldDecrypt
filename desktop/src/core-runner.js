function fail(message) {
  process.parentPort.postMessage({
    type: 'fatal',
    message: String(message && message.message ? message.message : message)
  });
}

async function stopCore(core) {
  await core.shutdown();
  process.parentPort.postMessage({ type: 'stopped' });
  process.exit(0);
}

try {
  const coreEntry = process.argv[2];
  if (!coreEntry) {
    throw new Error('缺少 Core 入口路径。');
  }

  const core = require(coreEntry);
  const { server } = core;
  if (!server) {
    throw new Error('Core 未导出 server。');
  }

  const announceReady = () => {
    const address = server.address();
    if (!address || typeof address !== 'object') {
      throw new Error('Core server 地址无效。');
    }

    if (address.address !== '127.0.0.1' || !(address.port > 0)) {
      throw new Error(`Core 必须监听 127.0.0.1，当前地址: ${address.address}:${address.port}`);
    }

    process.parentPort.postMessage({
      type: 'ready',
      port: address.port
    });
  };

  server.once('error', fail);

  if (server.listening) {
    announceReady();
  } else {
    server.once('listening', announceReady);
  }

  process.parentPort.on('message', (event) => {
    if (event && event.data && event.data.type === 'shutdown') {
      stopCore(core).catch(fail);
    }
  });
} catch (error) {
  fail(error);
}
