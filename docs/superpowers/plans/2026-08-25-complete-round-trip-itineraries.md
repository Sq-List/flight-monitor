# Complete Round-Trip Itineraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前携程“去程卡片往返起价”采集升级为包含具体去程、具体返程和明确组合起价的完整行程采集，并按组合起价统一排序。

**Architecture:** 保留 Playwright 和当前 Mac 可见 Chromium 路径，将实现拆成三层：`itinerary.js` 负责时间过滤、45 分钟中转边界、每日期前 5 个去程、校验和排序；`ctrip-page.js` 负责单页复用、到底即停、结构化字段、选择去程和诊断附件；`collector.js` 负责两个日期的顺序编排、进度日志和前台焦点恢复。`state.js` 单独负责 schema v2、状态和历史兼容；手动验证成功前不修改现有 LaunchAgent 和独立运行目录。

**Tech Stack:** Node.js 22+、ES modules、Playwright 1.62.1、`node:test`、JSON 状态文件、macOS LaunchAgent。

---

## 文件边界

- 新建 `src/itinerary.js`：纯函数；计算跨日时间、过滤去返程、中转等待、校验完整行程、排序前 5。
- 新建 `src/ctrip-page.js`：Playwright 页面适配；稳定加载卡片、结构化提取、选择去程、读取明确总价、保存诊断附件。
- 修改 `src/collector.js`：两个日期顺序采集、候选去程逐一进入返程页、验证码短路、10 分钟总超时。
- 保留 `src/parser.js` 不变：schema v1 解析器只供旧测试和历史说明使用；schema v2 页面采集不再调用它。
- 修改 `src/state.js`：生成 schema v2 `latest.json` 和混合版本 `history.json`，不把 v1 起价当作 v2 成功结果。
- 修改 `src/run.js`：持久化完整采集结果和 `partial` 状态。
- 修改 `src/cli.js`：传入 9 月 30 日和 10 月 1 日两个查询，运行 v2 采集。
- 修改 `README.md`：只描述最终生效后的完整行程口径；切换前不部署该文档和代码。
- 新建或修改对应 `tests/*.test.js` 和 `tests/fixtures/*.json`：纯函数、DOM、编排、状态与持久化测试。

本计划不执行提交、推送或替换运行目录。手动验证通过后，先向用户报告结果并取得明确授权，再执行发布。

### Task 1: 固化完整行程领域规则

**Files:**
- Create: `src/itinerary.js`
- Create: `tests/itinerary.test.js`

- [ ] **Step 1: 写时间窗口、中转边界和排序的失败测试**

创建 `tests/itinerary.test.js`，测试数据使用完整字段，避免测试绕过最终校验：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isEligibleOutbound,
  isEligibleReturn,
  isEligibleConnection,
  rankItineraries,
  validateCompleteItinerary,
} from '../src/itinerary.js';

function leg(overrides = {}) {
  return {
    date: '2026-10-01',
    airline: '南方航空',
    flight_no: 'CZ8416',
    departure_time: '19:20',
    departure_airport: '杭州萧山国际机场',
    arrival_time: '00:40+1',
    arrival_airport: '乌鲁木齐天山国际机场',
    direct: true,
    stops: [],
    ...overrides,
  };
}

function itinerary(overrides = {}) {
  return {
    total_price: 3830,
    price_text: '往返含税 ¥3830',
    currency: 'CNY',
    outbound: leg(),
    return: leg({
      date: '2026-10-08',
      flight_no: 'CZ6979',
      departure_time: '09:35',
      departure_airport: '乌鲁木齐天山国际机场',
      arrival_time: '14:30',
      arrival_airport: '杭州萧山国际机场',
    }),
    ...overrides,
  };
}

test('accepts both outbound lower bounds and rejects arrivals after next-day 01:00', () => {
  assert.equal(isEligibleOutbound(leg({ date: '2026-09-30', departure_time: '21:00' })), true);
  assert.equal(isEligibleOutbound(leg({ date: '2026-09-30', departure_time: '20:59' })), false);
  assert.equal(isEligibleOutbound(leg({ departure_time: '15:00', arrival_time: '01:00+1' })), true);
  assert.equal(isEligibleOutbound(leg({ departure_time: '14:59' })), false);
  assert.equal(isEligibleOutbound(leg({ arrival_time: '01:01+1' })), false);
});

test('accepts return arrival at 18:00 and rejects 18:01', () => {
  assert.equal(isEligibleReturn(leg({ date: '2026-10-08', arrival_time: '18:00' })), true);
  assert.equal(isEligibleReturn(leg({ date: '2026-10-08', arrival_time: '18:01' })), false);
});

test('keeps a 45-minute connection and rejects a 46-minute connection', () => {
  assert.equal(isEligibleConnection(leg({ direct: false, stops: [{ airport: '西安', wait_minutes: 45 }] })), true);
  assert.equal(isEligibleConnection(leg({ direct: false, stops: [{ airport: '西安', wait_minutes: 46 }] })), false);
  assert.equal(isEligibleConnection(leg({ direct: false, stops: [{ airport: '西安', wait_minutes: null }] })), false);
});

test('requires both legs and an explicit positive total price', () => {
  assert.equal(validateCompleteItinerary(itinerary()), true);
  assert.equal(validateCompleteItinerary(itinerary({ price_text: '加 ¥200' })), false);
  assert.equal(validateCompleteItinerary(itinerary({ return: { ...itinerary().return, flight_no: null } })), false);
});

test('sorts direct and connecting itineraries together by total price', () => {
  const connecting = itinerary({
    total_price: 3500,
    price_text: '往返含税 ¥3500',
    outbound: leg({ direct: false, stops: [{ airport: '西安', wait_minutes: 45 }] }),
  });
  const direct = itinerary({ total_price: 3600, price_text: '往返含税 ¥3600' });
  assert.deepEqual(rankItineraries([direct, connecting]).map((item) => item.total_price), [3500, 3600]);
});

test('breaks equal-price ties by outbound target time and then earlier return arrival', () => {
  const laterReturn = itinerary({ return: leg({
    date: '2026-10-08', flight_no: 'CZ6979', departure_time: '10:00',
    departure_airport: '乌鲁木齐天山国际机场', arrival_time: '16:00',
    arrival_airport: '杭州萧山国际机场',
  }) });
  const preferred = itinerary({
    outbound: leg({ departure_time: '18:00' }),
    return: leg({
      date: '2026-10-08', flight_no: 'GJ8968', departure_time: '07:30',
      departure_airport: '乌鲁木齐天山国际机场', arrival_time: '12:30',
      arrival_airport: '杭州萧山国际机场',
    }),
  });
  assert.equal(rankItineraries([laterReturn, preferred])[0].return.flight_no, 'GJ8968');
});
```

- [ ] **Step 2: 运行测试并确认缺少模块**

Run: `node --test tests/itinerary.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `src/itinerary.js`。

- [ ] **Step 3: 实现最小领域规则**

创建 `src/itinerary.js`：

