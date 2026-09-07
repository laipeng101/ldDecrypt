#!/usr/bin/env node

/**
 * 本地冒烟测试（推仓库 / 发 npm 前跑）
 * Win / mac / Linux 均可：node scripts/smoke-test.js
 *
 * 覆盖：help / stop / start / 重复启动 / HTTP / unlock / stop
 * Windows 额外：enable/disable 是否可执行（不强制验证登录自启）
 */

const { spawnSync, spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ld-decrypt.js');
const UNLOCK = path.join(ROOT, 'bin', 'unlock.js');
const INDEX = path.join(ROOT, 'index.js');
const IS_WIN = process.platform === 'win32';

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 */
function assert(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/**
 * 跑 CLI，返回 { code, out }
 * @param {string[]} args
 * @returns {{ code: number, out: string }}
 */
function runCli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env
  });
  return {
    code: r.status == null ? 1 : r.status,
    out: `${r.stdout || ''}${r.stderr || ''}`
  };
}

/**
 * HTTP GET 状态码
 * @param {string} url
 * @returns {Promise<number>}
 */
function httpCode(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
  });
}

/**
 * 取一个临时空闲端口
 * @returns {Promise<number>}
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * 等待 HTTP 可访问
 * @param {string} url
 * @returns {Promise<number>}
 */
async function waitForHttp(url) {
  for (let index = 0; index < 50; index += 1) {
    const code = await httpCode(url);
    if (code > 0) {
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return 0;
}

/**
 * 结束测试子进程
 * @param {import('child_process').ChildProcess} child
 * @returns {Promise<void>}
 */
function stopChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    child.once('exit', resolve);
    child.kill();
    setTimeout(() => {
      if (child.exitCode === null) {
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
          } else {
            child.kill('SIGKILL');
          }
        } catch (_) {
          // 进程已退出
        }
      }
    }, 3000).unref();
  });
}

/**
 * 通过 Web API 上传临时文件
 * @param {string} url
 * @param {string} content
 * @returns {Promise<Response>}
 */
async function uploadFile(url, content) {
  const form = new FormData();
  form.append('file', new Blob([content]), 'runtime-smoke.txt');
  const response = await fetch(url, { method: 'POST', body: form });
  await response.arrayBuffer();
  return response;
}

/**
 * Upload a payload and return both the response and downloaded bytes.
 * @param {string} url
 * @param {Buffer|string} content
 * @param {string} filename
 * @param {string|undefined} deleteFlag
 * @param {string} fieldName
 * @returns {Promise<{response: Response, body: Buffer}>}
 */
async function postMultipart(url, content, filename, deleteFlag, fieldName = 'file') {
  const form = new FormData();
  form.append(fieldName, new Blob([content]), filename);
  if (deleteFlag !== undefined) {
    form.append('deleteFlag', deleteFlag);
  }
  const response = await fetch(url, { method: 'POST', body: form });
  return {
    response,
    body: Buffer.from(await response.arrayBuffer())
  };
}

/**
 * @param {string} url
 * @param {string} body
 * @returns {Promise<{response: Response, body: Buffer}>}
 */
async function postJsonText(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  return {
    response,
    body: Buffer.from(await response.arrayBuffer())
  };
}

/**
 * @param {Response} response
 * @param {Buffer} body
 * @returns {boolean}
 */
