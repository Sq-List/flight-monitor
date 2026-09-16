import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCollection } from '../src/run.js';

const queries = [{
  from: 'URC',
  to: 'HGH',
  depart_date: '2026-10-08',
}];

async function stateFiles() {
  const dir = await mkdtemp(join(tmpdir(), 'flight-monitor-'));
  const latestPath = join(dir, 'latest.json');
  const historyPath = join(dir, 'history.json');
  await writeFile(latestPath, JSON.stringify({ last_success: null }), 'utf8');
  await writeFile(historyPath, '[]', 'utf8');
  return { latestPath, historyPath };
}

test('persists a schema v3 successful return scan', async () => {
  const paths = await stateFiles();
  const result = await runCollection({
    collect: async () => ({
      scans: [{ date: '2026-10-08', status: 'completed' }],
      flights: [],
      errors: [],
    }),
    queries,
    checkedAt: '2026-09-16T10:30:00+08:00',
    ...paths,
  });
  const latest = JSON.parse(await readFile(paths.latestPath, 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(latest.schema_version, 3);
  assert.equal(latest.collection_scope, 'return_one_way');
  assert.equal(latest.current.availability, 'none');
});

test('turns a collector crash into one failed return scan', async () => {
  const paths = await stateFiles();
  const result = await runCollection({
    collect: async () => {
      throw Object.assign(new Error('浏览器启动失败'), {
        code: 'browser_launch',
        stage: 'flight_list',
      });
    },
    queries,
    checkedAt: '2026-09-16T18:30:00+08:00',
    ...paths,
  });
  const latest = JSON.parse(await readFile(paths.latestPath, 'utf8'));
  assert.equal(result.status, 'failed');
  assert.deepEqual(latest.scans, [{ date: '2026-10-08', status: 'failed' }]);
  assert.equal(latest.errors[0].code, 'browser_launch');
  assert.equal(latest.errors[0].stage, 'flight_list');
});