```js
const OUTBOUND_WINDOWS = {
  '2026-09-30': { depart: '21:00', arrive: '01:00+1', preferred: '22:00' },
  '2026-10-01': { depart: '15:00', arrive: '01:00+1', preferred: '18:00' },
};

const EXPLICIT_TOTAL_RE = /往返(?:含税)?|往返总价|含税总价/;
const REQUIRED_LEG_FIELDS = [
  'date', 'airline', 'flight_no', 'departure_time', 'departure_airport',
  'arrival_time', 'arrival_airport',
];

function clockMinutes(value) {
  const match = /^(\d{2}):(\d{2})(\+1)?$/.exec(String(value ?? ''));
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]) + (match[3] ? 1440 : 0);
}

export function isEligibleConnection(leg) {
  if (leg?.direct === true) return true;
  return Array.isArray(leg?.stops)
    && leg.stops.length > 0
    && leg.stops.every((stop) => Number.isInteger(stop.wait_minutes)
      && stop.wait_minutes >= 0
      && stop.wait_minutes <= 45);
}

export function isEligibleOutbound(leg) {
  const window = OUTBOUND_WINDOWS[leg?.date];
  if (!window || !isEligibleConnection(leg)) return false;
  return clockMinutes(leg.departure_time) >= clockMinutes(window.depart)
    && clockMinutes(leg.arrival_time) <= clockMinutes(window.arrive);
}

export function isEligibleReturn(leg) {
  return leg?.date === '2026-10-08'
    && isEligibleConnection(leg)
    && clockMinutes(leg.arrival_time) <= clockMinutes('18:00');
}

function completeLeg(leg) {
  return REQUIRED_LEG_FIELDS.every((field) => typeof leg?.[field] === 'string' && leg[field])
    && typeof leg?.direct === 'boolean'
    && Array.isArray(leg?.stops);
}

export function validateCompleteItinerary(value) {
  return Number.isFinite(value?.total_price)
    && value.total_price > 0
    && value.currency === 'CNY'
    && typeof value.price_text === 'string'
    && EXPLICIT_TOTAL_RE.test(value.price_text)
    && completeLeg(value.outbound)
    && completeLeg(value.return)
    && isEligibleOutbound(value.outbound)
    && isEligibleReturn(value.return);
}

function preferredDistance(item) {
  const preferred = OUTBOUND_WINDOWS[item.outbound.date].preferred;
  return Math.abs(clockMinutes(item.outbound.departure_time) - clockMinutes(preferred));
}

export function rankItineraries(values, limit = 5) {
  return values
    .filter(validateCompleteItinerary)
    .sort((left, right) => left.total_price - right.total_price
      || preferredDistance(left) - preferredDistance(right)
      || clockMinutes(left.return.arrival_time) - clockMinutes(right.return.arrival_time)
      || left.outbound.flight_no.localeCompare(right.outbound.flight_no)
      || left.return.flight_no.localeCompare(right.return.flight_no))
    .slice(0, limit)
    .map((item, index) => ({ rank: index + 1, ...item }));
}
```

- [ ] **Step 4: 运行领域规则测试**

Run: `node --test tests/itinerary.test.js`

Expected: 6 tests PASS；45 分钟保留、46 分钟排除。

### Task 2: 建立结构化 DOM 与价格语义适配器

**Files:**
- Create: `src/ctrip-page.js`
- Create: `tests/ctrip-page.test.js`
- Create: `tests/fixtures/ctrip-roundtrip-cards.html`

- [ ] **Step 1: 创建真实页面形状的最小 HTML fixture**

创建 `tests/fixtures/ctrip-roundtrip-cards.html`：

```html
<section id="outbound">
  <article class="flight-item">
    <div class="airline-name">中国南方航空</div>
    <div class="flight-no">CZ8416</div>
    <div class="depart-box"><b class="time">19:20</b><span class="airport">杭州萧山国际机场T4</span></div>
    <div class="arrive-box"><b class="time">00:40</b><i class="day-offset">+1天</i><span class="airport">乌鲁木齐天山国际机场T3</span></div>
    <button>选为去程</button>
  </article>
</section>
<section id="return">
  <article class="flight-item">
    <div class="airline-name">长龙航空</div>
    <div class="flight-no">GJ8968</div>
    <div class="depart-box"><b class="time">07:30</b><span class="airport">乌鲁木齐天山国际机场T3</span></div>
    <div class="arrive-box"><b class="time">12:30</b><span class="airport">杭州萧山国际机场T3</span></div>
    <div class="price">往返含税 ¥3,538</div>
  </article>
  <article class="flight-item">
    <div class="airline-name">测试航空</div>
    <div class="flight-no">AB1234</div>
    <div class="depart-box"><b class="time">08:00</b><span class="airport">乌鲁木齐天山国际机场</span></div>
    <div class="transfer">中转 西安 等待45分钟</div>
    <div class="arrive-box"><b class="time">15:00</b><span class="airport">杭州萧山国际机场</span></div>
    <div class="price">加 ¥200</div>
  </article>
</section>
```

- [ ] **Step 2: 写 DOM 字段、跨日、中转和明确总价失败测试**

创建 `tests/ctrip-page.test.js`：

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

import { extractFlightCards, parseExplicitTotalPrice } from '../src/ctrip-page.js';

const html = await readFile(new URL('./fixtures/ctrip-roundtrip-cards.html', import.meta.url), 'utf8');

test('extracts airports structurally and keeps +1 only on arrival time', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  const cards = await extractFlightCards(page.locator('#outbound .flight-item'), '2026-10-01');
  assert.equal(cards[0].arrival_time, '00:40+1');
  assert.equal(cards[0].arrival_airport, '乌鲁木齐天山国际机场T3');
  assert.equal(cards[0].signature, 'CZ8416|19:20|00:40+1');
});

test('extracts a 45-minute transfer without treating it as direct', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  const cards = await extractFlightCards(page.locator('#return .flight-item'), '2026-10-08');
  assert.deepEqual(cards[0].price, {
    total_price: 3538, price_text: '往返含税 ¥3,538', currency: 'CNY',
  });
  assert.equal(cards[1].direct, false);
  assert.deepEqual(cards[1].stops, [{ airport: '西安', wait_minutes: 45 }]);
});

test('accepts only an explicitly labelled round-trip total', () => {
  assert.deepEqual(parseExplicitTotalPrice('往返含税 ¥3,538'), {
    total_price: 3538, price_text: '往返含税 ¥3,538', currency: 'CNY',
  });
  assert.equal(parseExplicitTotalPrice('加 ¥200'), null);
  assert.equal(parseExplicitTotalPrice('¥3538起'), null);
});
```

- [ ] **Step 3: 运行测试并确认缺少页面适配器**

Run: `node --test tests/ctrip-page.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `src/ctrip-page.js`。

- [ ] **Step 4: 实现结构化卡片和明确总价解析**

创建 `src/ctrip-page.js` 的纯解析部分。字段通过卡片内的语义 class 和相邻容器读取；`+1天` 只修改到达时间，不作为机场候选：

