import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryPath = '/Users/sqlist/Project/other/flight-monitor';
const oldRepositoryPath = '/Users/sqlist/Library/Application Support/flight-monitor/repo';

test('macOS runner defaults to the single repository path', async () => {
  const script = await readFile('scripts/run-macos.sh', 'utf8');
  assert.equal(script.includes(repositoryPath), true);
  assert.equal(script.includes(oldRepositoryPath), false);
});

test('launch agent runs from the single repository path', async () => {
  const plist = await readFile('macos/com.sqlist.flight-monitor.plist', 'utf8');
  assert.equal(
    plist.includes(`${repositoryPath}/scripts/run-macos.sh`),
    true,
  );
  assert.equal(plist.includes(`<string>${repositoryPath}</string>`), true);
  assert.equal(plist.includes(oldRepositoryPath), false);
});
