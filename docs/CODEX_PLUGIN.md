# Pulse Dashboard Codex Plugin

## 当前实现

首个 LLM Host 是 Codex。可发布的插件源代码现在与桌面端一起保存在仓库根目录：

```text
.codex-plugin/
skills/pulse-dashboard/
scripts/publish-snapshot.js
```

本机开发安装可使用个人插件目录和个人 marketplace，例如：

```text
%USERPROFILE%\plugins\pulse-dashboard
%USERPROFILE%\.agents\plugins\marketplace.json
```

插件名为 `pulse-dashboard`。它指导 Codex 使用已连接的 COROS MCP 工具，生成标准化 Pulse 快照、每日训练建议和训练复盘，并在本机 Pulse 桌面版运行时把快照发布给它。

## 当前能力

- “刷新我的 Pulse 今日健康与训练快照”。
- “根据我最新的 COROS 数据，给出明日训练建议”。
- “复盘我今天的训练，并更新 Pulse 洞察”。
- 将已生成的完整快照发布到本机 `http://127.0.0.1:19091/api/snapshot`，由桌面看板展示。
- 查询并发布最近七日训练负荷；当天指标尚未归档时，使用带日期的最近有效值而不是补零。

插件不保存 COROS 密码、Token 或原始个人数据，也不直接调用供应商 API。发布脚本只接受 `localhost` / `127.0.0.1` 地址。

## 使用顺序

1. 启动 Pulse 桌面版，在设置中选择“Codex + COROS MCP”。
2. 在 Codex 新任务中使用 Pulse 插件刷新快照。
3. 插件生成快照后将其发布到本机 Handoff；Pulse 会立即自动读取并更新桌面卡片，而不是只在聊天中显示文字。

若 Codex 尚未显示插件，可在可访问 Codex CLI 的终端执行：

```powershell
codex plugin add pulse-dashboard@personal
```

安装或更新插件后，请新开一个 Codex 任务再测试；新任务是 Codex 载入技能和工具变更的安全边界。

## 当前限制

发布在用户主动刷新 Pulse 快照时发生，尚未提供完全无任务痕迹的后台 MCP 查询。Electron 不能继承 Codex 的 MCP 权限，因此不会自行调用 COROS；这是有意保留的隐私和授权边界。

插件和 Handoff 都会拒绝不完整数据、零时长跑步和明显乱码，并保留上一次完整结果。后续工作是继续打磨真实数据可视化验收，而不是转向独立 COROS OAuth。
