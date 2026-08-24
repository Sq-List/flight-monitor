# macOS 本地机票采集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前 Mac 的已登录桌面会话中，于登录、10:30、14:30、18:30 运行可见 Chromium 采集器，休眠错过时唤醒补跑，并将结果发布到 GitHub。

**Architecture:** 用用户级 `LaunchAgent` 调用独立运行目录中的仓库副本，避免自动提交影响当前开发目录。Node.js 提供两小时去重判断，zsh 脚本负责采集、只提交数据文件并通过 GitHub 推送；首次部署前精确合并本地与远端历史。

**Tech Stack:** Node.js 25、Playwright 1.62、zsh、launchd、Git、GitHub CLI

**Approval gate:** 下列提交和推送步骤只在用户明确授权后执行；不得因计划中列出命令而自动获得授权。

---

### Task 1: 两小时去重判断

**Files:**
- Create: `src/schedule.js`
- Create: `src/schedule-cli.js`
- Create: `tests/schedule.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/schedule.test.js`：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldCollect } from '../src/schedule.js';

const now = new Date('2026-08-24T18:30:00+08:00');

test('collects when no previous timestamp exists', () => {
  assert.equal(shouldCollect({ checkedAt: null, now }), true);
});

test('skips when the previous collection is less than two hours old', () => {
  assert.equal(shouldCollect({
    checkedAt: '2026-08-24T17:00:01+08:00',
    now,
  }), false);
});

test('collects when the previous collection is exactly two hours old', () => {
  assert.equal(shouldCollect({
    checkedAt: '2026-08-24T16:30:00+08:00',
    now,
  }), true);
});

test('collects when the previous timestamp is invalid', () => {
  assert.equal(shouldCollect({ checkedAt: 'invalid', now }), true);
});

test('skips a future timestamp to avoid rapid retries after clock drift', () => {
  assert.equal(shouldCollect({
    checkedAt: '2026-08-24T19:00:00+08:00',
    now,
  }), false);
});
```

- [ ] **Step 2: 验证测试因模块缺失而失败**

Run: `node --test tests/schedule.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `src/schedule.js`。

- [ ] **Step 3: 实现最小去重逻辑**

创建 `src/schedule.js`：

```js
export const DEFAULT_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;

// 判断本次触发是否需要采集；时间无效时允许采集，未来时间则避免立即重试。
export function shouldCollect({
  checkedAt,
  now = new Date(),
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
}) {
  if (!checkedAt) return true;

  const previousTime = new Date(checkedAt).getTime();
  if (!Number.isFinite(previousTime)) return true;

  return now.getTime() - previousTime >= minIntervalMs;
}
```

创建 `src/schedule-cli.js`：

```js
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
```

- [ ] **Step 4: 验证测试通过**

Run: `node --test tests/schedule.test.js && npm test`

Expected: schedule 的 5 项测试通过，全部测试通过。

- [ ] **Step 5: 在获得授权后提交**

```bash
git add src/schedule.js src/schedule-cli.js tests/schedule.test.js docs/superpowers/specs/2026-08-24-macos-local-collection-design.md
git commit -m "feat: add local collection schedule policy"
```

### Task 2: 本地采集与发布脚本

**Files:**
- Create: `scripts/run-macos.sh`

- [ ] **Step 1: 创建运行脚本**

创建 `scripts/run-macos.sh`：

