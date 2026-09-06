#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { isAllowedNavigation } = require('../src/navigation-policy');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_ENTRY = path.join(ROOT, 'index.js');

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

function assertNavigationPolicy() {
  const allowedOrigin = 'http://127.0.0.1:41255';
  assert(
    'Navigation policy allows exact same origin',
    isAllowedNavigation(`${allowedOrigin}/monitor`, allowedOrigin)
  );
  assert(
    'Navigation policy blocks different loopback port',
    !isAllowedNavigation('http://127.0.0.1:41256/monitor', allowedOrigin)
  );
  assert(
    'Navigation policy blocks different host',
    !isAllowedNavigation('http://localhost:41255/monitor', allowedOrigin)
  );
  assert(
    'Navigation policy blocks HTTPS origin',
    !isAllowedNavigation('https://127.0.0.1:41255/monitor', allowedOrigin)
  );
  assert(
    'Navigation policy blocks file URL',
    !isAllowedNavigation('file:///C:/monitor.html', allowedOrigin)
  );
}

function getHttpCode(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 3000 }, (response) => {
      response.resume();
      resolve(response.statusCode || 0);
    });
    request.on('error', () => resolve(0));
    request.on('timeout', () => {
      request.destroy();
      resolve(0);
    });
  });
}

async function main() {
  console.log('--- Electron desktop integration smoke ---');

  const packageJson = require(path.join(__dirname, '..', 'package.json'));
  assert('desktop package is private', packageJson.private === true);
  assert('Electron version is exact', packageJson.devDependencies.electron === '44.2.0');
  assert('Core entry is repo root', fs.existsSync(CORE_ENTRY));
  assertNavigationPolicy();

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-desktop-smoke-'));
  process.env.HOST = '127.0.0.1';
  process.env.PORT = '0';
  process.env.LDDECRYPT_DATA_DIR = runtimeDir;

  const core = require(CORE_ENTRY);
  if (!core.server.listening) {
    await new Promise((resolve) => core.server.once('listening', resolve));
  }

  const address = core.server.address();
  const httpCode = await getHttpCode(`http://127.0.0.1:${address.port}/`);
  assert('Core uses ephemeral port', address.address === '127.0.0.1' && address.port > 0);
  assert('Web UI responds', httpCode === 200, `code=${httpCode}`);
  assert('uploads stay in runtime dir', fs.existsSync(path.join(runtimeDir, 'uploads')));

  await core.shutdown();
  const closedCode = await getHttpCode(`http://127.0.0.1:${address.port}/`);
  assert('Core server closes', core.server.listening === false && closedCode === 0);
  assert('runtime data dir is isolated', runtimeDir.startsWith(path.join(os.tmpdir(), 'ld-desktop-smoke-')));

  console.log(`\n结果: PASS=${passed} FAIL=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`desktop smoke-test 异常: ${error.message || error}`);
  process.exit(1);
});
