import { chromium } from 'playwright';

import { createCtripPageSession } from './ctrip-page.js';
import {
  launchVisibleChromiumInBackground,
} from './macos-focus.js';
import {
  isEligibleOutbound,
  isEligibleReturn,
  rankItineraries,
  selectOutboundCandidates,
} from './itinerary.js';

// 只有任务明确关闭无头模式时才显示浏览器，其他调用保持现有默认行为。
export function headlessFromEnvironment(environment = process.env) {
  return environment.FLIGHT_MONITOR_HEADLESS !== 'false';
}

// 根据查询条件构造携程往返航班页面地址。
export function buildSearchUrl(query) {
  const route = `${query.from.toLowerCase()}-${query.to.toLowerCase()}`;
  return `https://flights.ctrip.com/online/list/round-${route}`
    + `?depdate=${query.depart_date}_${query.return_date}`
    + '&cabin=Y_S_C_F&adult=1&child=0&infant=0';
}

// 当前 Mac 的可见模式从启动开始置于后台；其余模式沿用 Playwright 启动。
export async function launchBrowserForCollection({
  headless,
  platform = process.platform,
} = {}) {
  if (!headless && platform === 'darwin') {
    return launchVisibleChromiumInBackground();
  }
  return chromium.launch({ headless });
}

function normalizedError(error, date) {
  return {
    date,
    stage: error?.stage ?? 'outbound_list',
    code: error?.code ?? 'unexpected',
    message: error instanceof Error ? error.message : String(error),
  };
}

function publicLeg({ signature, price, ...leg }) {
  return leg;
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

// 顺序扫描两个去程日期；单日失败不丢弃另一日期已经完成的有效组合。
export async function collectItineraries({
  queries,
  session,
  timeoutMs = 600_000,
  logger = () => {},
  now = Date.now,
}) {
  const scans = [];
  const combinations = [];
  const errors = [];
  const deadline = Date.now() + timeoutMs;
  const runStartedAt = now();

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    const dateStartedAt = now();
    try {
      const allOutbounds = await withinDeadline(
        session.listOutbounds(query),
        deadline,
      );
      const eligibleCount = allOutbounds.filter(isEligibleOutbound).length;
      const outbounds = selectOutboundCandidates(allOutbounds);
      logger(
        `[${query.depart_date}] 合格去程 ${eligibleCount}，选取 ${outbounds.length}`,
      );

      for (let index = 0; index < outbounds.length; index += 1) {
        const outbound = outbounds[index];
        logger(
          `[${query.depart_date}] 候选 ${index + 1}/${outbounds.length} `
          + `${outbound.flight_no} ${outbound.departure_time}→${outbound.arrival_time}`,
        );
        const returns = (await withinDeadline(
          session.listReturns(query, outbound),
          deadline,
        )).filter(isEligibleReturn);
        let accepted = 0;
        for (const returnLeg of returns) {
          if (!returnLeg.price) continue;
          combinations.push({
            ...returnLeg.price,
            outbound: publicLeg(outbound),
            return: publicLeg(returnLeg),
          });
          accepted += 1;
        }
        logger(
          `[${query.depart_date}] ${outbound.flight_no} 有效返程 ${accepted}，`
          + `累计组合 ${combinations.length}`,
        );
      }
      scans.push({ date: query.depart_date, status: 'completed' });
      logger(
        `[${query.depart_date}] 日期完成，耗时 ${now() - dateStartedAt}ms`,
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

  logger(`整轮完成，耗时 ${now() - runStartedAt}ms，累计组合 ${combinations.length}`);

  return {
    scans,
    itineraries: rankItineraries(combinations),
    errors,
  };
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
    return await collectItineraries({ queries, session, timeoutMs, logger });
  } finally {
    await browser.close();
  }
}
