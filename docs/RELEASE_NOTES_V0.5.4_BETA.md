# Pulse Dashboard v0.5.4 Beta

Pulse Dashboard 的首个公开 Beta 已打通：

```text
COROS MCP → Codex Pulse 插件 → 本机 Handoff → Windows 桌面看板
```

这是 Codex 宿主型桌面伴侣，不是独立 COROS 客户端。新的即时数据查询仍需从 Codex 任务发起；桌面按钮只读取最近一次成功发布的本机快照。

## 示例截图

所有截图均为合成演示数据或首次同步空状态，不含真实健康信息。

| 总览 | 健康与负荷 |
| --- | --- |
| ![Pulse 总览](https://raw.githubusercontent.com/gronbow/pulse-dashboard/main/docs/assets/pulse-dashboard-v0.5.4-demo.png) | ![Pulse 健康与七日负荷](https://raw.githubusercontent.com/gronbow/pulse-dashboard/main/docs/assets/pulse-dashboard-health-load-demo.png) |

![Pulse 首次同步空状态](https://raw.githubusercontent.com/gronbow/pulse-dashboard/main/docs/assets/pulse-dashboard-awaiting-sync.png)

## 主要内容

- Windows 无边框圆角桌面窗口、托盘、置顶、透明度、主题、紧凑模式和开机启动。
- 睡眠、静息心率、HRV、恢复、步数、日均压力/兼容血氧、今日训练、计划和最近七日训练负荷。
- Codex 基于有效健康与训练信号生成 AI 今日洞察。
- Codex 发布成功后，桌面端立即自动读取。
- 不完整快照、零时长跑步、乱码和真实模式下的 Demo 回退会被阻止。
- Windows 托盘和任务栏均使用 Pulse 原生图标。

## 安装

1. 下载并运行 `Pulse-Dashboard-Setup-0.5.4-x64.exe`。
2. 安装 Codex 插件：

   ```powershell
   codex plugin marketplace add gronbow/pulse-dashboard --ref main
   codex plugin add pulse-dashboard@pulse-dashboard
   ```

3. 新建 Codex 任务，确认已经连接并授权 COROS MCP。
4. Pulse 设置选择“Codex + COROS MCP”。
5. 在 Codex 中输入：`刷新我的 Pulse 今日健康与训练快照`。

安装包未做代码签名，SmartScreen 可能显示警告。请仅从本 Release 下载，并使用随附 `SHA256SUMS.txt` 核对文件。

## 重要限制

- 仅验证 Windows 10/11 x64；没有 macOS/Linux 安装包。
- Electron 不能继承 Codex MCP 权限，无法由桌面刷新按钮直接查询 COROS。
- 默认不创建有可见运行记录的 Codex 定时任务，因此不是无痕后台同步。
- 规范化健康快照以明文 JSON 保存在当前 Windows 用户的应用数据目录。
- 当前未签名、无自动更新；本机发布候选总工作集约 404 MB。
- AI 洞察仅供训练参考，不构成医疗建议。
- Pulse 不是 COROS 官方产品，双方不存在官方隶属或背书关系。

更多说明、数据流、隐私边界和故障排查请阅读仓库 [README](https://github.com/gronbow/pulse-dashboard#readme)。
