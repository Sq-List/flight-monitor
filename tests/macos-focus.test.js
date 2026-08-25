import assert from 'node:assert/strict';
import test from 'node:test';

import {
  launchVisibleChromiumInBackground,
} from '../src/macos-focus.js';

test('opens a separate Chromium in the macOS background and connects over CDP', async () => {
  const events = [];
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
    makeTempDir: async () => '/tmp/flight-monitor-profile',
    waitForPort: async () => 9333,
    run: async (file, args) => events.push(['run', file, args]),
    removeDir: async (directory) => events.push(['remove', directory]),
  });
  const page = await browser.newPage({ locale: 'zh-CN' });
  await browser.close();

  const launch = events.find((event) => event[0] === 'run');
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
    launch[2].includes('--user-data-dir=/tmp/flight-monitor-profile'),
    true,
  );
  assert.deepEqual(events.find((event) => event[0] === 'connect'), [
    'connect',
    'http://127.0.0.1:9333',
  ]);
  assert.deepEqual(page, { id: 'page' });
  assert.deepEqual(
    events.find((event) => event[0] === 'send'),
    ['send', 'Browser.close'],
  );
  assert.deepEqual(events.at(-1), ['remove', '/tmp/flight-monitor-profile']);
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
