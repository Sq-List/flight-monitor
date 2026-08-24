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
  query,
  checkedAt,
  latestPath,
  historyPath,
}) {
  const previousLatest = await readJson(latestPath, null);
  const history = await readJson(historyPath, []);
  let quotes = null;
  let error = null;

  try {
    quotes = await collect({ query });
  } catch (caught) {
    error = {
      code: caught?.code ?? 'unexpected',
      message: caught instanceof Error ? caught.message : String(caught),
    };
  }

  const next = buildNextState({ previousLatest, history, query, checkedAt, quotes, error });
  await writeJson(latestPath, next.latest);
  await writeJson(historyPath, next.history);
  return { ok: error === null, error };
}