```js
import { mkdir, writeFile } from 'node:fs/promises';

const FLIGHT_RE = /\b[A-Z0-9]{2}\d{3,4}[A-Z]?\b/g;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseExplicitTotalPrice(text) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!/(往返(?:含税)?|往返总价|含税总价)/.test(normalized)) return null;
  const match = /¥\s*([\d,]+)/.exec(normalized);
  if (!match) return null;
  const totalPrice = Number(match[1].replaceAll(',', ''));
  return totalPrice > 0
    ? { total_price: totalPrice, price_text: normalized, currency: 'CNY' }
    : null;
}

export async function extractFlightCards(locator, date) {
  const snapshots = await locator.evaluateAll((cards) => cards.map((card) => {
    const text = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim();
    const ownText = (element) => [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => text(node)).join(' ').trim();
    const leafTexts = [...card.querySelectorAll('*')]
      .map((element) => ownText(element)).filter(Boolean);
    const timeElements = [...card.querySelectorAll('*')]
      .filter((element) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text(element)));
    const airportFor = (timeElement) => {
      const box = timeElement.closest('[class*="depart"], [class*="arrive"], [class*="time-box"]')
        || timeElement.parentElement;
      return [...(box?.querySelectorAll('*') || [])]
        .map((element) => text(element))
        .find((value) => /(机场|航站楼|T\d)/.test(value)
          && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
          && !/^\+1天$/.test(value)) || null;
    };
    return {
      fullText: text(card),
      airline: text(card.querySelector('[class*="airline-name"], [class*="airline"]')) || leafTexts[0] || null,
      flightNos: text(card).match(/\b[A-Z0-9]{2}\d{3,4}[A-Z]?\b/g) || [],
      times: timeElements.slice(0, 2).map((element) => text(element)),
      airports: timeElements.slice(0, 2).map(airportFor),
      arrivalNextDay: /\+1天/.test(text(timeElements[1]?.parentElement)),
      priceText: text(card.querySelector('[class*="price"]'))
        || leafTexts.find((value) => /(往返(?:含税)?|往返总价|含税总价)/.test(value))
        || null,
    };
  }));

  return snapshots.map((snapshot) => {
    const transfer = /(?:中转|经停)\s*([^\s，,]+).*?(\d+)\s*分钟/.exec(snapshot.fullText);
    const flightNo = snapshot.flightNos.join('/');
    const departureTime = TIME_RE.test(snapshot.times[0]) ? snapshot.times[0] : null;
    const arrivalClock = TIME_RE.test(snapshot.times[1]) ? snapshot.times[1] : null;
    const arrivalTime = arrivalClock && snapshot.arrivalNextDay ? `${arrivalClock}+1` : arrivalClock;
    const direct = !/(中转|经停)/.test(snapshot.fullText);
    return {
      date,
      airline: snapshot.airline,
      flight_no: flightNo || null,
      departure_time: departureTime,
      departure_airport: snapshot.airports[0],
      arrival_time: arrivalTime,
      arrival_airport: snapshot.airports[1],
      direct,
      stops: direct ? [] : [{
        airport: transfer?.[1] ?? null,
        wait_minutes: transfer ? Number(transfer[2]) : null,
      }],
      signature: [flightNo || snapshot.airline, departureTime, arrivalTime].join('|'),
      price: parseExplicitTotalPrice(snapshot.priceText),
    };
  });
}
```

- [ ] **Step 5: 运行页面纯解析测试**

Run: `node --test tests/ctrip-page.test.js`

Expected: 3 tests PASS；到达机场不是 `+1天`，`加 ¥200` 和 `¥3538起` 均不被接受。

### Task 3: 实现真实页面导航、稳定加载与诊断附件

**Files:**
- Modify: `src/ctrip-page.js`
- Modify: `tests/ctrip-page.test.js`
- Modify: `tests/collector.test.js`

- [ ] **Step 1: 增加页面状态和稳定签名测试**

在 `tests/ctrip-page.test.js` 增加：

```js
import { classifyCtripPage, safeArtifactName } from '../src/ctrip-page.js';

test('classifies captcha before apparently rendered content', () => {
  assert.equal(classifyCtripPage({ url: 'https://flights.ctrip.com/captcha', bodyText: '安全验证', cardCount: 2 }), 'captcha');
});

test('creates an artifact name without URL or credential data', () => {
  assert.equal(
    safeArtifactName('2026-10-01', 'CZ8416|19:20|00:40+1', 'return_list'),
    '2026-10-01-CZ8416-19-20-00-40-1-return_list',
  );
});
```

在 `tests/collector.test.js` 删除对旧 `classifyPageState` 和 `extractCardChunks` 的断言，只保留 `buildSearchUrl`、`headlessFromEnvironment`；页面字段测试已经迁移到 `ctrip-page.test.js`。

- [ ] **Step 2: 运行相关测试确认导出不存在**

Run: `node --test tests/ctrip-page.test.js tests/collector.test.js`

Expected: FAIL，错误指出 `classifyCtripPage` 或 `safeArtifactName` 未导出。

- [ ] **Step 3: 补齐页面会话接口**

在 `src/ctrip-page.js` 追加以下接口，并复用 Task 2 的 `extractFlightCards`：

```js
export function classifyCtripPage({ url, bodyText, cardCount }) {
  if (url.includes('captcha') || /验证码|安全验证|访问频繁|whaleguard\s+block/i.test(bodyText)) return 'captcha';
  if (cardCount > 0 && /\d{2}:\d{2}/.test(bodyText)) return 'content';
  return 'empty';
}

export function safeArtifactName(date, signature, stage) {
  return `${date}-${signature}-${stage}`
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function waitForStableCards(page) {
  let previous = -1;
  let unchanged = 0;
  for (let attempt = 0; attempt < 8 && unchanged < 2; attempt += 1) {
    const count = await page.locator('.flight-item').count();
    unchanged = count === previous ? unchanged + 1 : 0;
    previous = count;
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1000);
  }
}

async function assertContent(page, stage) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const cardCount = await page.locator('.flight-item').count();
  const state = classifyCtripPage({ url: page.url(), bodyText, cardCount });
  if (state === 'captcha') throw Object.assign(new Error('携程返回验证码或访问验证页面'), { code: 'captcha', stage });
  if (state !== 'content') throw Object.assign(new Error('页面未发现航班卡片'), { code: 'cards_not_found', stage });
}

async function saveFailureArtifacts(page, artifactDir, { date, signature = 'list', stage }) {
  const base = `${artifactDir}/${safeArtifactName(date, signature, stage)}`;
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  const bodyText = await page.locator('body').innerText().catch(() => '');
  await writeFile(`${base}.txt`, `URL: ${page.url()}\n\n${bodyText.slice(0, 4000)}`, 'utf8');
}

export function createCtripPageSession({ browser, buildSearchUrl, artifactDir = 'artifacts' }) {
  async function loadList(page, query, stage) {
    await page.goto(buildSearchUrl(query), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(18000);
    await assertContent(page, stage);
    await waitForStableCards(page);
  }

  return {
    async listOutbounds(query) {
      const page = await browser.newPage({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
      try {
        await loadList(page, query, 'outbound_list');
        return await extractFlightCards(page.locator('.flight-item'), query.depart_date);
      } catch (error) {
        await saveFailureArtifacts(page, artifactDir, { date: query.depart_date, stage: 'outbound_list' });
        throw Object.assign(error, { stage: error.stage ?? 'outbound_list' });
      } finally {
        await page.close();
      }
    },

    async listReturns(query, outbound) {
      const page = await browser.newPage({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
      try {
        await loadList(page, query, 'outbound_select');
        const card = page.locator('.flight-item')
          .filter({ hasText: outbound.flight_no || outbound.airline })
          .filter({ hasText: outbound.departure_time })
          .filter({ hasText: outbound.arrival_time.replace('+1', '') })
          .first();
        if (await card.count() !== 1) {
          throw Object.assign(new Error('无法重新定位去程卡片'), { code: 'outbound_not_found', stage: 'outbound_select' });
        }
        await card.getByRole('button', { name: /选为去程|选择去程/ }).click({ timeout: 15000 });
        await page.getByText(/选择返程/).waitFor({ timeout: 30000 });
        await assertContent(page, 'return_list');
        await waitForStableCards(page);
        return await extractFlightCards(page.locator('.flight-item'), query.return_date);
      } catch (error) {
        await saveFailureArtifacts(page, artifactDir, {
          date: query.depart_date, signature: outbound.signature, stage: error.stage ?? 'return_list',
        });
        throw error;
      } finally {
        await page.close();
      }
    },
  };
}
```

