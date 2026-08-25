import { readFile, writeFile } from 'node:fs/promises';

import { buildNextState } from './state.js';

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// 执行一次采集并持久化结果；采集失败也必须写入历史和最新状态。
export async function runCollection({
  collect,
  queries,
  checkedAt,
  latestPath,
  historyPath,
}) {
  const previousLatest = await readJson(latestPath, null);
  const history = await readJson(historyPath, []);
  let collection;

  try {
    collection = await collect({ queries });
  } catch (error) {
    collection = {
      scans: queries.map((query) => ({
        date: query.depart_date,
        status: 'failed',
      })),
      itineraries: [],
      errors: [{
        date: null,
        stage: error?.stage ?? 'outbound_list',
        code: error?.code ?? 'unexpected',
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }

  const next = buildNextState({
    previousLatest,
    history,
    queries,
    checkedAt,
    collection,
  });
  await writeJson(latestPath, next.latest);
  await writeJson(historyPath, next.history);
  return {
    ok: next.latest.status === 'success',
    status: next.latest.status,
    errors: next.latest.errors,
  };
}
