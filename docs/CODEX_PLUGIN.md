# Pulse Dashboard Codex Plugin

## 作用

`pulse-dashboard` 插件指导 Codex 使用当前环境已经连接并授权的 COROS MCP，生成标准化的 Pulse 健康与训练快照、每日建议和训练复盘，并把同一份快照发布给本机 Pulse Desktop。v0.5.5 同时为桌面看板提供 16:9、4:3 和 21:9 简洁小组件布局。

插件不提供 COROS 登录、OAuth、Token 或供应商 API，也不保存原始 MCP 响应。桌面应用无法继承 Codex 任务的 MCP 权限，因此每次新的 COROS 查询都必须由 Codex 任务发起。

## 从 GitHub 安装

仓库包含 Codex marketplace：

```text
.agents/plugins/marketplace.json
plugins/pulse-dashboard/
```

安装命令：

```powershell
codex plugin marketplace add gronbow/pulse-dashboard --ref main
codex plugin add pulse-dashboard@pulse-dashboard
```

安装或更新后请新建 Codex 任务，使插件被重新加载。

## 使用顺序

1. 启动 Pulse Desktop，在设置中选择“Codex + COROS MCP”。
2. 确认 Codex 中已经连接并授权 COROS MCP。
3. 在新的 Codex 任务中输入：`刷新我的 Pulse 今日健康与训练快照`。
4. 插件读取并归一化数据，通过质量门后发布到 `http://127.0.0.1:19091/api/snapshot`。
5. Pulse 收到发布事件后自动更新桌面卡片。

还可以使用：

- `根据我最新的 COROS 数据，给出明日训练建议。`
- `复盘我今天的训练，并更新 Pulse 洞察。`
- `刷新 Pulse 简洁小组件，显示步数、今日消耗、静息心率和睡眠时长。`

简洁小组件中的“今日消耗”是当天已记录活动的 `calories` 合计，不代表全天总能量消耗；缺失值保持为 `—`，不会用 0 或演示数据补齐。

## 数据范围与质量门

插件尽量读取睡眠、静息心率、睡眠 HRV、恢复状态、步数、日均压力、今日活动、训练计划和最近七日训练负荷，并生成 `meta`、`health`、`todayActivities`、`plan`、`load`、`trends`、`insight` 七类字段。

发布前必须满足：

- 至少两个有效健康信号。
- 洞察基于刚读取的数据，不是占位文本。
- 距离大于 0 的活动必须有大于 0 的时长。
- 中文字段保持 UTF-8，不出现明显乱码。
- 缺失值使用 `null`、空数组或明确无数据状态，不用 `0` 补齐。

未通过质量门时保留桌面端上一份完整快照，并向用户说明原因。

## 当前限制

- 桌面右上角“读取同步”只读取本机已发布快照，不会调用 COROS。
- 当前不启用会创建可见 Codex 任务记录的定时 MCP 查询。
- Handoff 只传递归一化快照，不传递 Codex/COROS 凭据。
- AI 建议仅供训练参考，不构成医疗建议。

完整工作流规则见 [`skills/pulse-dashboard/SKILL.md`](../skills/pulse-dashboard/SKILL.md)，桌面接口见 [`BRIDGE_CONTRACT.md`](BRIDGE_CONTRACT.md)。
