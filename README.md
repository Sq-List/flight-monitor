# flight-monitor

使用 GitHub Actions 验证携程往返机票页面能否从云端稳定采集。

## 当前状态

2026-08-24 的云端验证已确认：测试、结果落盘和失败附件均可正常运行，但携程对 GitHub 托管运行器返回 `whaleguard block`，因此目前还不能取得真实报价，也不启用定时计划。下一步需要改用家庭或自有网络出口，再重新验证采集。

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
