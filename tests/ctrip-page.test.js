import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { chromium } from 'playwright';

import {
  classifyCtripPage,
  clickSelectOutbound,
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
