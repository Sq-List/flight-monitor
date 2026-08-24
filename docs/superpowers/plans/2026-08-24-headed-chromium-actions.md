# Headed Chromium Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Ctrip collector in visible Chromium mode under a GitHub Actions virtual display, then verify whether the cloud runner can collect a positive fare.

**Architecture:** Keep the collector and JSON contracts unchanged. A task-specific environment variable selects Playwright headless mode; GitHub Actions sets visible mode and launches the collector through `xvfb-run`, while all other callers retain the current headless default.

**Tech Stack:** Node.js 22, Playwright, Node test runner, GitHub Actions, Xvfb

---

### Task 1: Make Chromium headless mode configurable

**Files:**
- Modify: `tests/collector.test.js:6-10`
- Modify: `tests/collector.test.js:48-59`
- Modify: `src/collector.js:7-12`
- Modify: `src/collector.js:66`

- [ ] **Step 1: Write failing environment-mode tests**

Add `headlessFromEnvironment` to the import from `src/collector.js`:

```js
import {
  buildSearchUrl,
  classifyPageState,
  extractCardChunks,
  headlessFromEnvironment,
} from '../src/collector.js';
```

Add these tests before the DOM extraction test:

```js
test('uses headless Chromium by default', () => {
  assert.equal(headlessFromEnvironment({}), true);
});

test('uses visible Chromium only when explicitly disabled', () => {
  assert.equal(
    headlessFromEnvironment({ FLIGHT_MONITOR_HEADLESS: 'false' }),
    false,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/collector.test.js
```

Expected: FAIL because `src/collector.js` does not export `headlessFromEnvironment`.

- [ ] **Step 3: Implement the minimal environment parser**

Add after `collectionError` in `src/collector.js`:

```js
// 只有任务明确关闭无头模式时才显示浏览器，其他调用保持现有默认行为。
export function headlessFromEnvironment(environment = process.env) {
  return environment.FLIGHT_MONITOR_HEADLESS !== 'false';
}
```

Replace the browser launch call with:

```js
browser = await chromium.launch({ headless: headlessFromEnvironment() });
```

- [ ] **Step 4: Run focused and complete tests and verify GREEN**

Run:

```bash
npm test -- tests/collector.test.js
npm test
node --check src/collector.js
git diff --check -- src/collector.js tests/collector.test.js
```

Expected: 7 collector tests pass, 13 total tests pass, and syntax and whitespace checks are silent.

- [ ] **Step 5: Commit only collector code and tests**

Run:

```bash
git add src/collector.js tests/collector.test.js
git commit -m "fix: support visible chromium collection"
```

Expected: the commit excludes `data/latest.json` and `data/history.json`.

### Task 2: Run visible Chromium under Xvfb in GitHub Actions

**Files:**
- Modify: `.github/workflows/collect.yml:36-39`
- Modify: `README.md:5-7`

- [ ] **Step 1: Configure the collection step for visible Chromium**

Replace the collection step in `.github/workflows/collect.yml` with:

```yaml
      - name: Collect fares
        id: collect
        continue-on-error: true
        env:
          FLIGHT_MONITOR_HEADLESS: 'false'
        run: xvfb-run --auto-servernum npm run collect
```

The preceding `npx playwright install --with-deps chromium` step installs Chromium and the Linux browser runtime dependencies needed by the job.

- [ ] **Step 2: Update the current-state documentation**

Replace the paragraph under `README.md` heading `## 当前状态` with:

```markdown
GitHub Actions 已配置为在虚拟显示器中运行可见模式 Chromium，避免本地验证中无头模式触发的 `whaleguard block`。当前仍只支持手动运行；最新采集结果以 [`data/latest.json`](data/latest.json) 为准，连续验证稳定后再启用定时计划。
```

- [ ] **Step 3: Validate workflow and repository tests**

Run:

```bash
/bin/zsh -ic 'proxy >/dev/null 2>&1; go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/collect.yml'
npm test
git diff --check -- .github/workflows/collect.yml README.md
```

Expected: actionlint is silent, 13 tests pass, and the whitespace check is silent.

- [ ] **Step 4: Commit only workflow and documentation**

Run:

```bash
git add .github/workflows/collect.yml README.md
git commit -m "ci: collect fares with visible chromium"
```

Expected: the commit excludes `data/latest.json` and `data/history.json`.

### Task 3: Push and verify the cloud collection

**Files:**
- Verify: `.github/workflows/collect.yml`
- Verify remotely: `data/latest.json`
- Verify remotely: `data/history.json`

- [ ] **Step 1: Run final local verification without staging A/B data**

Run:

```bash
npm test
/bin/zsh -ic 'proxy >/dev/null 2>&1; go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/collect.yml'
git diff --check
git status --short --branch
```

Expected: 13 tests pass; the branch is ahead of `origin/main`; only the Mac A/B results in `data/latest.json` and `data/history.json` remain modified and unstaged.

- [ ] **Step 2: Push the two implementation commits**

First verify GitHub connectivity through the configured proxy, then run:

```bash
/bin/zsh -ic 'proxy >/dev/null 2>&1; git push origin main'
```

Expected: the design, collector, workflow, and README commits reach `Sq-List/flight-monitor` without pushing local A/B data.

- [ ] **Step 3: Trigger the manual workflow**

Run:

```bash
/bin/zsh -ic 'proxy >/dev/null 2>&1; gh workflow run collect.yml --repo Sq-List/flight-monitor --ref main'
/bin/zsh -ic 'proxy >/dev/null 2>&1; gh run list --repo Sq-List/flight-monitor --workflow collect.yml --limit 1 --json databaseId,status,conclusion,url,createdAt'
```

Expected: a new `workflow_dispatch` run appears with a new run ID.

- [ ] **Step 4: Wait for the workflow result**

Resolve the newest run ID and wait for it:

```bash
flight_run_id="$(/bin/zsh -ic 'proxy >/dev/null 2>&1; gh run list --repo Sq-List/flight-monitor --workflow collect.yml --limit 1 --json databaseId --jq ".[0].databaseId"')"
/bin/zsh -ic "proxy >/dev/null 2>&1; gh run watch \"$flight_run_id\" --repo Sq-List/flight-monitor --exit-status"
```

Expected on success: unit tests, visible Chromium collection, and data commit all pass. Expected on a real Ctrip block: the workflow fails only after persisting the typed failure and uploading diagnostics.

- [ ] **Step 5: Verify public result data**

Run:

```bash
/bin/zsh -ic 'proxy >/dev/null 2>&1; gh api -X GET repos/Sq-List/flight-monitor/contents/data/latest.json -H "Accept: application/vnd.github.raw+json"'
/bin/zsh -ic 'proxy >/dev/null 2>&1; gh api -X GET repos/Sq-List/flight-monitor/contents/data/history.json -H "Accept: application/vnd.github.raw+json"'
```

Success criteria:

- `latest.status` is `success`.
- `latest.current.best_price` is a positive CNY amount.
- `latest.current.quotes` contains at least one parsed flight card.
- `history.json` contains the matching successful run.

If collection still fails, inspect only the failed logs and the `ctrip-failure` artifact. Preserve the failure result and conclude that GitHub's network environment remains an independent block; do not fabricate or seed a fare.
