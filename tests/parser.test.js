import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseFlightCards } from '../src/parser.js';

const chunks = JSON.parse(
  await readFile(new URL('./fixtures/flight-card-chunks.json', import.meta.url), 'utf8'),
);
const sourceUrl = 'https://flights.ctrip.com/online/list/round-hgh-urc?depdate=2026-10-01_2026-10-08';

test('parses complete round-trip flight cards and drops incomplete cards', () => {
  const quotes = parseFlightCards(chunks, sourceUrl);

  assert.equal(quotes.length, 2);
  assert.deepEqual(quotes[0], {
    rank: 1,
    airline: '中国南方航空',
    flight_no: 'CZ8416',
    aircraft: '波音737',
    departure_time: '19:20',
    departure_airport: '萧山国际机场T4',
    arrival_time: '00:40',
    arrival_airport: '地窝堡国际机场T3',
    terminal: null,
    price: 3830,
    currency: 'CNY',
    cabin: '经济舱',
    source_url: sourceUrl,
  });
  assert.equal(quotes[1].flight_no, null);
  assert.equal(quotes[1].price, 3538);
});

test('returns no quotes when cards have no positive price', () => {
  assert.deepEqual(
    parseFlightCards([['长龙航空', '17:45', '萧山机场', '22:55', '地窝堡机场']], sourceUrl),
    [],
  );
});
