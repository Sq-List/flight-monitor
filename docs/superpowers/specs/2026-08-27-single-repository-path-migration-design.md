# 单一代码目录迁移设计

## 目标

将机票监控的唯一代码仓库迁移到：

```text
/Users/sqlist/Project/other/flight-monitor
```

该目录同时用于日常开发和 Mac 定时采集，不再维护独立的开发副本与正式运行副本。

## 迁移范围

需要迁移和更新：

- 正式 Git 仓库及其中的依赖、数据和脚本。
- `scripts/run-macos.sh` 的默认仓库路径。
- `macos/com.sqlist.flight-monitor.plist` 中的脚本路径和工作目录。
- 已安装的 `/Users/sqlist/Library/LaunchAgents/com.sqlist.flight-monitor.plist`。

继续留在系统目录：

- Chromium 登录配置：`/Users/sqlist/Library/Application Support/flight-monitor/chromium-profile`。
- 运行日志：`/Users/sqlist/Library/Logs/flight-monitor`。

这些运行状态不属于代码仓库，保留原位可避免丢失携程登录状态，也符合 macOS 的目录用途。

## 迁移顺序

1. 确认正式仓库和 GitHub `main` 同步，目标目录不存在。
2. 修改仓库中的默认路径和 LaunchAgent 模板，执行测试与配置检查并推送。
3. 停止 `com.sqlist.flight-monitor`，避免迁移过程中启动采集。
4. 将正式仓库移动到新目录。
5. 从新目录安装并加载更新后的 LaunchAgent。
6. 验证新目录测试、Git 状态、定时任务路径和一次启动结果。
7. 再次确认 Documents 开发副本没有独有提交或文件；其唯一未跟踪文件 `.DS_Store` 不需要保留。
8. 将重复开发副本移入废纸篓，使新目录成为唯一有效代码仓库。

## 失败处理

- 新目录验证前不移除任何重复副本。
- 若 LaunchAgent 加载或测试失败，保留新仓库和旧开发副本，先恢复定时任务到可运行状态。
- 只有新目录的 Git HEAD、`origin/main`、测试和 LaunchAgent 均验证通过，才处理重复开发副本。
- 不删除浏览器配置、日志或历史价格数据。

## 验收标准

- `/Users/sqlist/Project/other/flight-monitor` 是唯一有效代码仓库。
- 原正式路径 `/Users/sqlist/Library/Application Support/flight-monitor/repo` 不存在。
- Documents 下的重复开发仓库已移入废纸篓。
- 新仓库与 GitHub `main` 指向同一提交，工作区干净。
- 全量测试、脚本语法和 LaunchAgent 配置检查通过。
- LaunchAgent 的脚本路径和工作目录都指向新目录，启动验证退出码为 0。
- Chromium 登录配置、日志与已提交的价格历史保持不变。
