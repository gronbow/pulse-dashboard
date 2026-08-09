---
name: pulse-dashboard
description: 在 Codex 中调用已连接的 COROS MCP，生成 Pulse 健康训练快照、训练建议、训练复盘，并更新桌面看板与 16:9、4:3、21:9 简洁小组件。触发方式：Pulse、刷新看板、刷新简洁小组件、今日训练建议、训练复盘、健康快照。
---

# Pulse Dashboard

Pulse 是 Codex 中 COROS MCP 健康教练的桌面呈现能力。它不管理 COROS 登录、密码或令牌；所有已授权数据只通过当前 Codex 宿主可用的 COROS MCP 工具读取。

## 适用请求

- 刷新或生成 Pulse 今日健康与训练快照。
- 生成或更新 Pulse 16:9、4:3、21:9 简洁小组件所需的同一健康训练快照。
- 根据今日状态给出明日训练建议。
- 分析今日或最近一次训练，并生成看板洞察。
- 解释睡眠、恢复、静息心率、HRV、日均压力、训练负荷和训练计划之间的关系。

## 快照工作流

1. 使用用户时区；默认 `Asia/Shanghai`，除非用户明确给出其他时区。
2. 尽量并行读取最近 7 日的日常健康摘要（包括步数和日均压力）、睡眠、静息心率、睡眠 HRV 和短长期训练负荷，同时读取当前恢复状态、今日运动记录及今日到近期的训练计划。仅调用 COROS MCP 当前确实提供的工具，不假定不存在的字段或端点。
3. 今日运动列表若只有距离、没有时长、心率或训练效果，应继续读取该活动的详情。不得把“有距离但时长为 0”的记录发布为已完成训练。
4. 将数据归一化为 Pulse 快照：`meta`、`health`、`todayActivities`、`plan`、`load`、`trends` 和 `insight`。日均压力写入 `health.stress = { value, unit: "score", date }`，取值必须来自 COROS 日常健康摘要；缺失值必须使用 `null`、空数组或“暂无数据”，不能用 `0` 冒充已读取结果。
5. 当当天睡眠、静息心率或睡眠 HRV 尚未归档时，可采用最近 7 日内最新的有效值，但必须在对应指标写入真实 `date`（`YYYY-MM-DD`）；不得把前一日值标成今日值。步数、日均压力和恢复状态同样写入各自数据日期。
6. `trends.trainingLoad` 必须尽量包含最近 7 日逐日记录，按日期从旧到新排列；每项使用 `{ date, shortTerm, longTerm, ratio, comment }`。`load` 保存最新一天的短期负荷、长期负荷、比值和评价。
7. 训练计划写入实际 `plan.date`。若今天无活动，只能写“截至快照时间暂无训练记录”；仅在计划明确为休息日时才判断“休息日”。若今天无课表而近期有课表，可展示最近下一课并保留其真实日期。
8. 若用户只要求刷新或展示看板，不要为了主观问卷阻断客观数据同步；将 `readiness.status` 设为 `data_insufficient`、`confidence` 设为 `low`、`recommendationLevel` 设为 `informational`，洞察只描述数据和限制，不给训练强度。
9. 若用户要求今日/明日训练强度建议，先复用最近 36 小时内已明确回答的主观状态；仍缺失时只询问影响安全与安排的最小问题：疲劳 0–10、酸痛 0–10，以及是否有疼痛、生病、胸部不适或头晕。不要重复询问已经确认且仍在时效内的项目。
10. 把主观状态写入 `readiness.subjective`，并按下方安全门生成 `ready`、`data_insufficient` 或 `stop_refer`。穿戴设备的恢复分数、HRV 或训练负荷不能覆盖疼痛、胸部不适或头晕。
11. 基于本次读取的数据生成简洁洞察；至少综合两个有效健康信号，并在有训练记录时纳入训练完成情况。数据不足时说明限制，不补全推测。
12. 输出时先发布同一份标准 JSON，再给出用户可读的简洁教练判断。不要输出令牌、完整个人资料、坐标、活动标识符或原始 MCP 响应。
13. 对训练建议说明它仅供训练参考，不构成医疗建议。

## 发布前质量门

只有同时满足下列条件，才可覆盖桌面看板现有快照：

