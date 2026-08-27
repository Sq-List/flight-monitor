import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { chromium } from 'playwright';

import {
  classifyCtripPage,
  clickSelectOutbound,
  createCtripPageSession,
  extractFlightCards,
  parseExplicitTotalPrice,
  safeArtifactName,
  shouldContinueLoading,
} from '../src/ctrip-page.js';

const html = await readFile(
  new URL('./fixtures/ctrip-roundtrip-cards.html', import.meta.url),
  'utf8',
);

test('extracts airports structurally and keeps +1 only on arrival time', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  const cards = await extractFlightCards(
    page.locator('#outbound .flight-item'),
    '2026-10-01',
  );
  assert.equal(cards[0].arrival_time, '00:40+1');
  assert.equal(cards[0].arrival_airport, '乌鲁木齐天山国际机场T3');
  assert.equal(cards[0].signature, 'CZ8416|19:20|00:40+1');
});

test('extracts a 45-minute transfer without treating it as direct', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  const cards = await extractFlightCards(
    page.locator('#return .flight-item'),
    '2026-10-08',
  );
  assert.deepEqual(cards[0].price, {
    total_price: 3538,
    price_text: '往返含税 ¥3,538',
    price_scope: 'itinerary_starting_price',
    currency: 'CNY',
  });
  assert.equal(cards[1].direct, false);
  assert.deepEqual(cards[1].stops, [{
    airport: '西安咸阳国际机场',
    wait_minutes: 45,
  }]);
});

test('clicks Ctrip div.btn-book without requiring a button role', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  await page.evaluate(() => {
    window.outboundSelected = false;
    document.querySelector('.btn-book').addEventListener('click', () => {
      window.outboundSelected = true;
    });
  });
  await clickSelectOutbound(page.locator('#outbound .flight-item'));
  assert.equal(await page.evaluate(() => window.outboundSelected), true);
});

test('clicks the visible outbound action instead of waiting for a hidden duplicate', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <div class="flight-item">
      <div id="hidden" class="btn-book" style="display: none">选为去程</div>
      <div id="visible" class="btn-book">选为去程</div>
    </div>
  `);
  await page.evaluate(() => {
    window.clickedOutbound = null;
    document.querySelector('#hidden').addEventListener('click', () => {
      window.clickedOutbound = 'hidden';
    });
    document.querySelector('#visible').addEventListener('click', () => {
      window.clickedOutbound = 'visible';
    });
    setTimeout(() => {
      document.querySelector('#hidden').style.display = 'block';
    }, 50);
  });

  await clickSelectOutbound(page.locator('.flight-item'));

  assert.equal(await page.evaluate(() => window.clickedOutbound), 'visible');
});

test('waits for return cards after the return header appears', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'flight-monitor-'));
  t.after(() => rm(artifactDir, { recursive: true, force: true }));
  const page = await browser.newPage();
  const delayedReturnPage = `
    <div id="step">1选择去程</div>
    <div id="list">
      <div class="flight-item">
        <div class="airline-name">乌鲁木齐航空</div>
        <div>UQ2594</div>
        <div><span>18:25</span></div>
        <div><span>01:00</span></div>
        <div class="btn-book">选为去程</div>
      </div>
    </div>
    <script>
      document.querySelector('.btn-book').addEventListener('click', () => {
        document.querySelector('#step').textContent = '2选择返程';
        document.querySelector('#list').innerHTML = '<div class="skeleton">加载中</div>';
        setTimeout(() => {
          document.querySelector('#list').innerHTML = \`
            <div class="flight-item">
              <div class="airline-name">天津航空</div>
              <div>GS7519</div>
              <div class="depart"><span>08:15</span><span>天山机场T3</span></div>
              <div class="arrive"><span>14:50</span><span>萧山机场T3</span></div>
              <div class="price">¥3438起 往返总价</div>
            </div>
          \`;
        }, 300);
      });
    </script>
  `;
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(delayedReturnPage)}`;
  const fastPage = new Proxy(page, {
    get(target, property) {
      if (property === 'waitForTimeout') return async () => {};
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const session = createCtripPageSession({
    page: fastPage,
    buildSearchUrl: () => url,
    artifactDir,
  });

  const returns = await session.listReturns({
    depart_date: '2026-10-01',
    return_date: '2026-10-08',
  }, {
    airline: '乌鲁木齐航空',
    flight_no: 'UQ2594',
    departure_time: '18:25',
    arrival_time: '01:00+1',
    signature: 'UQ2594|18:25|01:00+1',
  });

  assert.equal(returns.length, 1);
  assert.equal(returns[0].flight_no, 'GS7519');
  assert.equal(returns[0].price.total_price, 3438);
});

test('accepts only an explicitly labelled round-trip total', () => {
  assert.deepEqual(parseExplicitTotalPrice('往返含税 ¥3,538'), {
    total_price: 3538,
    price_text: '往返含税 ¥3,538',
    price_scope: 'itinerary_starting_price',
    currency: 'CNY',
  });
  assert.equal(parseExplicitTotalPrice('加 ¥200'), null);
  assert.equal(parseExplicitTotalPrice('¥3538起'), null);
});

test('records a return-card starting price with an explicit scope', () => {
  assert.deepEqual(parseExplicitTotalPrice('¥3538起 往返总价'), {
    total_price: 3538,
    price_text: '¥3538起 往返总价',
    price_scope: 'itinerary_starting_price',
    currency: 'CNY',
  });
});

test('keeps only the airline name', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  const cards = await extractFlightCards(
    page.locator('#outbound .flight-item'),
    '2026-10-01',
  );
  assert.equal(cards[0].airline, '中国南方航空');
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
    url: 'https://flights.ctrip.com/online/list/round-hgh-urc',
    bodyText: '账号密码登录 验证码登录 抱歉，未找到符合条件的航班',
    cardCount: 0,
  }), 'login_required');
});

test('creates an artifact name without URL or credential data', () => {
  assert.equal(
    safeArtifactName('2026-10-01', 'CZ8416|19:20|00:40+1', 'return_list'),
    '2026-10-01-CZ8416-19-20-00-40-1-return_list',
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
