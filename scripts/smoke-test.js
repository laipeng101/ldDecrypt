#!/usr/bin/env node

/**
 * 本地冒烟测试（推仓库 / 发 npm 前跑）
 * Win / mac / Linux 均可：node scripts/smoke-test.js
 *
 * 覆盖：help / stop / start / 重复启动 / HTTP / unlock / stop
 * Windows 额外：enable/disable 是否可执行（不强制验证登录自启）
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ld-decrypt.js');
const UNLOCK = path.join(ROOT, 'bin', 'unlock.js');
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
    let packOut = '';
    try {
      packOut = execSync('npm pack --dry-run', {
        cwd: ROOT,
        encoding: 'utf8'
      });
    } catch (e) {
      packOut = `${e.stdout || ''}${e.stderr || ''}${e.message || ''}`;
    }
    // npm notice 走 stderr，一并拼上
    try {
      const r = spawnSync('npm', ['pack', '--dry-run'], {
        cwd: ROOT,
        encoding: 'utf8'
      });
      packOut = `${r.stdout || ''}${r.stderr || ''}`;
    } catch (_) {
      // 上面已有 fallback
    }
    assert('包含 lib/service.js', /lib\/service\.js/.test(packOut));
    assert('包含 lib/autostart.js', /lib\/autostart\.js/.test(packOut));
    assert('包含 lib/default-paths.js', /lib\/default-paths\.js/.test(packOut));
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
