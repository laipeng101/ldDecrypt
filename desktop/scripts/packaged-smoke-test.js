#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let passed = 0;
let failed = 0;

function assert(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(action, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error(`等待超时: ${timeoutMs}ms`);
}

function readReport(reportPath) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return null;
  }
}

function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', reject);
  });
}

async function main() {
  const executablePath = path.resolve(process.argv[2] || '');
  assert('executable path provided', Boolean(executablePath) && fs.existsSync(executablePath), executablePath);
  if (!fs.existsSync(executablePath)) {
    console.log(`\n结果: PASS=${passed} FAIL=${failed}`);
    process.exit(1);
  }

  console.log('--- Packaged desktop integration smoke ---');
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-packaged-smoke-'));
  const reportPath = path.join(testRoot, 'report.json');
  const watchSource = path.join(testRoot, 'watch-source');
  const watchTarget = path.join(testRoot, 'watch-target');
  fs.mkdirSync(watchSource, { recursive: true });
  fs.mkdirSync(watchTarget, { recursive: true });

  const child = spawn(executablePath, [], {
    cwd: testRoot,
    env: {
      ...process.env,
      LDDECRYPT_DESKTOP_SMOKE: '1',
      LDDECRYPT_DESKTOP_SMOKE_REPORT: reportPath,
      LDDECRYPT_DESKTOP_SMOKE_CLOSE_DELAY_MS: '10000',
      MONITORED_PATH: watchSource,
      MONITORED_DECRYPT_PATH: watchTarget
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let report = null;
  try {
    report = await waitUntil(() => {
      const current = readReport(reportPath);
      return current && current.coreReady && current.port > 0 ? current : null;
    }, 30000);
  } catch (error) {
    child.kill();
    console.error('--- packaged app stdout ---');
    child.stdout?.pipe(process.stdout);
    console.error('--- packaged app stderr ---');
    child.stderr?.pipe(process.stderr);
    await sleep(1000);
    throw error;
  }
  const baseUrl = `http://127.0.0.1:${report.port}`;

  report = await waitUntil(() => {
    const current = readReport(reportPath);
    return current && current.windowLoaded ? current : null;
  }, 30000);

  report = await waitUntil(() => {
    const current = readReport(reportPath);
    return current && current.monitorLoaded ? current : null;
  }, 30000);

  assert('Core ready event', report.coreReady === true);
  assert('single Core ready event', report.coreReadyCount === 1, `count=${report.coreReadyCount}`);
  assert('Core binds localhost', report.host === '127.0.0.1' && report.port > 0, `${report.host}:${report.port}`);
  assert('runtime stays in userData/runtime', report.runtimeDataIsolated === true);
  assert('Root Renderer loaded', report.rootLoaded === true);
  assert('BrowserWindow loaded', report.windowLoaded === true);
  assert(
    'Monitor DOM navigation allowed',
    report.monitorNavigationAllowed === true,
    report.monitorUrl
  );
  assert(
    'Monitor Renderer loaded',
    report.monitorLoaded === true &&
      report.monitorUrl === `http://127.0.0.1:${report.port}/monitor`
  );
  assert('Monitor UI loaded', report.monitorTitle === '监控日志', report.monitorTitle);

  report = await waitUntil(() => {
    const current = readReport(reportPath);
    return current && current.externalNavigationBlocked ? current : null;
  }, 5000);
  assert(
    'External page navigation blocked',
    report.externalNavigationBlocked === true &&
      report.navigationAllowed === false &&
      report.navigationUrl === 'https://example.invalid/',
    report.navigationUrl
  );

  report = await waitUntil(() => {
    const current = readReport(reportPath);
    return current && current.cspApplied ? current : null;
  }, 5000);
  assert('CSP applied to main frame', report.cspApplied === true);

  const response = await fetch(`${baseUrl}/`);
  assert('packaged Web UI responds', response.status === 200, `code=${response.status}`);

  const payload = Buffer.from('portable integration payload');
  const form = new FormData();
  form.append('file', new Blob([payload]), 'packaged-smoke.txt');
  const decryptResponse = await fetch(`${baseUrl}/api/decrypt`, {
    method: 'POST',
    body: form
  });
  const decrypted = Buffer.from(await decryptResponse.arrayBuffer());
  assert('Multer upload and decrypt pipeline', decryptResponse.ok && decrypted.equals(payload), `code=${decryptResponse.status}`);

  await fetch(`${baseUrl}/api/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceDir: watchSource,
      targetDir: watchTarget
    })
  });

  const watchedFile = path.join(watchSource, 'watched.txt');
  const watchedTarget = path.join(watchTarget, 'watched.txt');
  fs.writeFileSync(watchedFile, payload);
  await waitUntil(() => fs.existsSync(watchedTarget), 15000);
  assert('watcher processes file', fs.readFileSync(watchedTarget).equals(payload));

  assert(
    'graceful lifecycle completed',
    await waitUntil(() => {
      const current = readReport(reportPath);
      return current && current.gracefulShutdown === true &&
        current.coreStopped === true && current.coreExited === true;
    }, 12000).then(() => true).catch(() => false)
  );
  assert('no fallback kill', report.fallbackKillUsed === false && readReport(reportPath).fallbackKillUsed === false);

  const exit = await waitForProcess(child);
  assert('Electron exits cleanly', exit.code === 0 && exit.signal === null, `code=${exit.code}`);

  await waitUntil(async () => {
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(1000) });
      return false;
    } catch {
      return true;
    }
  }, 5000);
  assert('dynamic port released', true, report.port);

  fs.rmSync(testRoot, { recursive: true, force: true });
  console.log(`\n结果: PASS=${passed} FAIL=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`packaged smoke-test 异常: ${error.message || error}`);
  process.exit(1);
});
