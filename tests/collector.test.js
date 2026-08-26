import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSearchUrl,
  collectFromCtrip,
  collectItineraries,
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

test('uses headless Chromium by default', () => {
  assert.equal(headlessFromEnvironment({}), true);
});

test('uses visible Chromium only when explicitly disabled', () => {
  assert.equal(
    headlessFromEnvironment({ FLIGHT_MONITOR_HEADLESS: 'false' }),
    false,
  );
});

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

function outbound(date, flightNo, departureTime) {
  return {
    date,
    airline: '测试航空',
    flight_no: flightNo,
    departure_time: departureTime,
    departure_airport: '杭州萧山国际机场',
    arrival_time: '00:40+1',
    arrival_airport: '乌鲁木齐天山国际机场',
    direct: true,
    stops: [],
    signature: `${flightNo}|${departureTime}|00:40+1`,
    price: null,
  };
}

function returnCard(price = 3500) {
  return {
    date: '2026-10-08',
    airline: '测试航空',
    flight_no: 'AB5678',
    departure_time: '08:00',
    departure_airport: '乌鲁木齐天山国际机场',
    arrival_time: '15:00',
    arrival_airport: '杭州萧山国际机场',
    direct: true,
    stops: [],
    signature: 'AB5678|08:00|15:00',
    price: {
      total_price: price,
      price_text: `往返含税 ¥${price}`,
      price_scope: 'itinerary_starting_price',
      currency: 'CNY',
    },
  };
}

test('collects two dates sequentially and ranks exact totals', async () => {
  const calls = [];
  const session = {
    async listOutbounds(query) {
      calls.push(`out:${query.depart_date}`);
      return [outbound(
        query.depart_date,
        query.depart_date === '2026-09-30' ? 'AB1234' : 'AB1235',
        query.depart_date === '2026-09-30' ? '21:00' : '18:00',
      )];
    },
    async listReturns(query) {
      calls.push(`return:${query.depart_date}`);
      return [returnCard(query.depart_date === '2026-09-30' ? 3600 : 3500)];
    },
  };
  const result = await collectItineraries({ queries, session, timeoutMs: 1000 });
  assert.deepEqual(calls, [
    'out:2026-09-30',
    'return:2026-09-30',
    'out:2026-10-01',
    'return:2026-10-01',
  ]);
  assert.deepEqual(result.scans.map((scan) => scan.status), [
    'completed',
    'completed',
  ]);
  assert.equal(result.itineraries[0].total_price, 3500);
});

test('stops one date on captcha and still completes the other date', async () => {
  const session = {
    async listOutbounds(query) {
      if (query.depart_date === '2026-09-30') {
        throw Object.assign(new Error('验证码'), {
          code: 'captcha',
          stage: 'outbound_list',
        });
      }
      return [outbound(query.depart_date, 'AB1235', '18:00')];
    },
    async listReturns() {
      return [returnCard()];
    },
  };
  const result = await collectItineraries({ queries, session, timeoutMs: 1000 });
  assert.deepEqual(result.scans.map((scan) => scan.status), ['failed', 'completed']);
  assert.equal(result.errors[0].code, 'captcha');
  assert.equal(result.itineraries.length, 1);
});

test('continues later candidates after one outbound click fails', async () => {
  const attempts = [];
  const session = {
    async listOutbounds() {
      return [
        outbound('2026-10-01', 'AB1235', '18:00'),
        outbound('2026-10-01', 'AB1236', '19:00'),
      ];
    },
    async listReturns(_query, selectedOutbound) {
      attempts.push(selectedOutbound.flight_no);
      if (selectedOutbound.flight_no === 'AB1235') {
        throw Object.assign(new Error('去程按钮点击超时'), {
          code: 'outbound_click_timeout',
          stage: 'outbound_select',
        });
      }
      return [returnCard(3600)];
    },
  };

  const result = await collectItineraries({
    queries: [queries[1]],
    session,
    timeoutMs: 1000,
  });

  assert.deepEqual(attempts, ['AB1235', 'AB1236']);
  assert.equal(result.itineraries.length, 1);
  assert.equal(result.itineraries[0].total_price, 3600);
  assert.deepEqual(result.scans, [{ date: '2026-10-01', status: 'failed' }]);
  assert.equal(result.errors[0].code, 'outbound_click_timeout');
});

test('preserves the completed date when the second date reaches the total deadline', async () => {
  const session = {
    async listOutbounds(query) {
      if (query.depart_date === '2026-10-01') return new Promise(() => {});
      return [outbound(query.depart_date, 'AB1234', '21:00')];
    },
    async listReturns() {
      return [returnCard(3600)];
    },
  };
  const result = await collectItineraries({ queries, session, timeoutMs: 100 });
  assert.deepEqual(result.scans.map((scan) => scan.status), ['completed', 'failed']);
  assert.equal(result.itineraries[0].total_price, 3600);
  assert.equal(result.errors[0].code, 'run_timeout');
});

test('logs date, candidate progress, accepted returns and elapsed time', async () => {
  const logs = [];
  let currentTime = 0;
  await collectItineraries({
    queries: [queries[1]],
    session: {
      async listOutbounds() {
        return [outbound('2026-10-01', 'AB1235', '18:00')];
      },
      async listReturns() {
        return [returnCard()];
      },
    },
    timeoutMs: 1000,
    logger: (line) => logs.push(line),
    now: () => {
      currentTime += 100;
      return currentTime;
    },
  });
  assert.equal(
    logs.some((line) => line.includes('[2026-10-01] 合格去程 1，选取 1')),
    true,
  );
  assert.equal(logs.some((line) => line.includes('候选 1/1 AB1235')), true);
  assert.equal(logs.some((line) => line.includes('有效返程 1')), true);
  assert.equal(logs.some((line) => line.includes('日期完成')), true);
});

test('creates one page for the whole collection', async () => {
  let pageCount = 0;
  const page = {};
  const browser = {
    async newPage() {
      pageCount += 1;
      return page;
    },
    async close() {},
  };
  await collectFromCtrip({
    queries: [],
    launchBrowser: async () => browser,
    createSession: ({ page: requestedPage }) => {
      assert.equal(requestedPage, page);
      return {};
    },
    logger: () => {},
  });
  assert.equal(pageCount, 1);
});

test('requests a macOS background browser before creating the page', async () => {
  const events = [];
  const browser = {
    async newPage() {
      events.push('page');
      return {};
    },
    async close() {
      events.push('close');
    },
  };
  await collectFromCtrip({
    queries: [],
    platform: 'darwin',
    environment: { FLIGHT_MONITOR_HEADLESS: 'false' },
    launchBrowser: async (options) => {
      events.push(['launch', options]);
      return browser;
    },
    createSession: () => ({}),
    logger: () => {},
  });
  assert.deepEqual(events.slice(0, 2), [
    ['launch', { headless: false, platform: 'darwin' }],
    'page',
  ]);
});
