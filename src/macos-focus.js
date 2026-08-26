import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);

function applicationBundle(executablePath) {
  const match = /^(.*\.app)\/Contents\/MacOS\/.+$/.exec(executablePath);
  if (!match) {
    throw new Error(`无法从 Chromium 可执行文件定位 macOS 应用：${executablePath}`);
  }
  return match[1];
}

// 等待 Chromium 在独立用户目录中写出随机调试端口。
export async function waitForDevToolsPort(profileDir, {
  read = readFile,
  sleep = delay,
  timeoutMs = 15_000,
  now = Date.now,
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    try {
      const content = await read(path.join(profileDir, 'DevToolsActivePort'), 'utf8');
      const port = Number.parseInt(content.split(/\r?\n/, 1)[0], 10);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Chromium 仍在启动时文件尚不存在，继续等待即可。
    }
    await sleep(100);
  }
  throw new Error('后台 Chromium 未在 15 秒内提供调试端口');
}

// 用 Launch Services 在后台打开独立 Chromium，再交给 Playwright 控制。
export async function launchVisibleChromiumInBackground({
  browserType = chromium,
  platform = process.platform,
  run = execFileAsync,
  profileDir = path.join(
    homedir(),
    'Library/Application Support/flight-monitor/chromium-profile',
  ),
  ensureProfileDir = (directory) => mkdir(directory, { recursive: true }),
  waitForPort = waitForDevToolsPort,
} = {}) {
  if (platform !== 'darwin') return browserType.launch({ headless: false });

  await ensureProfileDir(profileDir);
  const appBundle = applicationBundle(browserType.executablePath());
  await run('open', [
    '-g',
    '-n',
    '-a',
    appBundle,
    '--args',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=zh-CN',
    'about:blank',
  ]);
  const port = await waitForPort(profileDir);
  const connectedBrowser = await browserType.connectOverCDP(
    `http://127.0.0.1:${port}`,
  );
  const context = connectedBrowser.contexts()[0];
  if (!context) {
    await connectedBrowser.close().catch(() => {});
    throw new Error('后台 Chromium 未提供持久浏览器上下文');
  }

  return {
    async newPage() {
      return context.newPage();
    },
    async close() {
      const cdpSession = await connectedBrowser.newBrowserCDPSession();
      await cdpSession.send('Browser.close');
      await connectedBrowser.close().catch(() => {});
    },
  };
}
