import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNextState } from '../src/state.js';

const queries = [{
  from: 'URC',
  to: 'HGH',
  depart_date: '2026-10-08',
}];

const complete = {
  rank: 1,
  date: '2026-10-08',
  airline: '长龙航空',
  flight_no: 'GJ8968',
  departure_time: '07:30',
  departure_airport: '乌鲁木齐天山国际机场T3',
  arrival_time: '12:30',
  arrival_airport: '杭州萧山国际机场T3',
  service_type: 'direct',
  stops: [],
  price: 1880,
  price_text: '¥1880起',
  price_scope: 'flight_starting_price',
  currency: 'CNY',
};

const legacyHistory = [{
  schema_version: 2,
  collection_scope: 'full_itinerary',
  checked_at: '2026-09-15T10:30:00+08:00',
  status: 'success',
}];

test('writes a schema v3 return-only success and preserves old history', () => {
  const flights = Array.from({ length: 7 }, (_, index) => ({
    ...complete,
    rank: index + 1,
    flight_no: `AB12${index}0`,
    price: 1880 + index,
    price_text: `¥${1880 + index}起`,
  }));
  const next = buildNextState({
    previousLatest: legacyHistory[0],
    history: legacyHistory,
    queries,
    checkedAt: '2026-09-16T10:30:00+08:00',
    collection: {
      scans: [{ date: '2026-10-08', status: 'completed' }],
      flights,
      errors: [],
    },
  });

  assert.equal(next.latest.schema_version, 3);
  assert.equal(next.latest.collection_scope, 'return_one_way');
  assert.equal(next.latest.status, 'success');
  assert.equal(next.latest.current.best_price, 1880);
  assert.equal(next.latest.current.flights.length, 7);
  assert.equal(next.latest.last_success.best_price, 1880);
  assert.deepEqual(next.history[0], legacyHistory[0]);
  assert.equal(next.history[1].collection_scope, 'return_one_way');
});

test('does not use an old round-trip result as return last success', () => {
  const next = buildNextState({
    previousLatest: legacyHistory[0],
    history: [],
    queries,
    checkedAt: '2026-09-16T14:30:00+08:00',
    collection: {
      scans: [{ date: '2026-10-08', status: 'completed' }],
      flights: [],
      errors: [],
    },
  });

  assert.equal(next.latest.current.availability, 'none');
  assert.equal(next.latest.last_success, null);
});

test('keeps a previous schema v3 return result when no fare is available', () => {
  const previous = {
    schema_version: 3,
    collection_scope: 'return_one_way',
    last_success: { best_price: 1880 },
  };
  const next = buildNextState({
    previousLatest: previous,
    history: [],
    queries,
    checkedAt: '2026-09-16T18:30:00+08:00',
    collection: {
      scans: [{ date: '2026-10-08', status: 'completed' }],
      flights: [],
      errors: [],
    },
  });

  assert.equal(next.latest.last_success.best_price, 1880);
});

test('records failed when the return date does not complete', () => {
  const next = buildNextState({
    previousLatest: null,
    history: [],
    queries,
    checkedAt: '2026-09-16T18:30:00+08:00',
    collection: {
      scans: [{ date: '2026-10-08', status: 'failed' }],
      flights: [],
      errors: [{
        date: '2026-10-08',
        stage: 'flight_list',
        code: 'captcha',
        message: '验证码',
      }],
    },
  });

  assert.equal(next.latest.status, 'failed');
  assert.equal(next.latest.current, null);
  assert.equal(next.latest.last_success, null);
});