```zsh
#!/bin/zsh
set -u

repo_dir="${FLIGHT_MONITOR_REPO_DIR:-/Users/sqlist/Library/Application Support/flight-monitor/repo}"
git_proxy="${FLIGHT_MONITOR_GIT_PROXY:-http://127.0.0.1:7890}"
export PATH="/Users/sqlist/.nvm/versions/node/v25.5.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

log() {
  print -r -- "$(date '+%Y-%m-%d %H:%M:%S %z') $*"
}

remote_git() {
  local attempt
  for attempt in 1 2 3; do
    if git -c http.proxy="$git_proxy" "$@"; then
      return 0
    fi
    if (( attempt < 3 )); then
      log "GitHub operation failed; retrying ($attempt/3)"
      sleep 5
    fi
  done
  return 1
}

if [[ ! -d "$repo_dir/.git" ]]; then
  log "runtime repository is missing: $repo_dir"
  exit 1
fi

cd "$repo_dir" || exit 1

if ! remote_git pull --rebase origin main; then
  git rebase --abort >/dev/null 2>&1 || true
  log "could not sync GitHub; continuing with the local runtime copy"
fi

# 上一次推送失败时，本地提交仍然保留；先重试发布，再判断是否需要新采集。
if ! remote_git push origin HEAD:main; then
  log "an unpublished local commit is still waiting for GitHub"
fi

decision="$(node src/schedule-cli.js data/latest.json)" || exit 1
if [[ "$decision" == "skip" ]]; then
  log "collection skipped because the latest run is less than two hours old"
  exit 0
fi

log "starting visible Chromium collection"
FLIGHT_MONITOR_HEADLESS=false npm run collect
collect_status=$?

git config user.name "flight-monitor-mac"
git config user.email "flight-monitor-mac@users.noreply.github.com"
git add data/latest.json data/history.json

if ! git diff --cached --quiet; then
  git commit -m "data: record local ctrip collection" || exit 1
  if ! remote_git pull --rebase origin main; then
    git rebase --abort >/dev/null 2>&1 || true
    log "collection is committed locally but GitHub sync failed"
    exit 1
  fi
  if ! remote_git push origin HEAD:main; then
    log "collection is committed locally but GitHub push failed"
    exit 1
  fi
  log "collection data pushed to GitHub"
else
  log "collection produced no data changes"
fi

exit "$collect_status"
```

- [ ] **Step 2: 设置可执行权限并做语法检查**

Run: `chmod +x scripts/run-macos.sh && /bin/zsh -n scripts/run-macos.sh`

Expected: exit 0，无输出。

- [ ] **Step 3: 验证强制与去重入口**

Run: `FLIGHT_MONITOR_FORCE=true node src/schedule-cli.js data/latest.json && node src/schedule-cli.js data/latest.json`

Expected: 第一行是 `collect`；第二行依据 `checked_at` 距当前时间输出 `collect` 或 `skip`。

- [ ] **Step 4: 在获得授权后提交**

```bash
git add scripts/run-macos.sh
git commit -m "feat: run and publish fares from macOS"
```

### Task 3: 用户级 LaunchAgent

**Files:**
- Create: `macos/com.sqlist.flight-monitor.plist`

- [ ] **Step 1: 创建固定到独立运行目录的 LaunchAgent**

创建 `macos/com.sqlist.flight-monitor.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sqlist.flight-monitor</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>/Users/sqlist/Library/Application Support/flight-monitor/repo/scripts/run-macos.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/sqlist/Library/Application Support/flight-monitor/repo</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
    <dict>
      <key>Hour</key>
      <integer>14</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
    <dict>
      <key>Hour</key>
      <integer>18</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
  </array>
  <key>StandardOutPath</key>
  <string>/Users/sqlist/Library/Logs/flight-monitor/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/sqlist/Library/Logs/flight-monitor/stderr.log</string>
  <key>ThrottleInterval</key>
  <integer>60</integer>
</dict>
</plist>
```

- [ ] **Step 2: 校验 plist**

Run: `plutil -lint macos/com.sqlist.flight-monitor.plist`

Expected: `macos/com.sqlist.flight-monitor.plist: OK`。

- [ ] **Step 3: 在获得授权后提交**

```bash
git add macos/com.sqlist.flight-monitor.plist
git commit -m "feat: schedule local fare collection on macOS"
```

### Task 4: 合并本地与 GitHub 历史

**Files:**
- Modify: `data/history.json`
- Modify: `data/latest.json`

- [ ] **Step 1: 重新读取 GitHub 当前数据**

Run:

```bash
/bin/zsh -ic 'proxy >/dev/null 2>&1; gh api repos/Sq-List/flight-monitor/contents/data/history.json -H "Accept: application/vnd.github.raw+json"'
/bin/zsh -ic 'proxy >/dev/null 2>&1; gh api repos/Sq-List/flight-monitor/contents/data/latest.json -H "Accept: application/vnd.github.raw+json"'
```

Expected: 远端历史至少包含 `15:32:01.201`、`15:34:38.023`、`16:54:32.315` 三条失败记录；远端最新状态时间为 `16:54:32.315`。如果远端新增了记录，继续按 `checked_at` 合并所有唯一记录，并以真实最新记录生成 `latest.json`。

