import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { chromium } from 'playwright';

import {
  classifyCtripPage,
  createCtripPageSession,
  extractFlightCards,
  parseOneWayPrice,
  safeArtifactName,
  shouldContinueLoading,
} from '../src/ctrip-page.js';

const html = await readFile(
  new URL('./fixtures/ctrip-oneway-cards.html', import.meta.url),
  'utf8',
);

test('extracts one-way return cards with airports and prices', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);

  const cards = await extractFlightCards(
    page.locator('#return .flight-item'),
    '2026-10-08',
  );

  assert.equal(cards[0].flight_no, 'GJ8968');
  assert.equal(cards[0].departure_airport, '乌鲁木齐天山国际机场T3');
  assert.equal(cards[0].arrival_airport, '杭州萧山国际机场T3');
  assert.equal(cards[0].service_type, 'direct');
  assert.equal(cards[0].price, 1880);
  assert.equal(cards[0].price_scope, 'flight_starting_price');
});

test('extracts stopover, through and transfer service types', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);

  const cards = await extractFlightCards(
    page.locator('#return .flight-item'),
    '2026-10-08',
  );

  assert.equal(cards[1].service_type, 'stopover');
  assert.deepEqual(cards[1].stops, [{
    airport: '西安咸阳国际机场',
    wait_minutes: 120,
  }]);
  assert.equal(cards[1].price, 1990);
  assert.equal(cards[2].service_type, 'through');
  assert.equal(cards[3].service_type, 'transfer');
});

test('accepts one-way starting prices and rejects price deltas', () => {
  assert.deepEqual(parseOneWayPrice('¥1,880起'), {
    price: 1880,
    price_text: '¥1,880起',
    price_scope: 'flight_starting_price',
    currency: 'CNY',
  });
  assert.equal(parseOneWayPrice('加 ¥200'), null);
  assert.equal(parseOneWayPrice('暂无报价'), null);
});

test('loads one-way cards directly without selecting an outbound', async () => {
  const page = {
    async goto(url) {
      assert.equal(url, 'https://example.test/oneway');
    },
    async waitForTimeout() {},
    locator(selector) {
      if (selector === 'body') {
        return { async innerText() { return '07:30 12:30'; } };
      }
      return {
        async count() { return 1; },
        first() {
          return { async waitFor() {} };
        },
        async evaluateAll() {
          return [];
        },
      };
    },
    async evaluate() {
      return { atBottom: true, height: 1000 };
    },
    url() {
      return 'https://example.test/oneway';
    },
  };
  const session = createCtripPageSession({
    page,
    buildSearchUrl: () => 'https://example.test/oneway',
  });

  assert.deepEqual(await session.listFlights({ depart_date: '2026-10-08' }), []);
});

test('keeps only the airline name', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  const cards = await extractFlightCards(
    page.locator('#return .flight-item'),
    '2026-10-08',
  );
  assert.equal(cards[0].airline, '长龙航空');
});

test('classifies captcha before apparently rendered content', () => {
  assert.equal(classifyCtripPage({
    url: 'https://flights.ctrip.com/captcha',
    bodyText: '安全验证',
    cardCount: 2,
  }), 'captcha');
});

test('classifies the Ctrip login dialog without treating 验证码登录 as captcha', () => {
  assert.equal(classifyCtripPage({
    url: 'https://flights.ctrip.com/online/list/oneway-urc-hgh',
    bodyText: '账号密码登录 验证码登录 抱歉，未找到符合条件的航班',
    cardCount: 0,
  }), 'login_required');
});

test('creates an artifact name without URL or credential data', () => {
  assert.equal(
    safeArtifactName('2026-10-08', 'list', 'flight_list'),
    '2026-10-08-list-flight_list',
  );
});

test('stops loading when card count and page height are stable at the bottom', () => {
  assert.equal(shouldContinueLoading({
    atBottom: true,
    count: 21,
    previousCount: 21,
    height: 3000,
    previousHeight: 3000,
  }), false);
  assert.equal(shouldContinueLoading({
    atBottom: true,
    count: 22,
    previousCount: 21,
    height: 3200,
    previousHeight: 3000,
  }), true);
});
