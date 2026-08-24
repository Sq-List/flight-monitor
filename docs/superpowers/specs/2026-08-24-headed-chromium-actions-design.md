# GitHub Actions 可见 Chromium 采集设计

## 目标

让现有 GitHub Actions 继续承担云端采集，但把 Chromium 从无头模式改为在虚拟显示器中运行的可见模式，以规避携程对无头浏览器返回的 `whaleguard block`。

## 现状证据

同一查询地址、同一 Mac 网络下已经完成对照验证：

- Playwright 无头模式：返回 `whaleguard block`，没有航班卡片。
- Playwright 可见模式、全新空白会话：读取到 9 张航班卡片，最低往返总价为 ¥3538。
- 当前正常 Chrome：页面同样显示最低往返总价 ¥3538。

因此本次只改变浏览器运行模式，不引入登录态、Cookie、代理或反检测补丁。

## 实现

采集器读取任务专用环境变量 `FLIGHT_MONITOR_HEADLESS`：

- 未设置或不是 `false` 时保持现有无头模式，兼容本地测试和现有调用。
- 明确设置为 `false` 时，以可见模式启动 Chromium。

GitHub Actions 的采集步骤设置 `FLIGHT_MONITOR_HEADLESS=false`，并通过 `xvfb-run --auto-servernum` 提供 Linux 虚拟显示器。数据结构、价格解析、失败附件和历史追加逻辑保持不变。

## 验证

1. 测试先行，验证默认值为无头、`false` 能切换到可见模式。
2. 运行全部单元测试和工作流静态检查。
3. 提交并推送代码，但不提交 Mac 对照实验产生的本地 `data/*.json` 改动。
4. 手动触发 GitHub Actions：
   - 成功时要求 `latest.status=success`、报价为正数，并追加成功历史。
   - 仍被拦截时保留 `captcha`、历史和失败附件，据此确认 GitHub 云出口也是独立风控条件。

## 边界

- 本次不启用定时计划。
- 不接入登录态、Cookie、住宅代理或自托管运行器。
- 不点击选择返程；价格仍是“选择去程”页面显示的往返总价。
