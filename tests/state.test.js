import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNextState } from '../src/state.js';

const query = {
  from: 'HGH',
  to: 'URC',
  depart_date: '2026-10-01',
  return_date: '2026-10-08',
};
const quotes = [
  { rank: 1, airline: '乌鲁木齐航空', price: 3538, currency: 'CNY' },
  { rank: 2, airline: '中国南方航空', price: 3830, currency: 'CNY' },
];

test('stores a successful run as current, last success, and history', () => {
  const next = buildNextState({
    previousLatest: null,
    history: [],
    query,
    checkedAt: '2026-08-24T07:30:00+08:00',
    quotes,
  });

  assert.equal(next.latest.status, 'success');
  assert.equal(next.latest.current.best_price, 3538);
  assert.equal(next.latest.last_success.checked_at, '2026-08-24T07:30:00+08:00');
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].status, 'success');
});

test('records a failed run without replacing the previous successful price', () => {
  const success = buildNextState({
    previousLatest: null,
    history: [],
    query,
    checkedAt: '2026-08-24T07:30:00+08:00',
    quotes,
  });
  const failed = buildNextState({
    previousLatest: success.latest,
    history: success.history,
    query,
    checkedAt: '2026-08-24T13:30:00+08:00',
    error: { code: 'captcha', message: '携程返回验证码页面' },
  });

  assert.equal(failed.latest.status, 'failed');
  assert.equal(failed.latest.current, null);
  assert.equal(failed.latest.last_success.best_price, 3538);
  assert.equal(failed.history.length, 2);
  assert.equal(failed.history[1].status, 'failed');
  assert.equal(failed.history[1].current, null);
});
