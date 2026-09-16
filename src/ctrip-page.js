import { mkdir, writeFile } from 'node:fs/promises';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// 只接受航班卡片展示的人民币起价，不把“加价”当作独立单程价格。
export function parseOneWayPrice(text) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (/加\s*¥/.test(normalized)) return null;
  const match = /¥\s*([\d,]+)/.exec(normalized);
  if (!match) return null;
  const price = Number(match[1].replaceAll(',', ''));
  return price > 0
    ? {
      price,
      price_text: normalized,
      price_scope: 'flight_starting_price',
      currency: 'CNY',
    }
    : null;
}

// 从起降时间所在的 DOM 容器提取机场，避免用文本片段序号误判“+1天”。
export async function extractFlightCards(locator, date) {
  const snapshots = await locator.evaluateAll((cards) => cards.map((card) => {
    const text = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim();
    const ownText = (element) => [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => text(node))
      .join(' ')
      .trim();
    const leafTexts = [...card.querySelectorAll('*')]
      .map((element) => ownText(element))
      .filter(Boolean);
    const timeElements = [...card.querySelectorAll('*')]
      .filter((element) => /^([01]\d|2[0-3]):[0-5]\d$/.test(ownText(element)));
    const airportFor = (timeElement) => {
      const box = timeElement.closest(
        '[class*="depart"], [class*="arrive"], [class*="time-box"]',
      ) || timeElement.parentElement;
      return [...(box?.querySelectorAll('*') || [])]
        .map((element) => text(element))
        .find((value) => /(机场|航站楼|T\d)/.test(value)
          && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
          && !/^\+1天$/.test(value)) || null;
    };
    return {
      fullText: text(card),
      leafTexts,
      airline: text(card.querySelector('.airline-name'))
        || text(card.querySelector('[class*="airline"]'))
        || leafTexts[0]
        || null,
      flightNos: text(card).match(/\b[A-Z0-9]{2}\d{3,4}[A-Z]?\b/g) || [],
      times: timeElements.slice(0, 2).map((element) => ownText(element)),
      airports: timeElements.slice(0, 2).map(airportFor),
      arrivalNextDay: /\+1天/.test(text(timeElements[1]?.parentElement)),
      priceText: text(card.querySelector('[class*="price"]'))
        || leafTexts.find((value) => /¥\s*[\d,]+/.test(value))
        || null,
    };
  }));

  return snapshots.map((snapshot) => {
    const transferLabel = snapshot.leafTexts.find((value) => /^(?:中转|经停)/.test(value));
    const wait = snapshot.leafTexts
      .map((value) => /^(\d+)\s*(?:分钟|m)$/i.exec(value))
      .find(Boolean);
    const flightNo = snapshot.flightNos.join('/');
    const departureTime = TIME_RE.test(snapshot.times[0]) ? snapshot.times[0] : null;
    const arrivalClock = TIME_RE.test(snapshot.times[1]) ? snapshot.times[1] : null;
    const arrivalTime = arrivalClock && snapshot.arrivalNextDay
      ? `${arrivalClock}+1`
      : arrivalClock;
    const serviceType = /通程/.test(snapshot.fullText)
      ? 'through'
      : /中转/.test(snapshot.fullText)
        ? 'transfer'
        : /经停/.test(snapshot.fullText)
          ? 'stopover'
          : 'direct';
    const stopAirport = snapshot.leafTexts.find((value) => /机场/.test(value)
      && !snapshot.airports.some(
        (airport) => airport?.includes(value) || value.includes(airport),
      ));
    const parsedPrice = parseOneWayPrice(snapshot.priceText);
    return {
      date,
      airline: snapshot.airline,
      flight_no: flightNo || null,
      departure_time: departureTime,
      departure_airport: snapshot.airports[0],
      arrival_time: arrivalTime,
      arrival_airport: snapshot.airports[1],
      service_type: serviceType,
      stops: serviceType === 'direct' ? [] : [{
        airport: stopAirport
          || transferLabel?.replace(/^(?:中转|经停)\s*/, '')
          || null,
        wait_minutes: wait ? Number(wait[1]) : null,
      }],
      signature: [flightNo || snapshot.airline, departureTime, arrivalTime].join('|'),
      price: parsedPrice?.price ?? null,
      price_text: parsedPrice?.price_text ?? null,
      price_scope: parsedPrice?.price_scope ?? null,
      currency: parsedPrice?.currency ?? null,
    };
  });
}