页面侦察时若真实 DOM 不含 fixture 使用的语义 class，只允许修改 `extractFlightCards` 内的字段定位，不允许回退为“第 N 个文本片段就是机场”。将实际页面中一张去程和一张返程卡片的去敏结构更新到 fixture，再让同一测试通过。

- [ ] **Step 4: 运行页面适配器和旧 URL 测试**

Run: `node --test tests/ctrip-page.test.js tests/collector.test.js`

Expected: 所有测试 PASS。

### Task 4: 顺序编排两个日期并处理 partial/captcha/总超时

**Files:**
- Modify: `src/collector.js`
- Modify: `tests/collector.test.js`

- [ ] **Step 1: 写编排失败测试**

在 `tests/collector.test.js` 增加基于页面会话接口的测试，不启动真实网络：

```js
import { collectItineraries } from '../src/collector.js';

const queries = [
  { from: 'HGH', to: 'URC', depart_date: '2026-09-30', return_date: '2026-10-08' },
  { from: 'HGH', to: 'URC', depart_date: '2026-10-01', return_date: '2026-10-08' },
];

function outbound(date, flightNo, departureTime) {
  return {
    date, airline: '测试航空', flight_no: flightNo, departure_time: departureTime,
    departure_airport: '杭州萧山国际机场', arrival_time: '00:40+1',
    arrival_airport: '乌鲁木齐天山国际机场', direct: true, stops: [],
    signature: `${flightNo}|${departureTime}|00:40+1`, price: null,
  };
}

function returnCard(price = 3500) {
  return {
    date: '2026-10-08', airline: '测试航空', flight_no: 'AB5678', departure_time: '08:00',
    departure_airport: '乌鲁木齐天山国际机场', arrival_time: '15:00',
    arrival_airport: '杭州萧山国际机场', direct: true, stops: [],
    signature: 'AB5678|08:00|15:00',
    price: { total_price: price, price_text: `往返含税 ¥${price}`, currency: 'CNY' },
  };
}

test('collects two dates sequentially and ranks exact totals', async () => {
  const calls = [];
  const session = {
    async listOutbounds(query) {
      calls.push(`out:${query.depart_date}`);
      return [outbound(query.depart_date, query.depart_date === '2026-09-30' ? 'AB1234' : 'AB1235', query.depart_date === '2026-09-30' ? '21:00' : '18:00')];
    },
    async listReturns(query) {
      calls.push(`return:${query.depart_date}`);
      return [returnCard(query.depart_date === '2026-09-30' ? 3600 : 3500)];
    },
  };
  const result = await collectItineraries({ queries, session, timeoutMs: 1000 });
  assert.deepEqual(calls, ['out:2026-09-30', 'return:2026-09-30', 'out:2026-10-01', 'return:2026-10-01']);
  assert.deepEqual(result.scans.map((scan) => scan.status), ['completed', 'completed']);
  assert.equal(result.itineraries[0].total_price, 3500);
});

test('stops one date on captcha and still completes the other date', async () => {
  const session = {
    async listOutbounds(query) {
      if (query.depart_date === '2026-09-30') throw Object.assign(new Error('验证码'), { code: 'captcha', stage: 'outbound_list' });
      return [outbound(query.depart_date, 'AB1235', '18:00')];
    },
    async listReturns() { return [returnCard()]; },
  };
  const result = await collectItineraries({ queries, session, timeoutMs: 1000 });
  assert.deepEqual(result.scans.map((scan) => scan.status), ['failed', 'completed']);
  assert.equal(result.errors[0].code, 'captcha');
  assert.equal(result.itineraries.length, 1);
});

test('preserves the completed date when the second date reaches the total deadline', async () => {
  const session = {
    async listOutbounds(query) {
      if (query.depart_date === '2026-10-01') return new Promise(() => {});
      return [outbound(query.depart_date, 'AB1234', '21:00')];
    },
    async listReturns() { return [returnCard(3600)]; },
  };
  const result = await collectItineraries({ queries, session, timeoutMs: 10 });
  assert.deepEqual(result.scans.map((scan) => scan.status), ['completed', 'failed']);
  assert.equal(result.itineraries[0].total_price, 3600);
  assert.equal(result.errors[0].code, 'run_timeout');
});
```

- [ ] **Step 2: 运行测试确认新入口不存在**

Run: `node --test tests/collector.test.js`

Expected: FAIL，错误指出 `collectItineraries` 未导出。

- [ ] **Step 3: 将 collector 改成业务编排层**

保留 `headlessFromEnvironment` 和 `buildSearchUrl`；删除 v1 专用 `extractCardChunks`、`collectQuotes` 和旧诊断逻辑。实现：

```js
import { chromium } from 'playwright';

import { createCtripPageSession } from './ctrip-page.js';
import { isEligibleOutbound, isEligibleReturn, rankItineraries } from './itinerary.js';

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

export async function collectItineraries({ queries, session, timeoutMs = 600_000 }) {
  const scans = [];
  const combinations = [];
  const errors = [];
  const deadline = Date.now() + timeoutMs;
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    try {
      const outbounds = (await withinDeadline(
        session.listOutbounds(query), deadline,
      )).filter(isEligibleOutbound);
      for (const outbound of outbounds) {
        const returns = (await withinDeadline(
          session.listReturns(query, outbound), deadline,
        )).filter(isEligibleReturn);
        for (const returnLeg of returns) {
          if (!returnLeg.price) continue;
          combinations.push({
            ...returnLeg.price,
            outbound: publicLeg(outbound),
            return: publicLeg(returnLeg),
          });
        }
      }
      scans.push({ date: query.depart_date, status: 'completed' });
    } catch (error) {
      const normalized = normalizedError(error, query.depart_date);
      scans.push({ date: query.depart_date, status: 'failed' });
      errors.push(normalized);
      if (normalized.code === 'run_timeout') {
        for (const remainingQuery of queries.slice(queryIndex + 1)) {
          scans.push({ date: remainingQuery.depart_date, status: 'failed' });
        }
        break;
      }
    }
  }
  return { scans, itineraries: rankItineraries(combinations), errors };
}

export async function collectFromCtrip({ queries, artifactDir = 'artifacts', timeoutMs = 600_000 }) {
  const browser = await chromium.launch({ headless: headlessFromEnvironment() });
  const session = createCtripPageSession({ browser, buildSearchUrl, artifactDir });
  try {
    return await collectItineraries({ queries, session, timeoutMs });
  } finally {
    await browser.close();
  }
}
```

保留已有的 URL 构造函数：