- [ ] **Step 2: 将当前已知四条记录按时间排序合并**

`data/history.json` 的已知合并结果必须依次保留：

```text
2026-08-24T15:32:01.201+08:00  cards_not_found  GitHub hosted/headless
2026-08-24T15:34:38.023+08:00  captcha         GitHub hosted/headless
2026-08-24T16:37:30.198+08:00  captcha         current Mac/headless
2026-08-24T16:54:32.315+08:00  captcha         GitHub hosted/Xvfb headed
```

每个条目保留现有完整 `query`、`current` 和 `error` 对象；不得只保存上面的摘要文本。

- [ ] **Step 3: 将 latest 设为真实最新记录**

在没有更新远端记录时，`data/latest.json` 必须使用远端 `2026-08-24T16:54:32.315+08:00` 的完整内容；`last_success` 仍为 `null`。如果 Step 1 发现更晚记录，则使用更晚记录。

- [ ] **Step 4: 用程序核对唯一性与最新时间**

Run:

```bash
node - <<'NODE'
const fs = require('node:fs');
const latest = JSON.parse(fs.readFileSync('data/latest.json', 'utf8'));
const history = JSON.parse(fs.readFileSync('data/history.json', 'utf8'));
const timestamps = history.map((entry) => entry.checked_at);
if (new Set(timestamps).size !== timestamps.length) throw new Error('duplicate checked_at');
const newest = [...timestamps].sort().at(-1);
if (latest.checked_at !== newest) throw new Error(`latest ${latest.checked_at} != ${newest}`);
console.log(JSON.stringify({ history_entries: history.length, latest: latest.checked_at }));
NODE
```

Expected: `history_entries` 等于合并后的唯一记录数量，`latest` 等于排序后的最后时间。

- [ ] **Step 5: 在获得授权后提交**

```bash
git add data/latest.json data/history.json
git commit -m "data: reconcile local and hosted collection history"
```

### Task 5: 更新最终使用说明

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 将 README 改为当前本地监控方案**

README 必须明确写出：

```markdown
# flight-monitor

在当前 Mac 的已登录桌面会话中使用可见 Chromium 采集携程往返价格，并把最新结果与完整历史发布到 GitHub。

## 运行时间

- 用户登录时尝试一次
- 每天 10:30、14:30、18:30
- 计划时间处于睡眠状态时，唤醒后补跑一次
- 距最近一次采集不足两小时则跳过

Mac 关机、退出登录或没有网络时无法采集；系统不会为了监控主动唤醒或阻止睡眠。采集时 Chromium 窗口可能短暂出现。

## 查询范围

- 杭州（HGH）→ 乌鲁木齐（URC）
- 去程：2026-10-01
- 返程：2026-10-08

第一版读取“选择去程”页面显示的往返总价，不选择具体返程航班。

## 数据

- [`data/latest.json`](data/latest.json)：本轮状态和最近一次成功报价
- [`data/history.json`](data/history.json)：成功与失败的全部运行历史

页面触发访问验证时记录 `captcha`，保留最近一次成功报价，不把旧价格冒充为本轮实时价格。

GitHub 托管 Actions 已证明会触发携程风控，只保留作手动诊断，不承担定时监控。
```

- [ ] **Step 2: 验证 README 不再声称云端采集是当前方案**

Run: `rg -n '当前仍只支持手动运行|连续验证稳定后再启用定时计划' README.md`

Expected: exit 1，无匹配。

- [ ] **Step 3: 运行交付前检查**

Run: `npm test && /bin/zsh -n scripts/run-macos.sh && plutil -lint macos/com.sqlist.flight-monitor.plist`

Expected: 全部测试通过，zsh 语法检查 exit 0，plist 显示 `OK`。

- [ ] **Step 4: 在获得授权后提交并推送代码与合并数据**

```bash
git add README.md docs/superpowers/plans/2026-08-24-macos-local-collection.md
git commit -m "docs: explain macOS fare monitoring"
/bin/zsh -ic 'proxy >/dev/null 2>&1; git push origin main'
```

Expected: GitHub `main` 包含本计划涉及的代码、配置、文档和四条已知历史记录；现有 `.github/workflows/collect.yml` 仍仅支持手动触发。

### Task 6: 部署独立运行目录与 LaunchAgent

