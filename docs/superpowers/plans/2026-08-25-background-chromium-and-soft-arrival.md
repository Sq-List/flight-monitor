# 后台 Chromium 与去程软限制实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅取消 9 月 30 日去程到达上限，把 10 月 1 日次日 01:00 改为候选软限制，并让当前 Mac 的可见 Chromium 从启动开始就在后台运行。

**Architecture:** 行程筛选继续由 `src/itinerary.js` 负责：所有满足出发和中转条件的航班都有效，10 月 1 日候选选择增加到达软限制分组。`src/macos-focus.js` 改为用 macOS `open -g` 启动独立 Chromium，通过临时用户目录中的 `DevToolsActivePort` 连接 Playwright；`src/collector.js` 只负责根据平台和可见模式选择启动器。

**Tech Stack:** Node.js、Playwright、macOS Launch Services、Chrome DevTools Protocol、Node test runner

---

### Task 1: 去程到达软限制

**Files:**
- Modify: `tests/itinerary.test.js`
- Modify: `src/itinerary.js`
- Modify: `README.md`

- [ ] **Step 1: 写失败测试**

在 `tests/itinerary.test.js` 验证：9 月 30 日晚于次日 01:00 仍合格；10 月 1 日晚到航班本身合格；选 5 个候选时先选次日 01:00 及以前到达的航班，不足 5 个再选晚到航班。

- [ ] **Step 2: 验证测试因旧硬限制而失败**

Run: `node --test tests/itinerary.test.js`

Expected: 9 月 30 日晚到航班和 10 月 1 日软限制测试 FAIL。

- [ ] **Step 3: 实现最小筛选改动**

删除 9 月 30 日到达上限；`isEligibleOutbound` 不再用 10 月 1 日到达时间做硬过滤；`selectOutboundCandidates` 对 10 月 1 日先按是否在次日 01:00 以内分组，再按页面起价、目标出发时间和航班号排序。

- [ ] **Step 4: 验证筛选测试通过**

Run: `node --test tests/itinerary.test.js`

Expected: 所有测试 PASS。

### Task 2: 可见 Chromium 后台启动

**Files:**
- Modify: `tests/macos-focus.test.js`
- Modify: `tests/collector.test.js`
- Modify: `src/macos-focus.js`
- Modify: `src/collector.js`

- [ ] **Step 1: 写失败测试**

验证 macOS 可见模式调用 `open -g -n`，使用独立临时用户目录和 `--remote-debugging-port=0`，读取 `DevToolsActivePort` 后连接 Playwright；验证采集器不再执行“启动后恢复焦点”。

- [ ] **Step 2: 验证测试因后台启动器不存在而失败**

Run: `node --test tests/macos-focus.test.js tests/collector.test.js`

Expected: 后台启动器测试 FAIL。

- [ ] **Step 3: 实现后台启动器**

macOS 可见模式通过 `open -g -n -a <Chromium.app> --args ...` 启动；轮询临时目录的 `DevToolsActivePort`，再用 `chromium.connectOverCDP` 连接。封装 `newPage` 和 `close`，关闭后清理任务自己的临时目录。无头模式和非 macOS 可见模式继续用 `chromium.launch`。

- [ ] **Step 4: 验证启动器与采集测试通过**

Run: `node --test tests/macos-focus.test.js tests/collector.test.js`

Expected: 所有测试 PASS。

### Task 3: 全量与当前 Mac 验证

**Files:**
- Verify: `README.md`
- Generated only in a new temporary directory: `data/latest.json`, `data/history.json`, `artifacts/*`
- Do not modify: `macos/com.sqlist.flight-monitor.plist`
- Do not modify: `/Users/sqlist/Library/Application Support/flight-monitor/repo`

- [ ] **Step 1: 运行全套测试和静态检查**

Run: `npm test`

Expected: 所有测试 PASS。

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 2: 在临时副本运行可见采集并连续监控焦点**

用新的临时目录承载结果；以 `FLIGHT_MONITOR_HEADLESS=false FLIGHT_MONITOR_FORCE=true` 运行采集。同时每秒记录一次 macOS 前台应用，直到采集结束。

Expected: Chromium 可见但始终不成为前台应用；日志完成两个日期扫描或明确记录页面级失败；不会修改正式定时运行目录。

- [ ] **Step 3: 验证结果**

Expected: 9 月 30 日能纳入 21:00 以后且晚于次日 01:00 到达的候选；10 月 1 日优先检查次日 01:00 以前到达的候选，不足 5 个才补晚到航班；有效结果仍按完整往返组合起价排序。

