import { collectFromCtrip } from './collector.js';
import { runCollection } from './run.js';

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

function shanghaiIso(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .replace('Z', '+08:00');
}

const result = await runCollection({
  collect: ({ queries: requestedQueries }) => collectFromCtrip({
    queries: requestedQueries,
    artifactDir: 'artifacts',
    timeoutMs: 600_000,
  }),
  queries,
  checkedAt: shanghaiIso(),
  latestPath: 'data/latest.json',
  historyPath: 'data/history.json',
});

if (!result.ok) {
  const errors = result.errors
    .map((error) => `${error.code}:${error.message}`)
    .join('; ');
  console.error(`${result.status}: ${errors}`);
  process.exitCode = 1;
}
