import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNextState } from '../src/state.js';

const queries = [
  {
    from: 'HGH',
    to: 'URC',
    depart_date: '2026-09-30',
    return_date: '2026-10-08',
  },
  {
    from: 'HGH',
    to: 'URC',
    depart_date: '2026-10-01',
    return_date: '2026-10-08',
  },
];

const complete = {
  rank: 1,
  total_price: 3500,
  price_text: '往返含税 ¥3500',
  price_scope: 'itinerary_starting_price',
  currency: 'CNY',
  outbound: {
    date: '2026-10-01',
    airline: '测试航空',
    flight_no: 'AB1234',
    departure_time: '18:00',
    departure_airport: '杭州萧山国际机场',
    arrival_time: '00:40+1',
    arrival_airport: '乌鲁木齐天山国际机场',
    direct: true,
    stops: [],
  },
  return: {
    date: '2026-10-08',
    airline: '测试航空',
    flight_no: 'AB5678',
    departure_time: '08:00',
    departure_airport: '乌鲁木齐天山国际机场',
    arrival_time: '15:00',
    arrival_airport: '杭州萧山国际机场',
    direct: true,
    stops: [],
  },
};

const legacyHistory = [{
  checked_at: '2026-08-24T10:30:00+08:00',
  status: 'success',
  current: { best_price: 3538 },
}];

test('writes a full two-date success and preserves legacy history unchanged', () => {
  const next = buildNextState({
    previousLatest: { schema_version: 1, last_success: { best_price: 3538 } },
    history: legacyHistory,
    queries,
    checkedAt: '2026-08-25T10:30:00+08:00',
    collection: {
      scans: queries.map((query) => ({
        date: query.depart_date,
        status: 'completed',
      })),
      itineraries: [complete],
      errors: [],
    },
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
  const previous = {
    schema_version: 2,
    collection_scope: 'full_itinerary',
    last_success: { best_total_price: 3500 },
  };
  const next = buildNextState({
    previousLatest: previous,
    history: [],
    queries,
    checkedAt: '2026-08-25T14:30:00+08:00',
    collection: {
      scans: queries.map((query) => ({
        date: query.depart_date,
        status: 'completed',
      })),
      itineraries: [],
      errors: [],
    },
  });
  assert.equal(next.latest.status, 'success');
  assert.equal(next.latest.current.availability, 'none');
  assert.equal(next.latest.last_success.best_total_price, 3500);
});

test('records partial with valid itineraries and preserves last success', () => {
  const next = buildNextState({
    previousLatest: {
      schema_version: 2,
      collection_scope: 'full_itinerary',
      last_success: { best_total_price: 3600 },
    },
    history: [],
    queries,
    checkedAt: '2026-08-25T18:30:00+08:00',
    collection: {
      scans: [
        { date: '2026-09-30', status: 'failed' },
        { date: '2026-10-01', status: 'completed' },
      ],
      itineraries: [complete],
      errors: [{
        date: '2026-09-30',
        stage: 'outbound_list',
        code: 'captcha',
        message: '验证码',
      }],
    },
  });
  assert.equal(next.latest.status, 'partial');
  assert.equal(next.latest.current.best_total_price, 3500);
  assert.equal(next.latest.last_success.best_total_price, 3600);
});

test('records failed when neither date completes', () => {
  const next = buildNextState({
    previousLatest: null,
    history: [],
    queries,
    checkedAt: '2026-08-25T18:30:00+08:00',
    collection: {
      scans: queries.map((query) => ({
        date: query.depart_date,
        status: 'failed',
      })),
      itineraries: [],
      errors: [{
        date: null,
        stage: 'run_timeout',
        code: 'run_timeout',
        message: '超时',
      }],
    },
  });
  assert.equal(next.latest.status, 'failed');
  assert.equal(next.latest.current, null);
  assert.equal(next.latest.last_success, null);
});
