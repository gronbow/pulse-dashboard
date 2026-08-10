# Pulse 研发进度

更新时间：2026-08-10

当前公开版本：桌面端与 Codex 插件 v0.5.5 Beta；当前源码：v0.5.6 候选。PR A“训练安全呈现”已在 `codex/pr-a-training-safety` 实现并完成本地验证，尚未合并或发布

## 当前目标

把 Pulse 做成大模型健康教练的桌面看板：Codex 通过已跑通的 COROS MCP 路径取得数据并形成建议，Pulse 在电脑桌面展示健康、今日训练、训练计划和 AI 洞察。

## 已完成

| 模块 | 当前状态 |
|---|---|
| 桌面体验 | Dashboard、训练与健康卡片、设置、托盘、主题、背景层透明度、置顶、精简模式及内置圆角滚动条可用；16:9、4:3、21:9 小组件统一采用 SVG 图标和更清晰的字号/对齐；完整窗口会恢复位置与尺寸并自动限制在可用显示区域；日均压力缺失时回退血氧。 |
| 数据基础 | 标准化快照、`DataSourceAdapter`、连接测试、超时、响应大小限制、同源缓存与离线回退已完成；首次同步前不会显示 Demo 数字。 |
| Codex 交接 | Electron 在本机启动 Handoff；`pulse-dashboard` 插件发布完整快照后，桌面窗口会立即自动读取。 |
| 数据源 | 可切换演示数据、Codex + COROS MCP 和自定义 HTTP Bridge。 |
| 数据质量 | 睡眠、心率、HRV、日均压力、步数、恢复等至少两项健康信号，以及有效洞察、活动正时长、UTF-8、时间戳/日期和集合上限，成为覆盖旧快照前的硬门槛。最终 `readiness` 统一控制洞察、恢复提示和训练计划：`data_insufficient` 只展示客观数据，`stop_refer` 停止训练建议；设备恢复值不能覆盖安全状态。 |
| 七日负荷 | 近 7 日逐日短期负荷已加入标准快照与桌面图表，同时显示当前短期、长期负荷及比值。 |
| 指标时效 | 睡眠、静息心率、HRV 等支持独立数据日期；当天尚未归档时显示最近有效值及其日期。 |
| 验证 | 演示 Bridge、快照、适配器、Codex Handoff、发布脚本、隐私审计、真实 Electron 截图、压力/血氧渲染断言，以及解包版托盘与窗口原生图像检查均纳入本地验证；新增安全呈现纯函数测试、ready/阻断往返与异步洞察竞态测试、`data_insufficient`/`stop_refer` 实窗文字和 ARIA 测试，以及 WCAG AA、长文本和 100%/125%/150% 缩放布局门。 |
| 分发准备 | Windows 打包配置、应用图标、严格包内容白名单、CI、Issue/PR 模板、合成预览图和发布检查清单已加入；v0.5.5 已加入三种简洁小组件截图，完成隔离目录静默安装/卸载演练，并发布 GitHub Pre-release。 |
| 供应链 | v0.5.6 候选固定所有 GitHub Actions 提交，加入 npm/Actions Dependabot、PR 依赖审查、SPDX SBOM、SHA-256 和 GitHub 构建/SBOM 证明；GitHub 已开启漏洞告警、安全更新、私密漏洞报告及 `main` 分支保护。 |
| 产品边界 | Pulse 不开发 COROS OAuth、Token 管理或供应商 API 直连；这些职责属于 LLM Host。 |

## 已知测试版限制

- 2026-08-03 对 v0.5.5 发布候选 Electron 四进程重新沿用同一采样口径：5 秒窗口内约占 0.31% 单核（整机约 0.022%），总工作集约为 404 MB。
- CPU 空闲目标已满足，但内存高于最初规格中的 150 MB 目标。v0.5.1 不为追求该数字改写已跑通的数据链；真实数据测试稳定后再比较 Electron 调优与 Tauri/其他轻量桌面壳的迁移成本。
- 完全无任务痕迹的后台 COROS MCP 查询仍受 Codex 宿主权限边界限制；桌面端只能无感读取已发布到本机的最新快照。

## 当前 P0

2026-07-28 已重新读取真实 COROS 健康、睡眠、心率、HRV、恢复、活动、计划和七日负荷，并成功发布到桌面。真实截图显示血氧长期不可用，因此 v0.5.4 将该位置改为优先展示 COROS 日均压力；无压力数据时仍回退血氧。v0.5.5 增加三种简洁小组件比例。当前 PR A 进一步确保主观安全确认不足或触发停止路径时，高设备恢复值和原始模型文字不能被误读为训练许可。

## 下一步

1. 审查 PR A 的安全呈现、合成截图和公开说明；合并与发布仍需单独授权。
2. 在后续 PR B 处理逐项指标新鲜度和来源呈现，不与 PR A 混合。
3. 在另一台测试机执行交互式安装 / 升级 / 卸载；本机已完成隔离静默安装/卸载，并实际确认任务栏显示 Pulse 图标。
4. 用连续多日真实 COROS 数据复测训练、健康、计划和七日负荷字段。
5. 在另一台 Windows 设备完成安装、升级、卸载和系统 DPI 目视复测；未完成代码签名前继续标记为 unsigned beta。

## 相关文档

- [v0.5 实施说明](V0.5_LLM_PLUGIN_BETA.md)
- [桌面交接约定](BRIDGE_CONTRACT.md)
- [产品路线图](ROADMAP.md)
- [Codex 插件说明](CODEX_PLUGIN.md)
- [v0.5.1 完成度审计](V0.5.1_COMPLETION_AUDIT.md)
- [v0.5.2 Windows 托盘图标修复](V0.5.2_TRAY_ICON_FIX.md)
- [v0.5.3 Windows 任务栏图标修复](V0.5.3_TASKBAR_ICON_FIX.md)
- [v0.5.4 日均压力卡片](V0.5.4_STRESS_CARD.md)
- [v0.5.4 发布候选审计](V0.5.4_RELEASE_AUDIT.md)
- [v0.5.5 简洁小组件发布说明](RELEASE_NOTES_V0.5.5_BETA.md)
- [v0.5.5 发布候选审计](V0.5.5_RELEASE_AUDIT.md)
- [v0.5.6 候选变化](RELEASE_NOTES_V0.5.6_CANDIDATE.md)
- [PR A 训练安全呈现设计](superpowers/specs/2026-08-10-pulse-training-safety-presentation-design.md)
- [供应链与发布产物](SUPPLY_CHAIN.md)
- [原始需求追踪矩阵](REQUIREMENTS_TRACEABILITY.md)
