# 携程机票 GitHub Actions 采集验证设计

## 目标

验证 GitHub Actions 能否从携程往返搜索页稳定取得以下查询的去程航班卡片和页面显示的往返总价：

- 出发地：杭州（HGH）
- 目的地：乌鲁木齐（URC）
- 去程日期：2026-10-01
- 返程日期：2026-10-08

第一版只验证云端采集入口。成功后再增加具体返程选择、定时执行和 ChatGPT 监控对接。

## 方案选择

采用 Node.js 和 Playwright，直接启动 Chromium 并解析携程渲染后的页面。

不采用 OpenCLI，因为当前携程航班命令依赖浏览器 Cookie 和 Browser Bridge，GitHub Actions 中需要额外运行浏览器扩展。不基于 `ctrip-flight-alter` 修改，因为其核心模型是单程最低价监控，改造成往返列表采集并不比直接实现更短。

## 范围

### 包含

- 由 GitHub Actions 手动触发一次采集。
- 使用未登录的 Chromium 打开携程往返搜索页。
- 提取去程卡片中的航司、出发时间、到达时间、出发机场、到达机场和往返总价。
- 生成最新状态和完整运行历史。
- 采集失败时保留最近一次有效结果。
- 采集失败时上传截图和不含 Cookie 的简短页面摘要。
- 通过单元测试验证页面解析和历史数据更新。

### 不包含

- 携程账号登录或 Cookie 注入。
- 点击去程后解析具体返程航班。
- 定时执行。
- ChatGPT 监控任务修改。
- 通知、数据库或独立 API 服务。

## 仓库结构

```text
.github/workflows/collect.yml
src/collector.js
src/parser.js
src/state.js
tests/fixtures/
tests/parser.test.js
tests/state.test.js
data/latest.json
data/history.json
```

各文件职责：

- `collector.js`：启动浏览器、访问固定查询地址、等待页面并取得供解析器使用的卡片内容。
- `parser.js`：把页面卡片转换成稳定的航班报价对象，不处理文件和 GitHub 状态。
- `state.js`：根据本轮结果更新 `latest.json` 和 `history.json`，不访问网页。
- `collect.yml`：安装依赖、运行测试、执行采集、提交数据，并在失败时上传诊断附件。

## 运行流程

1. 用户从 GitHub Actions 页面手动触发工作流。
2. 工作流安装 Node.js、项目依赖和 Chromium。
3. 工作流先运行单元测试；测试失败则停止，不访问携程。
4. 采集器打开固定往返查询地址并等待去程卡片渲染。
5. 解析器输出报价列表，并要求至少一条记录同时具有航司、出发时间、到达时间和有效正数价格。
6. 成功时更新当前结果和历史记录；失败时写入失败状态并保留最近一次成功结果。
7. 工作流只提交 `data/latest.json` 和 `data/history.json`。
8. 失败时上传截图和页面摘要，最后将工作流标记为失败。

工作流使用并发锁，同一时间只允许一次采集修改历史文件。

## 数据格式

`data/latest.json` 供后续 ChatGPT 监控快速读取：

```json
{
  "schema_version": 1,
  "status": "success",
  "checked_at": "2026-08-24T15:30:00+08:00",
  "query": {
    "from": "HGH",
    "to": "URC",
    "depart_date": "2026-10-01",
    "return_date": "2026-10-08"
  },
  "current": {
    "best_price": 3538,
    "currency": "CNY",
    "quotes": []
  },
  "last_success": {},
  "error": null
}
```

失败时 `status` 为 `failed`，`current` 为 `null`，`last_success` 保留最近一次成功结果，`error` 包含稳定的错误代码和简短说明。

`data/history.json` 是按运行时间排序的数组，每次运行追加一条记录。成功记录保存本轮报价，失败记录保存错误代码；失败记录的价格为空，不复制旧价格冒充本轮结果。监控结束前不删除历史记录。

## 错误处理

第一版区分以下错误：

- `navigation_timeout`：页面未在限制时间内打开。
- `captcha`：页面出现验证码或访问频繁提示。
- `cards_not_found`：页面打开但未发现航班卡片。
- `quotes_invalid`：发现卡片但没有可用正数价格。
- `unexpected`：不属于以上类型的运行错误。

错误信息不得包含 Cookie、请求头、访问令牌或完整页面源码。失败附件只包含截图和截断后的可见文本摘要。

## 测试

开发按测试先行执行：

1. 先用固定页面样本编写解析器测试，并确认测试因解析器尚未实现而失败。
2. 实现最小解析逻辑使测试通过。
3. 编写历史状态测试，覆盖首次成功、成功后失败和首次即失败。
4. 实现最小状态更新逻辑使测试通过。
5. 运行全部单元测试。
6. GitHub Actions 的真实手动运行作为集成验证，不用本地成功代替云端证明。

## 验收标准

第一版通过必须同时满足：

- 手动工作流能在 GitHub 托管的 Ubuntu Runner 上完成。
- 单元测试全部通过。
- `data/latest.json` 符合约定结构，且成功状态至少包含一条有效报价。
- `data/history.json` 追加本次运行记录。
- 报价来自目标日期往返页面，不使用其他日期或线路低价替代。
- 失败场景能够保留最近一次成功结果，并提供不含敏感数据的诊断附件。

若 GitHub Runner 连续被验证码或访问限制拦截，则本验证结论为 GitHub Actions 采集入口不可用，不通过伪装请求、增加高频重试或填入旧价格掩盖失败。
