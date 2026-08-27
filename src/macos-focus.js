import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
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

async function waitForDedicatedChromiumExit(profileDir, {
  run,
  sleep,
  attempts = 150,
}) {
  const processPattern = `--user-data-dir=${profileDir}`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await run('/usr/bin/pgrep', ['-f', '--', processPattern]);
    } catch (error) {
      if (error?.code === 1) return true;
      throw error;
    }
    await sleep(100);
  }
  return false;
}

// 只结束采集器专用配置对应的 Chromium，避免残留进程和旧端口污染下一轮。
async function cleanupDedicatedChromium(profileDir, {
  run,
  remove,
  sleep,
}) {
  const processPattern = `--user-data-dir=${profileDir}`;
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  try {
    try {
      await run('/usr/bin/pkill', [
        '-f',
        '--',
        processPattern,
      ]);
    } catch (error) {
      // pkill 退出码 1 表示没有匹配进程，是正常的空闲状态。
      if (error?.code !== 1) throw error;
    }
    if (!await waitForDedicatedChromiumExit(profileDir, { run, sleep })) {
      throw new Error('采集器专用 Chromium 清理后仍未退出');
    }
  } finally {
    await remove(portFile, { force: true });
  }
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
  remove = (file, options) => rm(file, options),
  sleep = delay,
} = {}) {
  if (platform !== 'darwin') return browserType.launch({ headless: false });

  await ensureProfileDir(profileDir);
  const cleanupProfile = () => cleanupDedicatedChromium(profileDir, {
    run,
    remove,
    sleep,
  });
  await cleanupProfile();
  const appBundle = applicationBundle(browserType.executablePath());
  let connectedBrowser;
  try {
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
    connectedBrowser = await browserType.connectOverCDP(
      `http://127.0.0.1:${port}`,
    );
    const context = connectedBrowser.contexts()[0];
    if (!context) {
      throw new Error('后台 Chromium 未提供持久浏览器上下文');
    }
    // 持久配置会恢复上次标签；每轮先清空，只留下本轮创建的采集页面。
    await Promise.all(
      context.pages().map((page) => page.close().catch(() => {})),
    );

    return {
      async newPage() {
        return context.newPage();
      },
      async close() {
        await Promise.all(
          context.pages().map((page) => page.close().catch(() => {})),
        );
        try {
          try {
            const cdpSession = await connectedBrowser.newBrowserCDPSession();
            await cdpSession.send('Browser.close');
          } catch {
            // CDP 可能在浏览器正常退出时先断开，最终以专用进程状态为准。
          } finally {
            await connectedBrowser.close().catch(() => {});
          }

          const exited = await waitForDedicatedChromiumExit(profileDir, {
            run,
            sleep,
          });
          if (!exited) await cleanupProfile();
        } finally {
          await remove(
            path.join(profileDir, 'DevToolsActivePort'),
            { force: true },
          );
        }
      },
    };
  } catch (error) {
    await connectedBrowser?.close().catch(() => {});
    await cleanupProfile().catch(() => {});
    throw error;
  }
}