```js
export function headlessFromEnvironment(environment = process.env) {
  return environment.FLIGHT_MONITOR_HEADLESS !== 'false';
}

export function buildSearchUrl(query) {
  const route = `${query.from.toLowerCase()}-${query.to.toLowerCase()}`;
  return `https://flights.ctrip.com/online/list/round-${route}`
    + `?depdate=${query.depart_date}_${query.return_date}`
    + '&cabin=Y_S_C_F&adult=1&child=0&infant=0';
}
```

- [ ] **Step 4: 运行 collector 测试**

Run: `node --test tests/collector.test.js`

Expected: 所有测试 PASS，调用顺序严格按 9 月 30 日、10 月 1 日执行。

### Task 5: 持久化 schema v2、partial 和混合历史

**Files:**
- Modify: `src/state.js`
- Replace: `tests/state.test.js`

- [ ] **Step 1: 用 schema v2 状态测试替换 v1 状态测试**

`tests/state.test.js` 使用一个合法完整行程和一个 v1 历史条目，覆盖全部状态：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNextState } from '../src/state.js';

const queries = [
  { from: 'HGH', to: 'URC', depart_date: '2026-09-30', return_date: '2026-10-08' },
  { from: 'HGH', to: 'URC', depart_date: '2026-10-01', return_date: '2026-10-08' },
];
const complete = {
  rank: 1, total_price: 3500, price_text: '往返含税 ¥3500', currency: 'CNY',
  outbound: { date: '2026-10-01', airline: '测试航空', flight_no: 'AB1234', departure_time: '18:00', departure_airport: '杭州萧山国际机场', arrival_time: '00:40+1', arrival_airport: '乌鲁木齐天山国际机场', direct: true, stops: [] },
  return: { date: '2026-10-08', airline: '测试航空', flight_no: 'AB5678', departure_time: '08:00', departure_airport: '乌鲁木齐天山国际机场', arrival_time: '15:00', arrival_airport: '杭州萧山国际机场', direct: true, stops: [] },
};
const legacyHistory = [{ checked_at: '2026-08-24T10:30:00+08:00', status: 'success', current: { best_price: 3538 } }];

test('writes a full two-date success and preserves legacy history unchanged', () => {
  const next = buildNextState({
    previousLatest: { schema_version: 1, last_success: { best_price: 3538 } },
    history: legacyHistory, queries, checkedAt: '2026-08-25T10:30:00+08:00',
    collection: { scans: queries.map((query) => ({ date: query.depart_date, status: 'completed' })), itineraries: [complete], errors: [] },
  });
  assert.equal(next.latest.schema_version, 2);
  assert.equal(next.latest.collection_scope, 'full_itinerary');
  assert.equal(next.latest.status, 'success');
  assert.equal(next.latest.current.best_total_price, 3500);
  assert.equal(next.latest.last_success.best_total_price, 3500);
  assert.deepEqual(next.history[0], legacyHistory[0]);
  assert.equal(next.history[1].collection_scope, 'full_itinerary');
});

test('records success with availability none without replacing last success', () => {
  const previous = { schema_version: 2, collection_scope: 'full_itinerary', last_success: { best_total_price: 3500 } };
  const next = buildNextState({
    previousLatest: previous, history: [], queries, checkedAt: '2026-08-25T14:30:00+08:00',
    collection: { scans: queries.map((query) => ({ date: query.depart_date, status: 'completed' })), itineraries: [], errors: [] },
  });
  assert.equal(next.latest.status, 'success');
  assert.equal(next.latest.current.availability, 'none');
  assert.equal(next.latest.last_success.best_total_price, 3500);
});

test('records partial with valid itineraries and preserves last success', () => {
  const next = buildNextState({
    previousLatest: { schema_version: 2, collection_scope: 'full_itinerary', last_success: { best_total_price: 3600 } },
    history: [], queries, checkedAt: '2026-08-25T18:30:00+08:00',
    collection: { scans: [{ date: '2026-09-30', status: 'failed' }, { date: '2026-10-01', status: 'completed' }], itineraries: [complete], errors: [{ date: '2026-09-30', stage: 'captcha', code: 'captcha', message: '验证码' }] },
  });
  assert.equal(next.latest.status, 'partial');
  assert.equal(next.latest.current.best_total_price, 3500);
  assert.equal(next.latest.last_success.best_total_price, 3600);
});

test('records failed when neither date completes', () => {
  const next = buildNextState({
    previousLatest: null, history: [], queries, checkedAt: '2026-08-25T18:30:00+08:00',
    collection: { scans: queries.map((query) => ({ date: query.depart_date, status: 'failed' })), itineraries: [], errors: [{ date: null, stage: 'run_timeout', code: 'run_timeout', message: '超时' }] },
  });
  assert.equal(next.latest.status, 'failed');
  assert.equal(next.latest.current, null);
  assert.equal(next.latest.last_success, null);
});
```

- [ ] **Step 2: 运行测试确认当前仍输出 schema v1**

Run: `node --test tests/state.test.js`

Expected: FAIL，至少包含 `1 !== 2`。

- [ ] **Step 3: 实现 schema v2 状态机**

将 `src/state.js` 替换为：

```js
function currentFrom(itineraries) {
  return {
    availability: itineraries.length > 0 ? 'available' : 'none',
    best_total_price: itineraries[0]?.total_price ?? null,
    currency: itineraries[0]?.currency ?? 'CNY',
    itineraries,
  };
}

function previousFullLastSuccess(previousLatest) {
  return previousLatest?.schema_version === 2
    && previousLatest?.collection_scope === 'full_itinerary'
    ? previousLatest.last_success ?? null
    : null;
}

export function buildNextState({ previousLatest, history, queries, checkedAt, collection }) {
  const completed = collection.scans.filter((scan) => scan.status === 'completed').length;
  const status = completed === queries.length ? 'success' : completed > 0 ? 'partial' : 'failed';
  const current = status === 'failed' ? null : currentFrom(collection.itineraries);
  const isFullSuccess = status === 'success' && collection.itineraries.length > 0;
  const lastSuccess = isFullSuccess
    ? { checked_at: checkedAt, ...current }
    : previousFullLastSuccess(previousLatest);
  const entry = {
    schema_version: 2,
    collection_scope: 'full_itinerary',
    status,
    checked_at: checkedAt,
    queries,
    scans: collection.scans,
    current,
    errors: collection.errors,
  };
  return {
    latest: { ...entry, last_success: lastSuccess },
    history: [...history, entry],
  };
}
```

- [ ] **Step 4: 运行状态测试**

Run: `node --test tests/state.test.js`

Expected: 4 tests PASS；v1 历史原样保留且不成为 v2 `last_success`。

### Task 6: 接通 run 和 CLI，但保持生产调度不变

**Files:**
- Modify: `src/run.js`
- Modify: `src/cli.js`
- Replace: `tests/run.test.js`

- [ ] **Step 1: 写 v2 持久化和 partial 返回测试**

在 `tests/run.test.js` 保留临时目录辅助函数，把两个测试改成：

