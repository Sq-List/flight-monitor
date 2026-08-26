# Ctrip Outbound Click Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让携程去程选择避开不可操作节点，并让单个候选失败不再清空整日结果。

**Architecture:** 页面会话负责精确定位、滚动和点击可见节点；采集循环负责候选级容错。验证码和总超时保持日期级终止语义。

**Tech Stack:** Node.js 22、Playwright、`node:test`

---

### Task 1: 可见去程操作

**Files:**
- Modify: `tests/ctrip-page.test.js`
- Modify: `src/ctrip-page.js`

- [ ] **Step 1: Write the failing test**

增加一个同时包含隐藏与可见“选为去程”节点的页面夹具，断言只触发可见节点。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ctrip-page.test.js`

Expected: FAIL，因为当前 `.first()` 命中隐藏节点并等待超时。

- [ ] **Step 3: Write minimal implementation**

让卡片先执行 `scrollIntoViewIfNeeded()`，再从匹配操作中选择可见节点并点击；点击超时转换为 `outbound_click_timeout`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ctrip-page.test.js`

Expected: PASS。

### Task 2: 候选级容错

**Files:**
- Modify: `tests/collector.test.js`
- Modify: `src/collector.js`

- [ ] **Step 1: Write the failing test**

构造两个去程候选：第一个 `listReturns` 抛出 `outbound_click_timeout`，第二个返回有效返程；断言第二个组合被保存、错误被记录，日期状态仍为失败。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/collector.test.js`

Expected: FAIL，因为当前候选异常会跳出整个日期循环。

- [ ] **Step 3: Write minimal implementation**

在候选循环内捕获普通错误并继续，并在候选结束后把日期标记为失败；遇到 `captcha` 或 `run_timeout` 时立即结束当前日期，保留现有日期级停止行为。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/collector.test.js`

Expected: PASS。

### Task 3: 回归与真实验证

**Files:**
- Modify: `src/ctrip-page.js`
- Test: `tests/ctrip-page.test.js`
- Test: `tests/collector.test.js`

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: 全部通过。

- [ ] **Step 2: Run syntax checks**

Run: `node --check src/ctrip-page.js && node --check src/collector.js`

Expected: 无输出且退出码为 0。

- [ ] **Step 3: Run one forced local collection**

使用正式启动方式运行一次强制采集，检查 10 月 1 日候选日志、`latest.json`、失败附件和浏览器前台占用情况；不自动提交或推送代码。
