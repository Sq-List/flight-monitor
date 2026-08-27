# Chromium CDP Startup Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止陈旧调试端口和残留 Chromium 导致连续采集失败。

**Architecture:** `macos-focus.js` 统一负责专用 Chromium 的启动前清理、后台启动、CDP 连接和失败后清理。既有页面与采集模块接口保持不变。

**Tech Stack:** Node.js 22、Playwright、macOS `open`/`pkill`、`node:test`

---

### Task 1: 启动前清理

**Files:**
- Modify: `tests/macos-focus.test.js`
- Modify: `src/macos-focus.js`

- [ ] **Step 1: Write the failing test**

在现有 macOS 启动测试中记录调用顺序，断言启动 `open` 前已终止专用配置进程并移除 `DevToolsActivePort`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/macos-focus.test.js`

Expected: FAIL，因为当前实现直接读取旧端口文件。

- [ ] **Step 3: Write minimal implementation**

增加只匹配 `--user-data-dir=<专用目录>` 的进程清理函数，并在 `open` 前删除端口文件。`pkill` 返回无匹配时视为正常。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/macos-focus.test.js`

Expected: PASS。

### Task 2: 连接失败清理

**Files:**
- Modify: `tests/macos-focus.test.js`
- Modify: `src/macos-focus.js`

- [ ] **Step 1: Write the failing test**

让 `connectOverCDP` 抛出 `ECONNREFUSED`，断言启动函数重新终止专用配置进程并移除端口文件后再抛出原错误。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/macos-focus.test.js`

Expected: FAIL，因为当前连接异常没有清理路径。

- [ ] **Step 3: Write minimal implementation**

用 `try/catch` 包裹等待端口、连接和上下文初始化；失败时调用同一清理函数。正常 `close()` 在发送 `Browser.close` 后也执行清理。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/macos-focus.test.js`

Expected: PASS。

### Task 3: 验证

**Files:**
- Test: `tests/macos-focus.test.js`
- Test: `tests/collector.test.js`

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: 全部通过。

- [ ] **Step 2: Run syntax check**

Run: `node --check src/macos-focus.js`

Expected: 无输出且退出码为 0。

- [ ] **Step 3: Run one isolated real collection**

清理仅属于采集器专用配置的现有残留，在临时数据目录运行一次可见采集，检查完整组合、错误列表和结束后的残留进程；不提交或推送。
