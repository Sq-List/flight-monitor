import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldCollect } from '../src/schedule.js';

const now = new Date('2026-08-24T18:30:00+08:00');

test('collects when no previous timestamp exists', () => {
  assert.equal(shouldCollect({ checkedAt: null, now }), true);
});

test('skips when the previous collection is less than two hours old', () => {
  assert.equal(shouldCollect({
    checkedAt: '2026-08-24T17:00:01+08:00',
    now,
  }), false);
});

test('collects when the previous collection is exactly two hours old', () => {
  assert.equal(shouldCollect({
    checkedAt: '2026-08-24T16:30:00+08:00',
    now,
  }), true);
});

test('collects when the previous timestamp is invalid', () => {
  assert.equal(shouldCollect({ checkedAt: 'invalid', now }), true);
});

test('skips a future timestamp to avoid rapid retries after clock drift', () => {
  assert.equal(shouldCollect({
    checkedAt: '2026-08-24T19:00:00+08:00',
    now,
  }), false);
});