function isJsonError(response, body) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    return false;
  }
  try {
    const errorBody = JSON.parse(body.toString('utf8'));
    return typeof errorBody.error === 'string' && errorBody.error.length > 0 && !('stack' in errorBody);
  } catch {
    return false;
  }
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
function regularFiles(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

/**
 * @param {() => boolean} predicate
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
async function waitForCondition(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

async function main() {
  console.log('===========================================');
  console.log('  ld-decrypt-tool 本地冒烟测试');
  console.log('===========================================');
  console.log(`平台: ${process.platform}`);
  console.log(`目录: ${ROOT}`);
  console.log('');

  // 先停干净
  runCli(['stop']);

  console.log('--- CLI ---');
  {
    const r = runCli(['help']);
    assert('help 退出码 0', r.code === 0);
    assert('help 含 start/stop', /start/.test(r.out) && /stop/.test(r.out));
  }

  {
    const r = runCli(['stop']);
    assert('stop(未运行) 提示无需停止', /无需停止|未在运行/.test(r.out), `code=${r.code}`);
  }

  {
    const r = runCli(['start']);
    assert('start 成功', r.code === 0 && /已后台启动|已在运行/.test(r.out));
  }

  {
    const r = runCli(['start']);
    assert('start 重复 → 跳过', /已在运行|跳过启动/.test(r.out));
  }

  {
    const r = runCli([]);
    assert('前台重复 → 提示已运行', /已在运行|无需重复/.test(r.out));
  }

  console.log('');
  console.log('--- HTTP ---');
  {
    const code = await httpCode('http://127.0.0.1:3000/');
    assert('首页 HTTP 200', code === 200, `code=${code}`);
  }

  console.log('');
  console.log('--- runtime isolation ---');
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-runtime-'));
  const defaultDir = path.join(runtimeDir, 'default');
  const isolatedDir = path.join(runtimeDir, 'isolated');
  const publicDir = path.join(ROOT, 'public');
  const staticFile = path.join(publicDir, `runtime-smoke-${path.basename(runtimeDir)}.txt`);
  let defaultCore = null;
  let isolatedCore = null;
  let hostCore = null;

  try {
    const defaultPort = await getFreePort();
    const isolatedPort = await getFreePort();
    const hostPort = await getFreePort();
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.mkdirSync(isolatedDir, { recursive: true });
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(staticFile, 'runtime-static-ok', 'utf8');

    const defaultEnv = { ...process.env, PORT: String(defaultPort) };
    delete defaultEnv.LDDECRYPT_DATA_DIR;
    delete defaultEnv.HOST;
    defaultCore = spawn(process.execPath, [INDEX], {
      cwd: defaultDir,
      env: defaultEnv,
      stdio: 'ignore'
    });
    const rootCode = await waitForHttp(`http://127.0.0.1:${defaultPort}/`);
    assert('alternate cwd 首页 HTTP 200', rootCode === 200, `code=${rootCode}`);
    const staticCode = await httpCode(`http://127.0.0.1:${defaultPort}/${path.basename(staticFile)}`);
    assert('static path 不依赖 cwd', staticCode === 200, `code=${staticCode}`);

    const defaultUpload = await uploadFile(`http://127.0.0.1:${defaultPort}/api/decrypt`, 'default-data-ok');
    assert('default upload HTTP 200', defaultUpload.ok, `code=${defaultUpload.status}`);
    assert('default uploads 在 cwd', fs.existsSync(path.join(defaultDir, 'uploads')));
    assert('default decrypted 在 cwd', fs.existsSync(path.join(defaultDir, 'decrypted')));
    await stopChild(defaultCore);
    defaultCore = null;
    const defaultClosed = await httpCode(`http://127.0.0.1:${defaultPort}/`);
    assert('default 端口释放', defaultClosed === 0, `code=${defaultClosed}`);

    isolatedCore = spawn(process.execPath, [INDEX], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(isolatedPort),
        LDDECRYPT_DATA_DIR: isolatedDir,
        MONITORED_PATH: path.join(isolatedDir, 'watch-source'),
        MONITORED_DECRYPT_PATH: path.join(isolatedDir, 'watch-target')
      },
      stdio: 'ignore'
    });
    const isolatedRootCode = await waitForHttp(`http://127.0.0.1:${isolatedPort}/`);
    assert('isolated 首页 HTTP 200', isolatedRootCode === 200, `code=${isolatedRootCode}`);
    const isolatedUpload = await uploadFile(`http://127.0.0.1:${isolatedPort}/api/decrypt`, 'isolated-data-ok');
    assert('isolated upload HTTP 200', isolatedUpload.ok, `code=${isolatedUpload.status}`);
    assert('isolated uploads 在 data dir', fs.existsSync(path.join(isolatedDir, 'uploads')));
    assert('isolated decrypted 在 data dir', fs.existsSync(path.join(isolatedDir, 'decrypted')));
    const isolatedUrl = `http://127.0.0.1:${isolatedPort}`;
    const isolatedUploadsDir = path.join(isolatedDir, 'uploads');
    const isolatedDecryptedDir = path.join(isolatedDir, 'decrypted');
    assert('默认解密请求清理上传临时文件', await waitForCondition(() => regularFiles(isolatedUploadsDir).length === 0));
    assert('默认解密请求清理传输临时文件', await waitForCondition(() => regularFiles(isolatedDecryptedDir).length === 0));

    console.log('--- decrypt API lifecycle ---');
    {
      const retainedPayload = Buffer.from('retained payload for deleteFlag=0');
      const retained = await postMultipart(
        `${isolatedUrl}/api/decrypt`,
        retainedPayload,
        'retained-sample.bin',
        '0'
      );
      const retainedDisposition = retained.response.headers.get('content-disposition') || '';
      const retainedPath = path.join(isolatedDecryptedDir, 'retained-sample.bin');
      assert('deleteFlag=0 HTTP 200', retained.response.status === 200);
      assert('deleteFlag=0 response payload', retained.body.equals(retainedPayload));
      assert('download filename 保持原文件名', /filename="?retained-sample\.bin"?/i.test(retainedDisposition), retainedDisposition);
      assert('deleteFlag=0 保留解密文件', fs.existsSync(retainedPath));
      assert('deleteFlag=0 保留内容正确', fs.existsSync(retainedPath) && fs.readFileSync(retainedPath).equals(retainedPayload));
      assert('deleteFlag=0 清理上传临时文件', await waitForCondition(() => regularFiles(isolatedUploadsDir).length === 0));
      assert('deleteFlag=0 仅保留指定文件', await waitForCondition(() => {
        const files = regularFiles(isolatedDecryptedDir);
        return files.length === 1 && files[0] === 'retained-sample.bin';
      }));
      assert('解密响应 Cache-Control no-store', retained.response.headers.get('cache-control') === 'no-store');

      const transientPayload = Buffer.from('same filename without retention');
      const transient = await postMultipart(`${isolatedUrl}/api/decrypt`, transientPayload, 'retained-sample.bin');
      assert('未提供 deleteFlag 的同名请求响应正确', transient.response.status === 200 && transient.body.equals(transientPayload));
      assert('同名默认请求清理上传临时文件', await waitForCondition(() => regularFiles(isolatedUploadsDir).length === 0));
      assert('同名默认请求不覆盖或删除已保留文件', await waitForCondition(() => {
        const files = regularFiles(isolatedDecryptedDir);
        return files.length === 1 && files[0] === 'retained-sample.bin' && fs.readFileSync(retainedPath).equals(retainedPayload);
      }));
      fs.rmSync(retainedPath, { force: true });
    }

    console.log('--- same-name concurrency ---');
    {
      const concurrentPayloads = Array.from({ length: 6 }, (_, index) => Buffer.alloc(128 * 1024 + index * 1024, index + 1));
      const concurrentResults = await Promise.allSettled(concurrentPayloads.map((payload) => postMultipart(
        `${isolatedUrl}/api/decrypt`,
        payload,
        'same-name.bin',
        '1'
      )));
      assert('same-name 并发请求全部成功', concurrentResults.every((result) => result.status === 'fulfilled' && result.value.response.status === 200));
      assert('same-name 并发响应保持隔离且无损坏', concurrentResults.every((result, index) => result.status === 'fulfilled' && result.value.body.equals(concurrentPayloads[index])));
      assert('same-name 并发下载名与 no-store 正确', concurrentResults.every((result) => result.status === 'fulfilled' &&
        /filename="?same-name\.bin"?/i.test(result.value.response.headers.get('content-disposition') || '') &&
        result.value.response.headers.get('cache-control') === 'no-store'));
      assert('same-name 并发后无上传临时文件', await waitForCondition(() => regularFiles(isolatedUploadsDir).length === 0));
      assert('same-name 并发后无传输临时文件', await waitForCondition(() => regularFiles(isolatedDecryptedDir).length === 0));
    }

    console.log('--- API error handling ---');
    {
      const malformed = await postJsonText(`${isolatedUrl}/api/watch`, '{');
      assert('malformed JSON 返回 HTTP 400', malformed.response.status === 400, `code=${malformed.response.status}`);
      assert('malformed JSON 返回 JSON error', isJsonError(malformed.response, malformed.body));

      const wrongField = await postMultipart(
        `${isolatedUrl}/api/decrypt`,
        'wrong multipart field',
        'wrong-field.bin',
        undefined,
        'wrongField'
      );
      assert('Multer 错误返回 HTTP 400', wrongField.response.status === 400, `code=${wrongField.response.status}`);
      assert('Multer 错误返回 JSON error', isJsonError(wrongField.response, wrongField.body));

      const limitedForm = new FormData();
      limitedForm.append('file', new Blob(['multipart structure limit']), 'limited.bin');
      for (let index = 0; index < 5; index += 1) {
        limitedForm.append(`extra${index}`, String(index));
      }
      const limitedResponse = await fetch(`${isolatedUrl}/api/decrypt`, {
        method: 'POST',
        body: limitedForm
      });
      const limitedBody = Buffer.from(await limitedResponse.arrayBuffer());
      assert('multipart 结构超限返回 HTTP 400', limitedResponse.status === 400, `code=${limitedResponse.status}`);
      assert('multipart 结构超限返回 JSON error', isJsonError(limitedResponse, limitedBody));

      assert('malformed JSON 后 Core 仍存活', await httpCode(`${isolatedUrl}/`) === 200);
      assert('上传错误后 Core 仍存活', await httpCode(`${isolatedUrl}/api/logs`) === 200);
      assert('错误请求不残留上传文件', await waitForCondition(() => regularFiles(isolatedUploadsDir).length === 0));
    }

    console.log('--- retained copy failure cleanup ---');
    {
      const blockedRetainedPath = path.join(isolatedDecryptedDir, 'blocked-retained.bin');
      fs.mkdirSync(blockedRetainedPath);
      try {
        const failedCopy = await postMultipart(`${isolatedUrl}/api/decrypt`, 'decrypted before copy failure', 'blocked-retained.bin', '0');
        assert('保留副本写入失败返回 HTTP 500 JSON', failedCopy.response.status === 500 && isJsonError(failedCopy.response, failedCopy.body));
        assert('保留副本失败清理上传临时文件', await waitForCondition(() => regularFiles(isolatedUploadsDir).length === 0));
        assert('保留副本失败清理已生成的解密明文', await waitForCondition(() => regularFiles(isolatedDecryptedDir).length === 0));
        assert('保留副本失败后 Core 仍存活', await httpCode(`${isolatedUrl}/`) === 200 && await httpCode(`${isolatedUrl}/api/logs`) === 200);
      } finally {
        fs.rmdirSync(blockedRetainedPath);
      }
    }

    console.log('--- failed decrypt cleanup ---');
    {
      await stopChild(isolatedCore);
      isolatedCore = null;
      const blockedDataRoot = path.join(runtimeDir, 'blocked-data');
      fs.mkdirSync(blockedDataRoot, { recursive: true });
      fs.writeFileSync(path.join(blockedDataRoot, 'decrypted'), 'not a directory');
      const blockedPort = await getFreePort();
      const blockedCore = spawn(process.execPath, [INDEX], {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: String(blockedPort),
          LDDECRYPT_DATA_DIR: blockedDataRoot,
          MONITORED_PATH: path.join(blockedDataRoot, 'watch-source'),
          MONITORED_DECRYPT_PATH: path.join(blockedDataRoot, 'watch-target')
        },
        stdio: 'ignore'
      });
      try {
        const blockedRoot = await waitForHttp(`http://127.0.0.1:${blockedPort}/`);
        assert('输出目录失败前 Core 可启动', blockedRoot === 200, `code=${blockedRoot}`);
        const failed = await postMultipart(`http://127.0.0.1:${blockedPort}/api/decrypt`, 'expected failure', 'failed.bin', '1');
        assert('输出目录失败返回 HTTP 500', failed.response.status === 500, `code=${failed.response.status}`);
        assert('失败请求返回 JSON', isJsonError(failed.response, failed.body));
        assert('失败请求清理上传临时文件', await waitForCondition(() => regularFiles(path.join(blockedDataRoot, 'uploads')).length === 0));
        assert('失败请求不修改输出目录占位文件', fs.readFileSync(path.join(blockedDataRoot, 'decrypted'), 'utf8') === 'not a directory');
        assert('失败请求后 Core 仍存活', await httpCode(`http://127.0.0.1:${blockedPort}/`) === 200 && await httpCode(`http://127.0.0.1:${blockedPort}/api/logs`) === 200);
      } finally {
        await stopChild(blockedCore);
      }
    }
    await stopChild(isolatedCore);
    isolatedCore = null;

    if (IS_WIN) {
      hostCore = spawn(process.execPath, [INDEX], {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: String(hostPort),
          HOST: '127.0.0.1',
          LDDECRYPT_DATA_DIR: isolatedDir
        },
        stdio: 'ignore'
      });
      const hostCode = await waitForHttp(`http://127.0.0.1:${hostPort}/`);
      assert('HOST loopback HTTP 200', hostCode === 200, `code=${hostCode}`);
      const addressResult = spawnSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `(Get-NetTCPConnection -LocalPort ${hostPort} -State Listen | Select-Object -First 1).LocalAddress`
      ], { encoding: 'utf8' });
      assert('HOST 监听 127.0.0.1', addressResult.status === 0 && addressResult.stdout.trim() === '127.0.0.1', addressResult.stdout.trim());
      await stopChild(hostCore);
      hostCore = null;
    }

    const shutdownHarness = path.join(runtimeDir, 'shutdown-harness.js');
    const shutdownPort = await getFreePort();
    fs.writeFileSync(shutdownHarness, [
      `process.env.PORT = ${shutdownPort};`,
      `process.env.LDDECRYPT_DATA_DIR = ${JSON.stringify(isolatedDir)};`,
      `const core = require(${JSON.stringify(INDEX)});`,
      '(async () => {',
      '  if (!core.server.listening) {',
      '    await new Promise((resolve) => core.server.once("listening", resolve));',
      '  }',
      '  const listeningBefore = core.server.listening;',
      '  await core.shutdown();',
      '  const listeningAfter = core.server.listening;',
      '  const watcherCount = process.getActiveResourcesInfo()',
      '    .filter((resource) => resource === "FSWatcher").length;',
      '  await core.shutdown();',
      '  console.log(JSON.stringify({ listeningBefore, listeningAfter, watcherCount }));',
      '})();'
    ].join('\n'), 'utf8');
    const shutdownResult = spawnSync(process.execPath, [shutdownHarness], {
      encoding: 'utf8',
      timeout: 10000
    });
    let shutdownInfo = {};
    try {
      shutdownInfo = JSON.parse(shutdownResult.stdout.trim().split(/\r?\n/).pop() || '{}');
    } catch (_) {
      // 解析失败时由下方断言报告
    }
    assert('shutdown 前服务运行', shutdownResult.status === 0 && shutdownInfo.listeningBefore === true);
    assert('shutdown 后 server 关闭', shutdownInfo.listeningAfter === false);
    assert('shutdown 后 watcher 关闭', shutdownInfo.watcherCount === 0);
    assert('shutdown 幂等', shutdownResult.status === 0);
  } finally {
    await stopChild(defaultCore);
    await stopChild(isolatedCore);
    await stopChild(hostCore);
    try {
      fs.rmSync(staticFile, { force: true });
    } catch (_) {
      // Windows 文件句柄可能稍有延迟
    }
    const cleanupRoot = path.resolve(runtimeDir);
    if (!cleanupRoot.startsWith(path.join(path.resolve(os.tmpdir()), 'ld-runtime-'))) {
      throw new Error(`拒绝清理测试目录以外的路径: ${cleanupRoot}`);
    }
    fs.rmSync(cleanupRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  console.log('');
  console.log('--- unlock ---');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-smoke-'));
    const src = path.join(dir, 'a.txt');
    const dest = path.join(dir, 'b.txt');
    fs.writeFileSync(src, 'smoke-ok', 'utf8');
    execSync(`"${process.execPath}" "${UNLOCK}" "${src}" "${dest}"`, {
      cwd: ROOT,
      stdio: 'ignore'
    });
    const body = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
    assert('unlock 写出内容', body === 'smoke-ok');
  }

  console.log('');
  console.log('--- stop ---');
  {
    const r = runCli(['stop']);
    assert('stop 成功', r.code === 0 && /已停止|无需停止/.test(r.out));
  }

  console.log('');
  console.log('--- 自启命令（平台相关）---');
  if (IS_WIN) {
    const en = runCli(['enable']);
    assert('enable 可执行', en.code === 0, en.out.split('\n').slice(0, 3).join(' | '));
    assert('enable 含运行检测日志', /已在运行|正在后台静默启动|已后台启动/.test(en.out));

    const st = runCli(['stop']);
    assert('enable 后可 stop', st.code === 0);

    const dis = runCli(['disable']);
    assert('disable 可执行', dis.code === 0 && /已关闭|开机自启已关闭/.test(dis.out));
    assert('disable 提示不清当前服务', /不会停止|ld-decrypt-tool stop/.test(dis.out));
  } else {
    const en = runCli(['enable']);
    assert('非 Windows enable 应失败提示', en.code !== 0 && /仅支持 Windows/.test(en.out));
    const dis = runCli(['disable']);
    assert('非 Windows disable 应失败提示', dis.code !== 0 && /仅支持 Windows/.test(dis.out));
  }

  console.log('');
  console.log('--- 打包内容 ---');
  {
    // 2>&1 合并 stderr（npm notice 走 stderr）；execSync 自带 shell，Windows 下可靠
    let packOut = '';
    try {
      packOut = execSync('npm pack --dry-run 2>&1', {
        cwd: ROOT,
        encoding: 'utf8'
      });
    } catch (e) {
      packOut = `${e.stderr || ''}${e.message || ''}`;
    }
    assert('包含 lib/service.js', /lib\/service\.js/.test(packOut));
    assert('包含 lib/autostart.js', /lib\/autostart\.js/.test(packOut));
    assert('包含 lib/default-paths.js', /lib\/default-paths\.js/.test(packOut));
    assert('包含 lib/runtime-paths.js', /lib\/runtime-paths\.js/.test(packOut));
    assert('包含 bin/ld-decrypt.js', /bin\/ld-decrypt\.js/.test(packOut));
  }

  // 收尾再停一次，避免残留
  runCli(['stop']);

  console.log('');
  console.log('===========================================');
  console.log(`  结果: PASS=${passed} FAIL=${failed}`);
  console.log('===========================================');
  if (failed > 0) {
    console.log('');
    console.log('存在失败项，请修复后再推远程 / 发 npm。');
    process.exit(1);
  }

  console.log('');
  console.log('冒烟通过。Windows 上若测全局命令，请再手动执行:');
  console.log('  npm run globalinstall');
  console.log('  where ld-decrypt-tool');
  console.log('  ld-decrypt-tool start');
  console.log('  ld-decrypt-tool stop');
  console.log('');
  console.log('确认无误后再: git push / npm run publish:npm');
  console.log('');
}

main().catch((err) => {
  console.error('冒烟测试异常:', err.message || err);
  process.exit(1);
});