- 至少有两个有效健康信号，例如睡眠时长或评分、静息心率、HRV、日均压力、步数、恢复状态；若采用最近有效值，必须同时包含其真实日期。
- `insight.text` 若存在，必须是基于刚读取数据生成的有效洞察，不能是占位文本。洞察生成失败时仍应发布通过质量门的客观数据，并将洞察留空；不得让文字生成失败阻断健康与训练数据更新。
- 任何距离大于 0 的活动都包含大于 0 的时长。
- 中文运动名称、计划和洞察保持 UTF-8，无成串问号或替换字符。
- 最近 7 日训练负荷可用时，必须发布为 `trends.trainingLoad`，不能只发布最新比值。
- `meta.asOf` 与 `meta.lastUpdated` 必须是有效 ISO 8601 时间；发布时 `lastUpdated` 不得早于 36 小时前，也不得写入未来时间。
- 今日活动最多 32 条、洞察标签最多 8 个、逐日负荷最多 31 条；各指标日期必须是有效 `YYYY-MM-DD`，不能晚于快照日期后的次日。
- 必须包含显式 `readiness`。主观状态未知时使用 `data_insufficient`，不得省略该字段或假定用户无疼痛/疾病。

若不满足质量门，应保留桌面看板中的上一次完整快照，并向用户说明本次未更新的具体原因。

## 教练建议原则

- 优先综合睡眠、恢复、静息心率、HRV、日均压力、短长期负荷与今日计划，而非依赖单一指标。
- 对已有训练计划先判断完成情况和恢复条件，再建议明日安排。
- 不把历史个人最好成绩当作当前能力；训练目标应以近期状态为准。
- 不提供疾病诊断、治疗或替代医疗建议。

### Readiness 安全门

快照使用以下结构：

```json
{
  "readiness": {
    "status": "data_insufficient",
    "confidence": "low",
    "recommendationLevel": "informational",
    "reasons": ["尚未确认当前主观疲劳与安全状态"],
    "subjective": {
      "collectedAt": null,
      "fatigue": null,
      "soreness": null,
      "pain": null,
      "illness": null,
      "chestSymptoms": null,
      "dizziness": null
    }
  }
}
```

- `ready`：六项主观状态在最近 36 小时内完整确认，疼痛、生病、胸部不适和头晕均为否；只有此状态可使用 `easy`、`moderate` 或 `hard` 训练强度，可信度必须为 `moderate` 或 `high`。
- `data_insufficient`：主观状态缺失、过期或存在一般疾病/异常但不足以进入下述停止路径；可信度必须为 `low`，只能给 `informational` 或 `rest`，不能给轻松、中等或高强度训练安排。
- `stop_refer`：报告疼痛、胸部不适或头晕时必须覆盖正常恢复分数，停止训练建议，仅给安全提醒并建议按症状严重程度寻求合适的专业评估；不得诊断疾病或用模型判断可以继续训练。

## 简洁小组件数据口径

桌面简洁小组件只展示四项基础数据：步数、今日消耗、静息心率和睡眠时长。16:9 与 4:3 使用两列卡片布局，21:9 使用四列横向布局；三种比例均由同一份 Pulse 快照驱动。

其中“今日消耗”是当天已记录活动的 `calories` 合计，不代表全天总能量消耗。缺失数据必须保持为 `—`、`null` 或明确的暂无数据状态，不能用 0 或演示值补齐真实模式。

## 与桌面看板的衔接

Pulse Desktop 在选择“Codex + COROS MCP”数据源后，会在本机启动仅监听 `127.0.0.1:19091` 的 Handoff Bridge。完成标准化快照后，在当前 Codex 任务拥有 shell 能力时，必须把同一份 JSON 发布给看板：

```powershell
$snapshotPath = Join-Path $env:TEMP 'pulse-dashboard-snapshot.json'
# 使用宿主提供的文件编辑能力，把完整快照以 UTF-8 写入 $snapshotPath。
$publisherPath = Join-Path '<当前插件根目录>' 'scripts\publish-snapshot.js'
node $publisherPath --file $snapshotPath
```

实际执行时，先根据本 `SKILL.md` 的实际位置解析当前插件根目录，不要硬编码用户名或安装路径。应使用宿主提供的文件编辑能力创建 UTF-8 临时 JSON，不要用 PowerShell here-string 直接传递中文。仅在发布成功后删除该临时文件并给出教练摘要。若桌面看板未启动、shell 不可用或发布失败，要明确告知用户看板未刷新，不能声称数据已经同步。

Handoff 不传递 Codex 或 COROS 凭据，只传递已归一化的快照。后续 `McpClientAdapter` / Pulse MCP Gateway 仍可把相同数据暴露为：

- Resource：`pulse://dashboard/snapshot{?timezone}`
- Tool：`pulse_refresh_snapshot`
- Tool：`pulse_coach_advise`
- Tool：`pulse_coach_chat`

不要把 Codex 托管的 COROS MCP 权限当作桌面 Electron 进程自动可继承的权限。

当前架构也不应声称能够在完全无任务痕迹的情况下定时调用 Codex。未经用户明确同意，不创建或启用会生成可见任务的定时刷新；桌面按钮只读取已成功发布的最新快照。
