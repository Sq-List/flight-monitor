# Single Repository Path Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/Users/sqlist/Project/other/flight-monitor` the only flight-monitor code repository used for both development and scheduled collection.

**Architecture:** Update the repository-owned runtime paths first and publish them to `main`, then stop launchd and move the verified production repository in place. Reload launchd from the new path, validate it, and only then move the redundant Documents clone to Trash.

**Tech Stack:** Node.js test runner, zsh, Git, macOS launchd, property lists

---

### Task 1: Make the new repository path testable

**Files:**
- Create: `tests/macos-config.test.js`
- Modify: `scripts/run-macos.sh:4`
- Modify: `macos/com.sqlist.flight-monitor.plist:10-13`

- [ ] **Step 1: Write failing configuration tests**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryPath = '/Users/sqlist/Project/other/flight-monitor';
const oldRepositoryPath = '/Users/sqlist/Library/Application Support/flight-monitor/repo';

test('macOS runner defaults to the single repository path', async () => {
  const script = await readFile('scripts/run-macos.sh', 'utf8');
  assert.match(script, new RegExp(repositoryPath.replaceAll('/', '\\/')));
  assert.equal(script.includes(oldRepositoryPath), false);
});

test('launch agent runs from the single repository path', async () => {
  const plist = await readFile('macos/com.sqlist.flight-monitor.plist', 'utf8');
  assert.equal(plist.includes(`${repositoryPath}/scripts/run-macos.sh`), true);
  assert.equal(plist.includes(`<string>${repositoryPath}</string>`), true);
  assert.equal(plist.includes(oldRepositoryPath), false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/macos-config.test.js`

Expected: FAIL because both tracked configuration files still contain the old Application Support repository path.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/macos-config.test.js
git commit -m "test(macos): cover single repository path"
```

- [ ] **Step 4: Update the runner default path**

Change `scripts/run-macos.sh` to:

```zsh
repo_dir="${FLIGHT_MONITOR_REPO_DIR:-/Users/sqlist/Project/other/flight-monitor}"
```

- [ ] **Step 5: Update the LaunchAgent template**

Set `ProgramArguments[1]` to:

```xml
<string>/Users/sqlist/Project/other/flight-monitor/scripts/run-macos.sh</string>
```

Set `WorkingDirectory` to:

```xml
<string>/Users/sqlist/Project/other/flight-monitor</string>
```

- [ ] **Step 6: Run focused and full validation**

Run:

```bash
node --test tests/macos-config.test.js
npm test
/bin/zsh -n scripts/run-macos.sh
plutil -lint macos/com.sqlist.flight-monitor.plist
git diff --check
```

Expected: all tests pass, shell syntax is valid, and plist lint reports `OK`.

- [ ] **Step 7: Commit the path changes**

```bash
git add scripts/run-macos.sh macos/com.sqlist.flight-monitor.plist
git commit -m "fix(macos): use single repository path"
```

### Task 2: Publish and prepare the production repository

**Files:**
- Source repository: `/Users/sqlist/Documents/Codex/2026-08-24/referenced-chatgpt-conversation-this-is-an/work/flight-monitor`
- Production repository: `/Users/sqlist/Library/Application Support/flight-monitor/repo`

- [ ] **Step 1: Publish the migration commits**

Verify GitHub connectivity through the configured proxy, fetch `origin/main`, rebase local `main`, rerun `npm test`, and push without force.

Expected: local `main` and GitHub `main` point to the tested path-config commit.

- [ ] **Step 2: Confirm the production repository is safe to move**

Run read-only checks in the production repository:

```text
git status --short is empty
git branch --show-current is main
git rev-parse HEAD equals git rev-parse origin/main after pull
/Users/sqlist/Project/other/flight-monitor does not exist
```

- [ ] **Step 3: Fast-forward production and validate before moving**

Pull `origin/main` with the configured proxy, then run:

```bash
npm test
/bin/zsh -n scripts/run-macos.sh
plutil -lint macos/com.sqlist.flight-monitor.plist
```

Expected: all checks pass in the old production location before launchd is stopped.

### Task 3: Move production and reload launchd

**Files:**
- Move: `/Users/sqlist/Library/Application Support/flight-monitor/repo`
- To: `/Users/sqlist/Project/other/flight-monitor`
- Modify: `/Users/sqlist/Library/LaunchAgents/com.sqlist.flight-monitor.plist`

- [ ] **Step 1: Stop the scheduled service**

Boot out `gui/$(id -u)/com.sqlist.flight-monitor`, then verify no service with that label is running and no dedicated Chromium process is active.

Expected: launchd service absent and the dedicated browser profile has no process.

- [ ] **Step 2: Move the production repository**

Move the production repository to the already verified empty target path. Do not copy it and do not leave a symlink behind.

Expected:

```text
/Users/sqlist/Project/other/flight-monitor/.git exists
/Users/sqlist/Library/Application Support/flight-monitor/repo does not exist
```

- [ ] **Step 3: Update the installed LaunchAgent**

Replace only its two repository path values with:

```xml
<string>/Users/sqlist/Project/other/flight-monitor/scripts/run-macos.sh</string>
<string>/Users/sqlist/Project/other/flight-monitor</string>
```

Keep the existing schedule and log paths unchanged.

- [ ] **Step 4: Validate and reload launchd**

Run plist lint, bootstrap the agent in `gui/$(id -u)`, enable it, and inspect the loaded service.

Expected: `ProgramArguments[1]` and `WorkingDirectory` point to the new repository; stdout and stderr still point to `/Users/sqlist/Library/Logs/flight-monitor`.

- [ ] **Step 5: Run one launchd startup verification**

Use `node src/schedule-cli.js data/latest.json` first. If it returns `skip`, kickstart the service and wait for it to stop; verify the latest log records the two-hour skip and launchd reports exit code 0. If it returns `collect`, run the service and wait for collection completion before evaluating exit code.

### Task 4: Remove the redundant development clone

**Files:**
- Redundant clone: `/Users/sqlist/Documents/Codex/2026-08-24/referenced-chatgpt-conversation-this-is-an/work/flight-monitor`
- Recoverable destination: `/Users/sqlist/.Trash/flight-monitor-dev-duplicate-2026-08-27`

- [ ] **Step 1: Prove the clone has no unique work**

Confirm its `HEAD` equals the new repository `HEAD` and GitHub `origin/main`. Confirm its only working-tree entry is the already approved untracked `.DS_Store`.

Expected: no unique commit and no user file requiring preservation.

- [ ] **Step 2: Confirm the Trash destination is unused**

Run a read-only existence check for `/Users/sqlist/.Trash/flight-monitor-dev-duplicate-2026-08-27`.

Expected: destination does not exist. Stop rather than overwrite if it exists.

- [ ] **Step 3: Move the redundant clone to Trash**

Move the entire redundant clone to the fixed Trash destination. Do not remove the surrounding Codex task directory.

Expected: the redundant clone path no longer exists and the recoverable Trash destination exists.

### Task 5: Final verification

**Files:**
- Repository: `/Users/sqlist/Project/other/flight-monitor`
- LaunchAgent: `/Users/sqlist/Library/LaunchAgents/com.sqlist.flight-monitor.plist`

- [ ] **Step 1: Verify repository and tests**

Run:

```bash
npm test
/bin/zsh -n scripts/run-macos.sh
plutil -lint macos/com.sqlist.flight-monitor.plist
git diff --check
git status --short
```

Expected: tests and static checks pass; working tree is clean.

- [ ] **Step 2: Verify the single-repository invariant**

Expected:

```text
/Users/sqlist/Project/other/flight-monitor exists
/Users/sqlist/Library/Application Support/flight-monitor/repo does not exist
/Users/sqlist/Documents/Codex/2026-08-24/referenced-chatgpt-conversation-this-is-an/work/flight-monitor does not exist
```

- [ ] **Step 3: Verify external runtime state**

Confirm the Chromium profile and log directory still exist, the dedicated Chromium process is absent, and launchd is loaded from the installed plist with exit code 0.

- [ ] **Step 4: Verify GitHub alignment**

Confirm repository `HEAD`, local `origin/main`, and GitHub `main` are the same commit. Do not force-push.
