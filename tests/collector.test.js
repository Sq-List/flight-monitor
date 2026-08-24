import assert from 'node:assert/strict';
import test from 'node:test';

import { chromium } from 'playwright';

import {
  buildSearchUrl,
  classifyPageState,
  extractCardChunks,
  headlessFromEnvironment,
} from '../src/collector.js';

const query = {
  from: 'HGH',
  to: 'URC',
  depart_date: '2026-10-01',
  return_date: '2026-10-08',
};

test('builds the exact Ctrip round-trip URL', () => {
  assert.equal(
    buildSearchUrl(query),
    'https://flights.ctrip.com/online/list/round-hgh-urc?depdate=2026-10-01_2026-10-08&cabin=Y_S_C_F&adult=1&child=0&infant=0',
  );
});

test('classifies captcha before rendered cards', () => {
  assert.equal(
    classifyPageState({
      url: 'https://flights.ctrip.com/captcha',
      bodyText: '安全验证',
      cardCount: 3,
    }),
    'captcha',
  );
});

test('classifies Ctrip whaleguard as an access block', () => {
  assert.equal(
    classifyPageState({
      url: 'https://flights.ctrip.com/online/list',
      bodyText: 'whaleguard block',
      cardCount: 0,
    }),
    'captcha',
  );
});

test('classifies rendered flight cards as content', () => {
  assert.equal(
    classifyPageState({
      url: 'https://flights.ctrip.com/online/list',
      bodyText: '19:20 ¥ 3830',
      cardCount: 2,
    }),
    'content',
  );
});

test('uses headless Chromium by default', () => {
  assert.equal(headlessFromEnvironment({}), true);
});

test('uses visible Chromium only when explicitly disabled', () => {
  assert.equal(
    headlessFromEnvironment({ FLIGHT_MONITOR_HEADLESS: 'false' }),
    false,
  );
});

test('extracts ordered text chunks from a rendered flight card', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <article class="flight-item">
      <span>乌鲁木齐航空</span>
      <section><b>18:25</b><span>萧山国际机场T3</span></section>
      <section><b>01:00</b><span>地窝堡国际机场T2</span></section>
      <span>¥</span><span>3538</span><span>经济舱</span>
    </article>
  `);

  assert.deepEqual(await extractCardChunks(page), [[
    '乌鲁木齐航空',
    '18:25',
    '萧山国际机场T3',
    '01:00',
    '地窝堡国际机场T2',
    '¥',
    '3538',
    '经济舱',
  ]]);
});
