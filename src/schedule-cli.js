import { readFile } from 'node:fs/promises';

import { shouldCollect } from './schedule.js';

const latestPath = process.argv[2] ?? 'data/latest.json';

if (process.env.FLIGHT_MONITOR_FORCE === 'true') {
  console.log('collect');
} else {
  let checkedAt = null;
  try {
    const latest = JSON.parse(await readFile(latestPath, 'utf8'));
    checkedAt = latest.checked_at ?? null;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  console.log(shouldCollect({ checkedAt }) ? 'collect' : 'skip');
}