```js
const queries = [
  { from: 'HGH', to: 'URC', depart_date: '2026-09-30', return_date: '2026-10-08' },
  { from: 'HGH', to: 'URC', depart_date: '2026-10-01', return_date: '2026-10-08' },
];

test('persists a schema v2 successful scan', async () => {
  const paths = await stateFiles();
  const result = await runCollection({
    collect: async () => ({ scans: queries.map((query) => ({ date: query.depart_date, status: 'completed' })), itineraries: [], errors: [] }),
    queries, checkedAt: '2026-08-25T10:30:00+08:00', ...paths,
  });
  const latest = JSON.parse(await readFile(paths.latestPath, 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(latest.schema_version, 2);
  assert.equal(latest.current.availability, 'none');
});

test('persists partial data and returns a non-success result', async () => {
  const paths = await stateFiles();
  const result = await runCollection({
    collect: async () => ({
      scans: [{ date: '2026-09-30', status: 'failed' }, { date: '2026-10-01', status: 'completed' }],
      itineraries: [], errors: [{ date: '2026-09-30', stage: 'captcha', code: 'captcha', message: '验证码' }],
    }),
    queries, checkedAt: '2026-08-25T14:30:00+08:00', ...paths,
  });
  const latest = JSON.parse(await readFile(paths.latestPath, 'utf8'));
  assert.equal(result.ok, false);
  assert.equal(result.status, 'partial');
  assert.equal(latest.errors[0].code, 'captcha');
});
```

- [ ] **Step 2: 运行测试确认旧参数契约失败**

Run: `node --test tests/run.test.js`

Expected: FAIL，旧 `runCollection` 仍按 `query/quotes/error` 调用状态层。

- [ ] **Step 3: 修改 run 持久化完整 collection**

保留 `readJson`、`writeJson`，将 `runCollection` 改为：

```js
export async function runCollection({ collect, queries, checkedAt, latestPath, historyPath }) {
  const previousLatest = await readJson(latestPath, null);
  const history = await readJson(historyPath, []);
  let collection;
  try {
    collection = await collect({ queries });
  } catch (error) {
    collection = {
      scans: queries.map((query) => ({ date: query.depart_date, status: 'failed' })),
      itineraries: [],
      errors: [{
        date: null,
        stage: error?.stage ?? 'outbound_list',
        code: error?.code ?? 'unexpected',
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
  const next = buildNextState({ previousLatest, history, queries, checkedAt, collection });
  await writeJson(latestPath, next.latest);
  await writeJson(historyPath, next.history);
  return { ok: next.latest.status === 'success', status: next.latest.status, errors: next.latest.errors };
}
```

- [ ] **Step 4: 修改 CLI 为两个日期和 v2 入口**

将 `src/cli.js` 的查询与采集入口改成：

```js
import { collectFromCtrip } from './collector.js';
import { runCollection } from './run.js';

const queries = [
  { from: 'HGH', to: 'URC', depart_date: '2026-09-30', return_date: '2026-10-08' },
  { from: 'HGH', to: 'URC', depart_date: '2026-10-01', return_date: '2026-10-08' },
];

function shanghaiIso(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00');
}

const result = await runCollection({
  collect: ({ queries: requestedQueries }) => collectFromCtrip({
    queries: requestedQueries,
    artifactDir: 'artifacts',
    timeoutMs: 600_000,
  }),
  queries,
  checkedAt: shanghaiIso(),
  latestPath: 'data/latest.json',
  historyPath: 'data/history.json',
});

if (!result.ok) {
  console.error(`${result.status}: ${result.errors.map((error) => `${error.code}:${error.message}`).join('; ')}`);
  process.exitCode = 1;
}
```

- [ ] **Step 5: 运行持久化测试和全套单元测试**

Run: `npm test`

Expected: 全部测试 PASS；现有调度的“两小时内跳过”测试仍 PASS。

### Task 7: 真实页面侦察与当前 Mac 手动 A/B 验证

**Files:**
- Modify if real DOM differs: `src/ctrip-page.js`
- Modify if real DOM differs: `tests/fixtures/ctrip-roundtrip-cards.html`
- Modify if parser behavior changes: `tests/ctrip-page.test.js`
- Generated and ignored: `artifacts/*.png`, `artifacts/*.txt`
- Generated in a temporary directory only: `data/latest.json`, `data/history.json`

- [ ] **Step 1: 防止手动验证覆盖当前生产数据**

在系统临时目录复制仓库后运行，开发仓库和独立运行目录都不写 `data/*.json`：

Run:

```bash
validation_dir="$(mktemp -d /tmp/flight-monitor-v2.XXXXXX)"
rsync -a --exclude node_modules --exclude .git ./ "$validation_dir/"
ln -s "$PWD/node_modules" "$validation_dir/node_modules"
cd "$validation_dir"
```

Expected: 当前目录形如 `/tmp/flight-monitor-v2.xxxxxx`，且 `node_modules` 指向开发仓库依赖。

- [ ] **Step 2: 使用可见 Chromium 手动采集一次**

Run: `FLIGHT_MONITOR_HEADLESS=false FLIGHT_MONITOR_FORCE=true npm run collect`

Expected: 最长 10 分钟内结束；浏览器只完成“选择去程 → 选择返程”读取，不登录、不填写乘机人、不创建订单。

- [ ] **Step 3: 验证 v2 结果的必要证据**

Run:

```bash
node -e 'const x=require("./data/latest.json"); const i=x.current?.itineraries?.[0]; console.log(JSON.stringify({schema:x.schema_version,scope:x.collection_scope,status:x.status,outbound:i?.outbound,return:i?.return,total_price:i?.total_price,price_text:i?.price_text},null,2))'
```

Expected:

- `schema` 为 `2`，`scope` 为 `full_itinerary`，`status` 为 `success`。
- 至少一条结果同时包含去程和返程航班号、起降时间、机场、直飞/中转字段。
- `price_text` 明确包含“往返总价”或“往返含税”等语义；允许 `¥3538起 往返总价`，但必须标记 `price_scope: itinerary_starting_price`；`加 ¥X` 仍然无效。
- 中转的每一个 `wait_minutes` 都 `<= 45`。
- `itineraries` 按 `total_price` 升序，直飞与中转不分组。

- [ ] **Step 4: 与旧采集结果做口径 A/B 核验**

只比较字段含义，不计算涨跌：

- A：现有 schema v1 的 `best_price` 是去程卡片往返起价。
- B：本次 schema v2 的 `best_total_price` 必须绑定具体去程和具体返程。
- 若 B 与 A 数字相同，也只能在 B 具备具体返程、明确组合起价文本和 `price_scope: itinerary_starting_price` 时判定验证成功。
- 若出现验证码、返程页只有差价、字段缺失或一个日期未完成，验证失败，不切换生产。

- [ ] **Step 5: 真实 DOM 不匹配时按证据收敛适配器**

根据 `artifacts` 中的截图和截断文本更新 fixture，再先写能复现真实结构的失败测试。只修改 `extractFlightCards`、去程按钮定位或明确总价正则中被真实页面证据推翻的部分，然后依次运行：

Run: `node --test tests/ctrip-page.test.js tests/collector.test.js && npm test`

Expected: 定向测试和全套测试 PASS，再重新执行 Step 2；不通过时保持现有生产采集器。

### Task 8: 验证成功后准备发布说明，等待授权

**Files:**
- Modify: `README.md`
- Do not modify yet: `macos/com.sqlist.flight-monitor.plist`
- Do not modify yet: `/Users/sqlist/Library/Application Support/flight-monitor/repo`

- [ ] **Step 1: 更新 README 的最终数据口径**

将“查询范围”和“数据”改为：

