import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCollection } from '../src/run.js';

const query = {
  from: 'HGH',
  to: 'URC',
  depart_date: '2026-10-01',
  return_date: '2026-10-08',
};

async function stateFiles() {
  const dir = await mkdtemp(join(tmpdir(), 'flight-monitor-'));
  const latestPath = join(dir, 'latest.json');
  const historyPath = join(dir, 'history.json');
  await writeFile(latestPath, JSON.stringify({ last_success: null }), 'utf8');
  await writeFile(historyPath, '[]', 'utf8');
  return { latestPath, historyPath };
}

test('persists successful quotes', async () => {
  const paths = await stateFiles();
  const result = await runCollection({
    collect: async () => [{ rank: 1, airline: '乌鲁木齐航空', price: 3538, currency: 'CNY' }],
    query,
    checkedAt: '2026-08-24T07:30:00+08:00',
    ...paths,
  });
  const latest = JSON.parse(await readFile(paths.latestPath, 'utf8'));

  assert.equal(result.ok, true);
  assert.equal(latest.current.best_price, 3538);
});

test('persists a typed collection failure and returns a failed result', async () => {
  const paths = await stateFiles();
  const result = await runCollection({
    collect: async () => { throw Object.assign(new Error('验证码'), { code: 'captcha' }); },
    query,
    checkedAt: '2026-08-24T13:30:00+08:00',
    ...paths,
  });
  const latest = JSON.parse(await readFile(paths.latestPath, 'utf8'));

  assert.equal(result.ok, false);
  assert.deepEqual(latest.error, { code: 'captcha', message: '验证码' });
});
