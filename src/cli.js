import { collectQuotes } from './collector.js';
import { runCollection } from './run.js';

const query = {
  from: 'HGH',
  to: 'URC',
  depart_date: '2026-10-01',
  return_date: '2026-10-08',
};

function shanghaiIso(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .replace('Z', '+08:00');
}

const result = await runCollection({
  collect: ({ query: requestedQuery }) => collectQuotes({
    query: requestedQuery,
    artifactDir: 'artifacts',
  }),
  query,
  checkedAt: shanghaiIso(),
  latestPath: 'data/latest.json',
  historyPath: 'data/history.json',
});

if (!result.ok) {
  console.error(`${result.error.code}: ${result.error.message}`);
  process.exitCode = 1;
}
