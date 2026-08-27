# Chromium Tab Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent restored Chromium tabs and slow browser shutdown from turning a complete Ctrip collection into a failed run.

**Architecture:** Keep the dedicated persistent profile for login state, but clear its restored pages after CDP connection and give Chromium a graceful shutdown window before terminating only the dedicated process. Treat cleanup as complete only after the dedicated process is gone and always remove the stale CDP port file.

**Tech Stack:** Node.js, Playwright CDP, macOS `open`/`pgrep`/`pkill`, Node test runner

---

### Task 1: Reproduce restored tabs and slow graceful exit

**Files:**
- Modify: `tests/macos-focus.test.js`
- Test: `tests/macos-focus.test.js`

- [ ] **Step 1: Add a failing restored-page test**

Change the persistent-context fixture so `pages()` initially exposes two restored pages whose `close()` methods record `restored-close` events. After `launchVisibleChromiumInBackground()` returns, assert both restored pages were closed before the collector calls `newPage()`.

```js
const restoredPages = ['old-1', 'old-2'].map((id) => ({
  async close() {
    events.push(['restored-close', id]);
  },
}));
const persistentContext = {
  pages() {
    return restoredPages;
  },
  async newPage() {
    events.push(['persistent-page']);
    return { id: 'persistent-page', async close() {} };
  },
};

assert.deepEqual(
  events.filter((event) => event[0] === 'restored-close'),
  [['restored-close', 'old-1'], ['restored-close', 'old-2']],
);
```

- [ ] **Step 2: Add a failing slow-exit test**

Simulate a process that remains visible to `pgrep` twice after `Browser.close`, then exits. Assert close succeeds, sleeps twice, and does not issue a second `pkill` after the startup cleanup.

```js
let closing = false;
let closePolls = 0;
// Browser.close sets closing=true. During close, pgrep succeeds twice and then
// exits with code 1. Before launch, pgrep exits with code 1 immediately.
assert.equal(closePolls, 3);
assert.equal(
  events.filter((event) => event[0] === 'run' && event[1] === '/usr/bin/pkill').length,
  1,
);
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `node --test tests/macos-focus.test.js`

Expected: FAIL because restored pages are not closed and the current close path immediately calls `pkill` instead of waiting for graceful exit.

- [ ] **Step 4: Commit the failing tests**

```bash
git add tests/macos-focus.test.js
git commit -m "test(collector): cover Chromium tab lifecycle"
```

### Task 2: Implement one-page startup and graceful shutdown

**Files:**
- Modify: `src/macos-focus.js:20-149`
- Test: `tests/macos-focus.test.js`

- [ ] **Step 1: Make process waiting report timeout without throwing**

Update the wait helper to return `true` once no dedicated process exists and `false` after 15 seconds. This lets the normal close path decide whether forced cleanup is necessary.

```js
async function waitForDedicatedChromiumExit(profileDir, {
  run,
  sleep,
  attempts = 150,
}) {
  const processPattern = `--user-data-dir=${profileDir}`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await run('/usr/bin/pgrep', ['-f', '--', processPattern]);
    } catch (error) {
      if (error?.code === 1) return true;
      throw error;
    }
    await sleep(100);
  }
  return false;
}
```

- [ ] **Step 2: Make forced cleanup always remove the port file**

Wrap process termination and waiting in `try/finally`. Throw only when the dedicated process remains after forced cleanup.

```js
async function cleanupDedicatedChromium(profileDir, { run, remove, sleep }) {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  try {
    try {
      await run('/usr/bin/pkill', ['-f', '--', `--user-data-dir=${profileDir}`]);
    } catch (error) {
      if (error?.code !== 1) throw error;
    }
    if (!await waitForDedicatedChromiumExit(profileDir, { run, sleep })) {
      throw new Error('采集器专用 Chromium 清理后仍未退出');
    }
  } finally {
    await remove(portFile, { force: true });
  }
}
```

- [ ] **Step 3: Close restored pages after connecting**

After resolving the persistent context, close every restored page before returning the browser wrapper.

```js
await Promise.all(
  context.pages().map((page) => page.close().catch(() => {})),
);
```

- [ ] **Step 4: Wait gracefully before forced cleanup**

On close, close context pages, send `Browser.close`, disconnect Playwright, and wait up to 15 seconds. Call forced cleanup only if the dedicated process remains; otherwise only remove the port file.

```js
async close() {
  await Promise.all(context.pages().map((page) => page.close().catch(() => {})));
  try {
    const cdpSession = await connectedBrowser.newBrowserCDPSession();
    await cdpSession.send('Browser.close');
  } catch {
    // 后续以专用进程是否退出为准。
  } finally {
    await connectedBrowser.close().catch(() => {});
  }

  if (!await waitForDedicatedChromiumExit(profileDir, { run, sleep })) {
    await cleanupProfile();
  } else {
    await remove(path.join(profileDir, 'DevToolsActivePort'), { force: true });
  }
}
```

- [ ] **Step 5: Run focused and full tests**

Run: `node --test tests/macos-focus.test.js`

Expected: all focused tests PASS.

Run: `npm test`

Expected: all repository tests PASS with no failures.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/macos-focus.js tests/macos-focus.test.js
git commit -m "fix(collector): close restored Chromium tabs"
```

### Task 3: Release and collect verified data

**Files:**
- Modify: `data/latest.json`
- Modify: `data/history.json`
- Runtime repository: `/Users/sqlist/Library/Application Support/flight-monitor/repo`

- [ ] **Step 1: Push the tested code commits**

Verify GitHub connectivity through the configured proxy, fetch `origin/main`, rebase local `main`, rerun `npm test`, then push without force.

Expected: GitHub `main` points to the tested lifecycle-fix commit.

- [ ] **Step 2: Update the Mac runtime repository**

Discard only the two uncommitted generated failure records from `data/latest.json` and `data/history.json`, leaving all committed history intact. Fast-forward the runtime repository to `origin/main`, then run `npm test` there.

Expected: runtime tests PASS and the working tree is clean before collection.

- [ ] **Step 3: Run one visible background collection**

Run: `FLIGHT_MONITOR_HEADLESS=false npm run collect`

Expected: exit code 0; 2026-09-30 and 2026-10-01 scans complete; the result contains ranked complete round-trip itineraries.

- [ ] **Step 4: Validate browser and data state**

Confirm all of the following:

```text
data/latest.json status is success
data/latest.json current contains at least one itinerary
each itinerary has both outbound and return legs and a positive total_price
no process uses the dedicated chromium-profile
DevToolsActivePort does not exist
```

- [ ] **Step 5: Commit and push only collection data**

```bash
git add data/latest.json data/history.json
git commit -m "data: record local ctrip collection"
git push origin main
```

Expected: GitHub `main`, the runtime repository, and the development repository point to the data commit; no `.DS_Store` is staged.
