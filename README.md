# flight-monitor

使用 GitHub Actions 验证携程往返机票页面能否从云端稳定采集。

## 当前状态

GitHub Actions 已配置为在虚拟显示器中运行可见模式 Chromium，避免本地验证中无头模式触发的 `whaleguard block`。当前仍只支持手动运行；最新采集结果以 [`data/latest.json`](data/latest.json) 为准，连续验证稳定后再启用定时计划。

当前固定查询：

- 杭州（HGH）→ 乌鲁木齐（URC）
- 去程：2026-10-01
- 返程：2026-10-08

## 手动运行

打开仓库的 **Actions → Collect Ctrip fares → Run workflow**。

运行结果：

- [`data/latest.json`](data/latest.json)：本轮状态和最近一次成功报价。
- [`data/history.json`](data/history.json)：包含成功和失败的全部运行历史。

第一版只读取选择去程页面显示的往返总价，不选择具体返程航班。采集失败时，Actions 会保留最近一次有效报价并上传七天有效的诊断附件。
