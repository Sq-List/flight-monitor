import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCollection } from '../src/run.js';

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

async function stateFiles() {
  const dir = await mkdtemp(join(tmpdir(), 'flight-monitor-'));
  const latestPath = join(dir, 'latest.json');
  const historyPath = join(dir, 'history.json');
  await writeFile(latestPath, JSON.stringify({ last_success: null }), 'utf8');
  await writeFile(historyPath, '[]', 'utf8');
  return { latestPath, historyPath };
}

test('persists a schema v2 successful scan', async () => {
  const paths = await stateFiles();
  const result = await runCollection({
    collect: async () => ({
      scans: queries.map((query) => ({
        date: query.depart_date,
        status: 'completed',
      })),
      itineraries: [],
      errors: [],
    }),
    queries,
    checkedAt: '2026-08-25T10:30:00+08:00',
    ...paths,
  });
  const latest = JSON.parse(await readFile(paths.latestPath, 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(latest.schema_version, 2);
  assert.equal(latest.current.availability, 'none');
});

test('persists partial data and returns a non-success result', async () => {
  const paths = await stateFiles();
  const result = await runCollection({
    collect: async () => ({
      scans: [
        { date: '2026-09-30', status: 'failed' },
        { date: '2026-10-01', status: 'completed' },
      ],
      itineraries: [],
      errors: [{
        date: '2026-09-30',
        stage: 'outbound_list',
        code: 'captcha',
        message: '验证码',
      }],
    }),
    queries,
    checkedAt: '2026-08-25T14:30:00+08:00',
    ...paths,
  });
  const latest = JSON.parse(await readFile(paths.latestPath, 'utf8'));
  assert.equal(result.ok, false);
  assert.equal(result.status, 'partial');
  assert.equal(latest.errors[0].code, 'captcha');
});

test('turns a collector crash into two failed scans', async () => {
  const paths = await stateFiles();
  const result = await runCollection({
    collect: async () => {
      throw Object.assign(new Error('浏览器启动失败'), {
        code: 'browser_launch',
        stage: 'outbound_list',
      });
    },
    queries,
    checkedAt: '2026-08-25T18:30:00+08:00',
    ...paths,
  });
  const latest = JSON.parse(await readFile(paths.latestPath, 'utf8'));
  assert.equal(result.status, 'failed');
  assert.deepEqual(latest.scans.map((scan) => scan.status), ['failed', 'failed']);
  assert.equal(latest.errors[0].code, 'browser_launch');
});
