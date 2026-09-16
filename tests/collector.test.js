import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSearchUrl,
  collectFromCtrip,
  collectReturnFlights,
  headlessFromEnvironment,
  launchBrowserForCollection,
} from '../src/collector.js';

const query = {
  from: 'URC',
  to: 'HGH',
  depart_date: '2026-10-08',
};

function flight(overrides = {}) {
  return {
    date: '2026-10-08',
    airline: '测试航空',
    flight_no: 'AB5678',
    departure_time: '08:00',
    departure_airport: '乌鲁木齐天山国际机场',
    arrival_time: '15:00',
    arrival_airport: '杭州萧山国际机场',
    service_type: 'direct',
    stops: [],
    signature: 'AB5678|08:00|15:00',
    price: 1880,
    price_text: '¥1880起',
    price_scope: 'flight_starting_price',
    currency: 'CNY',
    ...overrides,
  };
}

test('builds the exact Ctrip one-way return URL', () => {
  assert.equal(
    buildSearchUrl(query),
    'https://flights.ctrip.com/online/list/oneway-urc-hgh?depdate=2026-10-08&cabin=Y_S_C_F&adult=1&child=0&infant=0',
  );
});

test('uses headless Chromium by default', () => {
  assert.equal(headlessFromEnvironment({}), true);
});

test('uses visible Chromium only when explicitly disabled', () => {
  assert.equal(headlessFromEnvironment({ FLIGHT_MONITOR_HEADLESS: 'false' }), false);
});

test('uses the logged-in browser profile on the home Wi-Fi', async () => {
  const expected = { id: 'logged-in-browser' };
  assert.equal(await launchBrowserForCollection({
    headless: false,
    platform: 'darwin',
    getWifiSsid: async () => 'gogogo',
    launchLoggedInBrowser: async () => expected,
    launchAnonymousBrowser: async () => {
      throw new Error('should not use anonymous browser');
    },
  }), expected);
});

test('uses an anonymous browser profile away from the home Wi-Fi', async () => {
  const expected = { id: 'anonymous-browser' };
  assert.equal(await launchBrowserForCollection({
    headless: false,
    platform: 'darwin',
    getWifiSsid: async () => 'company-wifi',
    launchLoggedInBrowser: async () => {
      throw new Error('should not use logged-in browser');
    },
    launchAnonymousBrowser: async () => expected,
  }), expected);
});

test('uses an anonymous browser profile when Wi-Fi cannot be identified', async () => {
  const expected = { id: 'anonymous-browser' };
  assert.equal(await launchBrowserForCollection({
    headless: false,
    platform: 'darwin',
    getWifiSsid: async () => null,
    launchLoggedInBrowser: async () => {
      throw new Error('should not use logged-in browser');
    },
    launchAnonymousBrowser: async () => expected,
  }), expected);
});

test('collects one return date and ranks eligible one-way prices', async () => {
  const calls = [];
  const result = await collectReturnFlights({
    queries: [query],
    session: {
      async listFlights(requestedQuery) {
        calls.push(requestedQuery);
        return [
          flight({ flight_no: 'AB5679', price: 1990, price_text: '¥1990起' }),
          flight({ flight_no: 'AB5680', arrival_time: '18:01', price: 1700, price_text: '¥1700起' }),
          flight({ flight_no: 'AB5681', service_type: 'transfer', price: 1600, price_text: '¥1600起' }),
          flight(),
        ];
      },
    },
    timeoutMs: 1000,
  });

  assert.deepEqual(calls, [query]);
  assert.deepEqual(result.scans, [{ date: '2026-10-08', status: 'completed' }]);
  assert.deepEqual(result.flights.map((item) => item.price), [1880, 1990]);
  assert.equal(result.flights[0].signature, undefined);
});

test('records a captcha as a failed return scan', async () => {
  const result = await collectReturnFlights({
    queries: [query],
    session: {
      async listFlights() {
        throw Object.assign(new Error('验证码'), {
          code: 'captcha',
          stage: 'flight_list',
        });
      },
    },
    timeoutMs: 1000,
  });

  assert.deepEqual(result.scans, [{ date: '2026-10-08', status: 'failed' }]);
  assert.equal(result.flights.length, 0);
  assert.equal(result.errors[0].code, 'captcha');
});

test('logs the return card and accepted counts', async () => {
  const logs = [];
  await collectReturnFlights({
    queries: [query],
    session: { async listFlights() { return [flight()]; } },
    timeoutMs: 1000,
    logger: (line) => logs.push(line),
  });

  assert.equal(logs.some((line) => line.includes('航班卡片 1，合格返程 1')), true);
  assert.equal(logs.some((line) => line.includes('整轮完成') && line.includes('合格返程 1')), true);
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