**Files:**
- Create runtime directory: `/Users/sqlist/Library/Application Support/flight-monitor/repo`
- Create log directory: `/Users/sqlist/Library/Logs/flight-monitor`
- Install: `/Users/sqlist/Library/LaunchAgents/com.sqlist.flight-monitor.plist`

- [ ] **Step 1: 确认目标目录不会覆盖现有内容**

Run:

```bash
test ! -e '/Users/sqlist/Library/Application Support/flight-monitor/repo'
test ! -e '/Users/sqlist/Library/LaunchAgents/com.sqlist.flight-monitor.plist'
```

Expected: 两条命令均 exit 0。任一目标已存在时停止，先只读检查其内容，不覆盖。

- [ ] **Step 2: 创建独立运行目录并安装依赖**

Run:

```bash
mkdir -p '/Users/sqlist/Library/Application Support/flight-monitor' '/Users/sqlist/Library/Logs/flight-monitor'
git -c http.proxy=http://127.0.0.1:7890 clone https://github.com/Sq-List/flight-monitor.git '/Users/sqlist/Library/Application Support/flight-monitor/repo'
cd '/Users/sqlist/Library/Application Support/flight-monitor/repo'
git config --local credential.https://github.com.helper '!/opt/homebrew/bin/gh auth git-credential'
PATH='/Users/sqlist/.nvm/versions/node/v25.5.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' \
  http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 npm ci
PATH='/Users/sqlist/.nvm/versions/node/v25.5.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' \
  http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 npx playwright install chromium
```

Expected: clone、`npm ci`、Chromium 安装均成功；运行目录 `git status --short` 为空。

- [ ] **Step 3: 安装但暂不加载 LaunchAgent**

Run:

```bash
/usr/bin/install -m 644 \
  '/Users/sqlist/Library/Application Support/flight-monitor/repo/macos/com.sqlist.flight-monitor.plist' \
  '/Users/sqlist/Library/LaunchAgents/com.sqlist.flight-monitor.plist'
plutil -lint '/Users/sqlist/Library/LaunchAgents/com.sqlist.flight-monitor.plist'
```

Expected: plist 显示 `OK`；此时任务尚未加载，避免 `RunAtLoad` 与首次强制验证并发。

- [ ] **Step 4: 强制执行首次真实采集**

Run:

```bash
cd '/Users/sqlist/Library/Application Support/flight-monitor/repo'
FLIGHT_MONITOR_FORCE=true ./scripts/run-macos.sh
```

Expected: 可见 Chromium 短暂出现；采集成功时 `latest.status=success`、`current.best_price` 为正数，并新增一条本地历史。触发风控时按现有规则记录 `captcha`，但部署不能据此宣称采集成功。

- [ ] **Step 5: 验证数据已经发布到 GitHub**

Run:

```bash
/bin/zsh -ic 'proxy >/dev/null 2>&1; gh api repos/Sq-List/flight-monitor/contents/data/latest.json -H "Accept: application/vnd.github.raw+json"'
/bin/zsh -ic 'proxy >/dev/null 2>&1; gh api repos/Sq-List/flight-monitor/contents/data/history.json -H "Accept: application/vnd.github.raw+json"'
```

Expected: `latest.checked_at` 等于首次本地采集时间；成功时状态和正数价格可核验；历史包含首次合并的所有记录以及新记录。

- [ ] **Step 6: 加载 LaunchAgent 并验证两小时去重**

Run:

```bash
launchctl bootstrap "gui/$(id -u)" '/Users/sqlist/Library/LaunchAgents/com.sqlist.flight-monitor.plist'
launchctl enable "gui/$(id -u)/com.sqlist.flight-monitor"
sleep 2
tail -20 '/Users/sqlist/Library/Logs/flight-monitor/stdout.log'
```

Expected: `RunAtLoad` 已触发，日志包含 `collection skipped because the latest run is less than two hours old`；GitHub 历史和提交数不增加。

- [ ] **Step 7: 验证任务状态与日志路径**

Run:

```bash
launchctl print "gui/$(id -u)/com.sqlist.flight-monitor"
ls -l '/Users/sqlist/Library/Logs/flight-monitor/stdout.log' '/Users/sqlist/Library/Logs/flight-monitor/stderr.log'
```

Expected: LaunchAgent 已加载；日志文件存在且不包含 GitHub token、Cookie 或其他敏感内容。
