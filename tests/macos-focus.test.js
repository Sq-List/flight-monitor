import assert from 'node:assert/strict';
import test from 'node:test';

import {
  launchVisibleChromiumInBackground,
} from '../src/macos-focus.js';

test('reuses a dedicated Chromium profile and its default context', async () => {
  const events = [];
  const persistentContext = {
    async newPage() {
      events.push(['persistent-page']);
      return { id: 'persistent-page' };
    },
  };
  const connectedBrowser = {
    async newBrowserCDPSession() {
      return {
        async send(method) {
          events.push(['send', method]);
        },
      };
    },
    async newContext(options) {
      events.push(['context', options]);
      return {
        async newPage() {
          events.push(['page']);
          return { id: 'page' };
        },
      };
    },
    contexts() {
      return [persistentContext];
    },
    async close() {
      events.push(['browser-close']);
    },
  };
  const browserType = {
    executablePath() {
      return '/cache/Chromium.app/Contents/MacOS/Chromium';
    },
    async connectOverCDP(endpoint) {
      events.push(['connect', endpoint]);
      return connectedBrowser;
    },
  };

  const browser = await launchVisibleChromiumInBackground({
    browserType,
    platform: 'darwin',
    profileDir: '/Users/test/Library/Application Support/flight-monitor/chromium-profile',
    ensureProfileDir: async (directory) => events.push(['ensure', directory]),
    waitForPort: async () => 9333,
    run: async (file, args) => {
      events.push(['run', file, args]);
      if (file === '/usr/bin/pgrep') {
        throw Object.assign(new Error('no matching process'), { code: 1 });
      }
    },
    remove: async (file, options) => events.push(['remove', file, options]),
    sleep: async () => events.push(['sleep']),
  });
  const page = await browser.newPage({ locale: 'zh-CN' });
  await browser.close();

  const launch = events.find(
    (event) => event[0] === 'run' && event[1] === 'open',
  );
  assert.equal(launch[1], 'open');
  assert.deepEqual(launch[2].slice(0, 5), [
    '-g',
    '-n',
    '-a',
    '/cache/Chromium.app',
    '--args',
  ]);
  assert.equal(launch[2].includes('--remote-debugging-port=0'), true);
  assert.equal(
    launch[2].includes('--user-data-dir=/Users/test/Library/Application Support/flight-monitor/chromium-profile'),
    true,
  );
  assert.deepEqual(events.find((event) => event[0] === 'ensure'), [
    'ensure',
    '/Users/test/Library/Application Support/flight-monitor/chromium-profile',
  ]);
  const openIndex = events.findIndex(
    (event) => event[0] === 'run' && event[1] === 'open',
  );
  const firstPkillIndex = events.findIndex(
    (event) => event[0] === 'run' && event[1] === '/usr/bin/pkill',
  );
  assert.equal(firstPkillIndex < openIndex, true);
  assert.deepEqual(events.find((event) => event[0] === 'connect'), [
    'connect',
    'http://127.0.0.1:9333',
  ]);
  assert.deepEqual(page, { id: 'persistent-page' });
  assert.equal(events.some((event) => event[0] === 'context'), false);
  assert.deepEqual(
    events.find((event) => event[0] === 'send'),
    ['send', 'Browser.close'],
  );
  assert.equal(
    events.filter((event) => event[0] === 'run' && event[1] === '/usr/bin/pkill').length,
    2,
  );
  assert.equal(
    events.filter((event) => event[0] === 'run' && event[1] === '/usr/bin/pgrep').length,
    2,
  );
  assert.equal(events.filter((event) => event[0] === 'remove').length, 2);
});

test('cleans the dedicated Chromium profile when CDP connection fails', async () => {
  const events = [];
  const expected = Object.assign(new Error('connect refused'), {
    code: 'ECONNREFUSED',
  });
  const profileDir = '/Users/test/Library/Application Support/flight-monitor/chromium-profile';

  await assert.rejects(
    launchVisibleChromiumInBackground({
      browserType: {
        executablePath() {
          return '/cache/Chromium.app/Contents/MacOS/Chromium';
        },
        async connectOverCDP() {
          throw expected;
        },
      },
      platform: 'darwin',
      profileDir,
      ensureProfileDir: async () => {},
      waitForPort: async () => 9333,
      run: async (file, args) => {
        events.push(['run', file, args]);
        if (file === '/usr/bin/pgrep') {
          throw Object.assign(new Error('no matching process'), { code: 1 });
        }
      },
      remove: async (file, options) => events.push(['remove', file, options]),
      sleep: async () => {},
    }),
    expected,
  );

  assert.equal(
    events.filter((event) => event[0] === 'run' && event[1] === '/usr/bin/pkill').length,
    2,
  );
  assert.equal(events.filter((event) => event[0] === 'remove').length, 2);
});

test('uses regular visible Playwright launch outside macOS', async () => {
  const expected = { id: 'browser' };
  const browserType = {
    async launch(options) {
      assert.deepEqual(options, { headless: false });
      return expected;
    },
  };
  assert.equal(await launchVisibleChromiumInBackground({
    browserType,
    platform: 'linux',
  }), expected);
});
