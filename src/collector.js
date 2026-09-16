import { chromium } from 'playwright';

import { createCtripPageSession } from './ctrip-page.js';
import {
  currentWifiSsid,
  launchAnonymousChromiumInBackground,
  launchVisibleChromiumInBackground,
} from './macos-focus.js';
import { rankReturnFlights } from './itinerary.js';

// 只有任务明确关闭无头模式时才显示浏览器，其他调用保持现有默认行为。
export function headlessFromEnvironment(environment = process.env) {
  return environment.FLIGHT_MONITOR_HEADLESS !== 'false';
}

// 根据查询条件构造携程单程航班页面地址。
export function buildSearchUrl(query) {
  const route = `${query.from.toLowerCase()}-${query.to.toLowerCase()}`;
  return `https://flights.ctrip.com/online/list/oneway-${route}`
    + `?depdate=${query.depart_date}`
    + '&cabin=Y_S_C_F&adult=1&child=0&infant=0';
}

// 当前 Mac 的可见模式从启动开始置于后台；其余模式沿用 Playwright 启动。
export async function launchBrowserForCollection({
  headless,
  platform = process.platform,
  getWifiSsid = currentWifiSsid,
  launchLoggedInBrowser = launchVisibleChromiumInBackground,
  launchAnonymousBrowser = launchAnonymousChromiumInBackground,
} = {}) {
  if (!headless && platform === 'darwin') {
    const ssid = await getWifiSsid({ platform });
    return ssid === 'gogogo'
      ? launchLoggedInBrowser()
      : launchAnonymousBrowser();
  }
  return chromium.launch({ headless });
}

function normalizedError(error, date) {
  return {
    date,
    stage: error?.stage ?? 'flight_list',
    code: error?.code ?? 'unexpected',
    message: error instanceof Error ? error.message : String(error),
  };
}

function deadlineError() {
  return Object.assign(new Error('整轮采集超过时间上限'), {
    code: 'run_timeout',
    stage: 'run_timeout',
  });
}

async function withinDeadline(promise, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw deadlineError();
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(deadlineError()), remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// 顺序扫描单程查询，保存所有满足返程规则的航班。
export async function collectReturnFlights({
  queries,
  session,
  timeoutMs = 600_000,
  logger = () => {},
  now = Date.now,
}) {
  const scans = [];
  const flights = [];
  const errors = [];
  const deadline = Date.now() + timeoutMs;
  const runStartedAt = now();

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    const dateStartedAt = now();
    try {
      const cards = await withinDeadline(session.listFlights(query), deadline);
      const accepted = rankReturnFlights(cards);
      flights.push(...accepted.map(({ rank, signature, ...flight }) => flight));
      scans.push({ date: query.depart_date, status: 'completed' });
      logger(
        `[${query.depart_date}] 航班卡片 ${cards.length}，合格返程 ${accepted.length}，`
        + `耗时 ${now() - dateStartedAt}ms`,
      );
    } catch (error) {
      const normalized = normalizedError(error, query.depart_date);
      scans.push({ date: query.depart_date, status: 'failed' });
      errors.push(normalized);
      logger(
        `[${query.depart_date}] 失败 ${normalized.stage}/${normalized.code}: `
        + normalized.message,
      );
      if (normalized.code === 'run_timeout') {
        for (const remainingQuery of queries.slice(queryIndex + 1)) {
          scans.push({ date: remainingQuery.depart_date, status: 'failed' });
        }
        break;
      }
    }
  }

  const ranked = rankReturnFlights(flights);
  logger(`整轮完成，耗时 ${now() - runStartedAt}ms，合格返程 ${ranked.length}`);
  return { scans, flights: ranked, errors };
}

// 启动当前环境的 Chromium，并确保成功、失败或超时后都关闭浏览器。
export async function collectFromCtrip({
  queries,
  artifactDir = 'artifacts',
  timeoutMs = 600_000,
  launchBrowser = launchBrowserForCollection,
  createSession = createCtripPageSession,
  logger = console.log,
  environment = process.env,
  platform = process.platform,
}) {
  const headless = headlessFromEnvironment(environment);
  const browser = await launchBrowser({ headless, platform });
  try {
    const page = await browser.newPage({
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const session = createSession({ page, buildSearchUrl, artifactDir });
    return await collectReturnFlights({ queries, session, timeoutMs, logger });
  } finally {
    await browser.close();
  }
}