```markdown
## 查询范围

- 杭州（HGH）→ 乌鲁木齐（URC）
- 去程：2026-09-30 21:00 后，或 2026-10-01 15:00 后；最迟次日 01:00 抵达
- 返程：2026-10-08，18:00 及以前抵达杭州
- 每个日期最多选择 5 个合格去程；直飞和中转统一按完整往返组合起价排序；每次中转等待不超过 45 分钟

## 数据

- [`data/latest.json`](data/latest.json)：本轮状态、排名前 5 的完整往返行程和最近一次完整成功结果
- [`data/history.json`](data/history.json)：保留 schema v1 起价历史，并追加 schema v2 完整行程历史

schema v1 的未绑定返程起价与 schema v2 的完整组合起价不互相计算涨跌。schema v2 使用 `price_scope: itinerary_starting_price`，不表述为最终支付价。页面触发访问验证或无法确认组合起价时记录失败，不把旧起价冒充为完整报价。
```

- [ ] **Step 2: 做发布前静态复核**

Run:

```bash
npm test
git diff --check
bad_rules='严格少于'' 45|等待 45 分钟.*排除|中转.*便宜.*300|直飞''优先|T''BD|T''ODO'
rg -n "$bad_rules" src tests README.md docs/superpowers/specs/2026-08-25-complete-round-trip-itineraries-design.md
```

Expected: 测试全部 PASS；`git diff --check` 无输出；搜索无旧规则或占位词命中。

- [ ] **Step 3: 报告验证结果并停止在发布边界**

向用户提供：手动运行时间、两日期扫描状态、最便宜完整组合、返程航班、组合起价原文、`price_scope`、是否有验证码/partial、测试数量。此时不提交、不推送、不替换运行目录、不修改 LaunchAgent；等待用户明确授权发布。

## 验收标准映射

- 双去程日期与时间窗口：Task 1、Task 4。
- 返程 18:00 到达上限：Task 1。
- 45 分钟保留、46 分钟排除：Task 1、Task 7。
- 结构化机场与 `+1天`：Task 2、Task 3。
- 具体双方航班和明确组合起价：Task 2、Task 4、Task 7、Task 9。
- 直飞/中转统一按往返总价：Task 1、Task 4。
- schema v1/v2 历史隔离：Task 5、Task 6。
- success/partial/failed/none/last_success：Task 5。
- 验证失败不切换现有定时采集：Task 7、Task 8。

## 2026-08-25 实测后的增量计划

以下任务覆盖第一次真实返程页验证暴露的问题，并取代前文中“每个候选新建页面”和“起价无效”的旧假设。

### Task 9: 明确组合起价并修正航司、中转机场

**Files:**
- Modify: `src/ctrip-page.js`
- Modify: `src/itinerary.js`
- Modify: `tests/ctrip-page.test.js`
- Modify: `tests/itinerary.test.js`
- Modify: `tests/fixtures/ctrip-roundtrip-cards.html`

- [ ] **Step 1: 写真实价格和字段失败测试**

在页面测试中增加：

```js
test('records a return-card starting price with an explicit scope', () => {
  assert.deepEqual(parseExplicitTotalPrice('¥3538起 往返总价'), {
    total_price: 3538,
    price_text: '¥3538起 往返总价',
    price_scope: 'itinerary_starting_price',
    currency: 'CNY',
  });
});

test('keeps only the airline name and requires the transfer airport', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  const cards = await extractFlightCards(page.locator('.flight-item'), '2026-10-01');
  assert.equal(cards[0].airline, '中国南方航空');
  assert.deepEqual(cards[2].stops, [{ airport: '西安咸阳国际机场', wait_minutes: 45 }]);
});
```

在领域测试中增加：

```js
test('rejects a connection without a transfer airport', () => {
  const invalid = itinerary({
    price_scope: 'itinerary_starting_price',
    outbound: leg({ direct: false, stops: [{ airport: null, wait_minutes: 45 }] }),
  });
  assert.equal(validateCompleteItinerary(invalid), false);
});
```

并让所有合法 `itinerary()` fixture 带上：

```js
price_scope: 'itinerary_starting_price',
```

- [ ] **Step 2: 验证测试因缺少 scope 和字段约束失败**

Run: `node --test tests/ctrip-page.test.js tests/itinerary.test.js`

Expected: FAIL；价格对象缺少 `price_scope`，空中转机场仍被接收。

- [ ] **Step 3: 最小实现价格范围与结构化字段**

`parseExplicitTotalPrice` 返回：

```js
return totalPrice > 0
  ? {
      total_price: totalPrice,
      price_text: normalized,
      price_scope: 'itinerary_starting_price',
      currency: 'CNY',
    }
  : null;
```

页面快照先精确取 `.airline-name`，再使用宽松后备选择器；中转机场从起降机场之外的机场文本读取：

```js
airline: text(card.querySelector('.airline-name'))
  || text(card.querySelector('[class*="airline"]'))
  || null,
```

```js
const stopAirport = snapshot.leafTexts.find((value) => /机场/.test(value)
  && !snapshot.airports.some((airport) => airport?.includes(value) || value.includes(airport)));
```

中转结果使用：

```js
stops: direct ? [] : [{
  airport: stopAirport || transferLabel?.replace(/^(?:中转|经停)\s*/, '') || null,
  wait_minutes: wait ? Number(wait[1]) : null,
}],
```

`validateCompleteItinerary` 增加：

```js
&& value.price_scope === 'itinerary_starting_price'
```

`completeLeg` 增加：

```js
&& (leg.direct || leg.stops.every((stop) => typeof stop.airport === 'string' && stop.airport))
```

- [ ] **Step 4: 验证字段和价格语义**

Run: `node --test tests/ctrip-page.test.js tests/itinerary.test.js`

Expected: 所有测试 PASS；`¥X起 往返总价` 有明确 scope，空中转机场无效。

### Task 10: 每日期只选前 5 个去程并输出进度日志

**Files:**
- Modify: `src/itinerary.js`
- Modify: `src/collector.js`
- Modify: `tests/itinerary.test.js`
- Modify: `tests/collector.test.js`

- [ ] **Step 1: 写候选上限和日志失败测试**

```js
test('selects at most five eligible outbounds by starting price', () => {
  const values = [4200, 3500, 3900, 3600, 3700, 3800, 3400].map((price, index) => leg({
    flight_no: `AB12${index}0`,
    departure_time: index === 0 ? '14:00' : '18:00',
    price: { total_price: price },
  }));
  assert.deepEqual(
    selectOutboundCandidates(values).map((item) => item.price.total_price),
    [3400, 3500, 3600, 3700, 3800],
  );
});
```

```js
test('logs date, candidate progress, accepted returns and elapsed time', async () => {
  const logs = [];
  await collectItineraries({
    queries: [queries[1]],
    session: {
      async listOutbounds() { return [outbound('2026-10-01', 'AB1235', '18:00')]; },
      async listReturns() { return [returnCard()]; },
    },
    timeoutMs: 1000,
    logger: (line) => logs.push(line),
    now: (() => { let value = 0; return () => { value += 100; return value; }; })(),
  });
  assert.equal(logs.some((line) => line.includes('[2026-10-01] 合格去程 1，选取 1')), true);
  assert.equal(logs.some((line) => line.includes('候选 1/1 AB1235')), true);
  assert.equal(logs.some((line) => line.includes('有效返程 1')), true);
  assert.equal(logs.some((line) => line.includes('日期完成')), true);
});
```

- [ ] **Step 2: 验证缺少候选函数和日志**