// 验证码优先于卡片判断，避免把拦截页上残留的航班节点当成有效内容。
export function classifyCtripPage({ url, bodyText, cardCount }) {
  if (url.includes('captcha')
    || /安全验证|访问频繁|请完成验证|whaleguard\s+block/i.test(bodyText)) {
    return 'captcha';
  }
  if (cardCount === 0 && /账号密码登录/.test(bodyText)) return 'login_required';
  if (cardCount > 0 && /\d{2}:\d{2}/.test(bodyText)) return 'content';
  return 'empty';
}

// 诊断文件名只保留日期、航班签名和阶段，不写入 URL、Cookie 或用户信息。
export function safeArtifactName(date, signature, stage) {
  return `${date}-${signature}-${stage}`
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// 卡片数量和页面高度在底部均不再变化时停止，避免到底后继续触发滚动。
export function shouldContinueLoading({
  atBottom,
  count,
  previousCount,
  height,
  previousHeight,
}) {
  return !(atBottom && count === previousCount && height === previousHeight);
}

async function waitForStableCards(page) {
  let previousCount = -1;
  let previousHeight = -1;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const count = await page.locator('.flight-item').count();
    const metrics = await page.evaluate(() => ({
      atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
      height: document.documentElement.scrollHeight,
    }));
    if (!shouldContinueLoading({
      ...metrics,
      count,
      previousCount,
      previousHeight,
    })) {
      break;
    }
    previousCount = count;
    previousHeight = metrics.height;
    if (!metrics.atBottom) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    }
    await page.waitForTimeout(1000);
  }
}

async function assertContent(page, stage) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const cardCount = await page.locator('.flight-item').count();
  const state = classifyCtripPage({ url: page.url(), bodyText, cardCount });
  if (state === 'captcha') {
    throw Object.assign(new Error('携程返回验证码或访问验证页面'), {
      code: 'captcha',
      stage,
    });
  }
  if (state === 'login_required') {
    throw Object.assign(new Error('携程要求重新登录采集器专用浏览器'), {
      code: 'login_required',
      stage,
    });
  }
  if (state !== 'content') {
    throw Object.assign(new Error('页面未发现航班卡片'), {
      code: 'cards_not_found',
      stage,
    });
  }
}

async function saveFailureArtifacts(page, artifactDir, {
  date,
  signature = 'list',
  stage,
}) {
  const base = `${artifactDir}/${safeArtifactName(date, signature, stage)}`;
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  const bodyText = await page.locator('body').innerText().catch(() => '');
  await writeFile(
    `${base}.txt`,
    `URL: ${page.url()}\n\n${bodyText.slice(0, 4000)}`,
    'utf8',
  );
}

// 整轮复用同一个页面，直接读取单程返程列表，不再选择去程。
export function createCtripPageSession({
  page,
  buildSearchUrl,
  artifactDir = 'artifacts',
}) {
  async function loadList(query, stage) {
    await page.goto(buildSearchUrl(query), {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await page.waitForTimeout(18000);
    await assertContent(page, stage);
    await waitForStableCards(page);
  }

  return {
    async listFlights(query) {
      try {
        await loadList(query, 'flight_list');
        return await extractFlightCards(
          page.locator('.flight-item'),
          query.depart_date,
        );
      } catch (error) {
        await saveFailureArtifacts(page, artifactDir, {
          date: query.depart_date,
          stage: error?.stage ?? 'flight_list',
        });
        throw Object.assign(error, { stage: error?.stage ?? 'flight_list' });
      }
    },
  };
}