Run: `node --test tests/itinerary.test.js tests/collector.test.js`

Expected: FAIL；`selectOutboundCandidates` 未导出或日志断言不成立。

- [ ] **Step 3: 实现前 5 个候选和结构化进度文本**

在 `itinerary.js` 增加：

```js
export function selectOutboundCandidates(values, limit = 5) {
  return values
    .filter(isEligibleOutbound)
    .sort((left, right) => (left.price?.total_price ?? Number.POSITIVE_INFINITY)
      - (right.price?.total_price ?? Number.POSITIVE_INFINITY)
      || outboundPreferredDistance(left) - outboundPreferredDistance(right)
      || left.flight_no.localeCompare(right.flight_no))
    .slice(0, limit);
}
```

`collectItineraries` 增加 `logger = () => {}`、`now = Date.now`，并在日期开始、候选开始、返程解析结束、日期完成和错误处输出中文日志。候选来自：

```js
const allOutbounds = await withinDeadline(session.listOutbounds(query), deadline);
const eligibleCount = allOutbounds.filter(isEligibleOutbound).length;
const outbounds = selectOutboundCandidates(allOutbounds);
logger(`[${query.depart_date}] 合格去程 ${eligibleCount}，选取 ${outbounds.length}`);
```

- [ ] **Step 4: 验证候选和日志**

Run: `node --test tests/itinerary.test.js tests/collector.test.js`

Expected: 所有测试 PASS；每日期最多处理 5 个去程。

### Task 11: 复用单一页面并在页面底部停止滚动

**Files:**
- Modify: `src/ctrip-page.js`
- Modify: `src/collector.js`
- Modify: `tests/ctrip-page.test.js`
- Modify: `tests/collector.test.js`

- [ ] **Step 1: 写滚动停止和单页创建失败测试**

```js
test('stops loading when card count and page height are stable at the bottom', () => {
  assert.equal(shouldContinueLoading({
    atBottom: true, count: 21, previousCount: 21, height: 3000, previousHeight: 3000,
  }), false);
  assert.equal(shouldContinueLoading({
    atBottom: true, count: 22, previousCount: 21, height: 3200, previousHeight: 3000,
  }), true);
});
```

```js
test('creates one page for the whole collection', async () => {
  let pageCount = 0;
  const page = {};
  const browser = {
    async newPage() { pageCount += 1; return page; },
    async close() {},
  };
  await collectFromCtrip({
    queries: [],
    launchBrowser: async () => browser,
    createSession: ({ page: requestedPage }) => {
      assert.equal(requestedPage, page);
      return {};
    },
  });
  assert.equal(pageCount, 1);
});
```

- [ ] **Step 2: 验证当前实现仍按候选创建页面**

Run: `node --test tests/ctrip-page.test.js tests/collector.test.js`

Expected: FAIL；滚动判断未导出或 `collectFromCtrip` 不支持单页依赖。

- [ ] **Step 3: 实现单页会话与到底即停**

`createCtripPageSession` 改为接收 `page`，`listOutbounds` 和 `listReturns` 都复用它；每次处理下一候选只在同一页面 `goto(buildSearchUrl(query))`。删除方法内部的 `browser.newPage()` 和 `page.close()`。

新增纯函数：

```js
export function shouldContinueLoading({
  atBottom, count, previousCount, height, previousHeight,
}) {
  return !(atBottom && count === previousCount && height === previousHeight);
}
```

`waitForStableCards` 每轮读取 `scrollY`、`innerHeight`、`scrollHeight` 和卡片数量；已经在底部时只等待内容变化，不再调用滚动。仅在尚未到底或页面高度增长后调用一次 `scrollTo(0, scrollHeight)`。

`collectFromCtrip` 接受测试依赖并只创建一个页面：

```js
export async function collectFromCtrip({
  queries,
  artifactDir = 'artifacts',
  timeoutMs = 600_000,
  launchBrowser = (options) => chromium.launch(options),
  createSession = createCtripPageSession,
}) {
  const browser = await launchBrowser({ headless: headlessFromEnvironment() });
  try {
    const page = await browser.newPage({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const session = createSession({ page, buildSearchUrl, artifactDir });
    return await collectItineraries({ queries, session, timeoutMs, logger: console.log });
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: 验证单页和滚动行为**

Run: `node --test tests/ctrip-page.test.js tests/collector.test.js`

Expected: 所有测试 PASS；整轮只调用一次 `newPage()`。

### Task 12: 可见 Chromium 出现后恢复原前台应用

**Files:**
- Create: `src/macos-focus.js`
- Create: `tests/macos-focus.test.js`
- Modify: `src/collector.js`

- [ ] **Step 1: 写 macOS 焦点恢复失败测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureFrontmostApplication, restoreFrontmostApplication } from '../src/macos-focus.js';

test('captures and restores the frontmost macOS application', async () => {
  const calls = [];
  const run = async (...args) => {
    calls.push(args);
    return calls.length === 1 ? { stdout: 'GoLand\n' } : { stdout: '' };
  };
  const name = await captureFrontmostApplication({ platform: 'darwin', run });
  await restoreFrontmostApplication(name, { platform: 'darwin', run });
  assert.equal(name, 'GoLand');
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1].join(' ').includes('GoLand'), true);
});
```

- [ ] **Step 2: 验证模块不存在**

Run: `node --test tests/macos-focus.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现焦点捕获与恢复**

`src/macos-focus.js` 使用 `execFile` 的 Promise 版本执行 `osascript`。非 macOS、无前台应用或系统调用失败时返回 `null`/静默跳过；应用名中的反斜线和双引号必须转义。`collectFromCtrip` 在可见模式下先捕获应用名，创建唯一页面后立即恢复该应用焦点；无头模式不执行。

- [ ] **Step 4: 验证焦点模块和全套测试**

Run: `node --test tests/macos-focus.test.js && npm test`

Expected: 所有测试 PASS。

### Task 13: 用当前 Mac 重新验证完整组合起价

**Files:**
- Generated in a new temporary directory: `data/latest.json`, `data/history.json`, `artifacts/*`
- Do not modify: `macos/com.sqlist.flight-monitor.plist`
- Do not modify: `/Users/sqlist/Library/Application Support/flight-monitor/repo`

- [ ] **Step 1: 在新临时副本运行可见采集**

复用 Task 7 的临时目录流程，然后运行：

Run: `FLIGHT_MONITOR_HEADLESS=false FLIGHT_MONITOR_FORCE=true npm run collect`

Expected: 浏览器出现后前台焦点回到原应用；日志持续显示日期、最多 5 个候选、返程数量和耗时；页面到底后不再多次滚动；整轮在 10 分钟内完成。

- [ ] **Step 2: 验证结果口径和字段**

Expected:

- 两个日期均为 `completed`，整体 `status: success`。
- 至少一条结果包含双方航班、航司、机场、时间和非空中转机场。
- `price_text` 来自选择具体去程后的返程卡片。
- `price_scope` 为 `itinerary_starting_price`。
- 最多处理每日期 5 个去程，最终最多保存 5 个完整组合。
- 无 `run_timeout`、`captcha` 或持续占用前台焦点。

- [ ] **Step 3: 停在发布授权边界**

运行 `npm test`、`git diff --check` 和旧规则扫描；报告验证证据。不得提交、推送、替换运行目录或修改 LaunchAgent，等待用户明确授权。
