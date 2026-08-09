# Pulse PR A：训练安全呈现设计

日期：2026-08-10
状态：待用户审核后实施

## 背景

Pulse 已在快照归一化后推导最终 `readiness` 状态：疼痛、胸部症状或头晕会触发 `stop_refer`；来源不可信、数据过期、字段不完整或原状态非 ready 时会降级为 `data_insufficient`。

当前渲染器没有统一应用这一状态。模型洞察、设备恢复等级和训练计划始终照常显示，因此同一快照可能一边显示“数据不足”，一边显示“可进行较高负荷”或“可按计划训练”。PR A 将消除这种矛盾，但不改变 COROS MCP 边界，也不引入医疗阈值。

## 目标

1. 让最终的 `readiness.status` 成为训练许可类文字的唯一权威。
2. 让 `stop_refer` 和 `data_insufficient` 统一覆盖洞察、恢复提示、计划详情及标签。
3. 在有价值时保留客观数值，同时明确其不等同于训练许可。
4. 为每条确定性呈现路径提供稳定规则 ID，供测试和本地诊断使用。
5. 当可信、当前且完整的安全门已通过时，保留现有 `ready` 呈现。

## 不在本 PR 范围内

- 不进行医疗诊断、医疗许可或新增生理阈值判断。
- 不使用关键词过滤来审查任意模型文本。
- 不修改逐项指标新鲜度、活动日期或数据来源契约；这些属于 PR B。
- 不重做刷新状态、简洁小组件或渲染器整体架构。
- 不创建 Release、标签、安装包或插件发布。

## 备选方案

### 方案一：在每张卡片中分别增加条件

改动最小，但会把安全规则分散在洞察、恢复和计划区域。未来新增卡片时容易遗漏覆盖逻辑，再次产生矛盾。

### 方案二：增加单一纯函数安全呈现层——推荐

在 DOM 渲染前，由一个纯函数根据归一化快照推导完整的安全呈现策略。渲染器的所有训练建议类区域只消费这一结果。大多数行为可脱离 Electron 做单元测试，再用真实 Electron 测试验证最终 DOM。

### 方案三：通过高风险词语过滤模型输出

虽然可以拦截“高负荷”等文字，但它依赖语言和上下文，无法真正修复状态权威问题，因此不采用。

## 架构

新增 `src/safety-presentation.js`，导出纯函数 `buildSafetyPresentation(snapshot)`。输入仅为归一化快照，输出完整的呈现对象：

```js
{
  mode: 'ready' | 'data_insufficient' | 'stop_refer',
  ruleId: 'safety.ready_passthrough' | 'safety.data_insufficient_override' | 'safety.stop_override',
  insight: { text, tags },
  recovery: { label, prescriptive },
  plan: { titlePrefix, description, loadVisible, stateLabel },
  announcement: { role, politeness }
}
```

`src/renderer/app.js` 每次渲染只调用一次该函数，并将结果用于 AI 洞察、恢复提示和训练计划。源快照保持不变。`document.body.dataset.safetyRule` 暴露当前规则 ID，供确定性 UI 测试和不含隐私数据的本地诊断使用。

## 状态规则

### `stop_refer`

- 规则 ID：`safety.stop_override`。
- 洞察固定替换为：“当前状态需要安全优先，Pulse 已停止训练建议。如症状持续或加重，请寻求适当的专业评估。”
- 洞察标签固定为 `安全优先`、`停止训练建议`；不渲染模型原始洞察和标签。
- 洞察区域使用警报语义，状态芯片保持“安全优先 · 停止训练”。
- 可以保留恢复百分比这个客观设备数值，但提示固定为“当前不用于训练决策”。
- 计划标题增加“原计划 ·”前缀；隐藏原始训练详情和负荷，改为“当前状态下暂停训练建议；如症状持续或加重，请寻求适当的专业评估。”
- 计划状态显示“已暂停”。已经完成的活动历史保持可见，不作改写。

### `data_insufficient`

- 规则 ID：`safety.data_insufficient_override`。
- 洞察固定替换为：“当前缺少完整的主观疲劳与安全确认，仅展示客观数据，不提供训练强度建议。”
- 洞察标签固定为 `数据不足`、`仅展示客观数据`；不渲染模型原始洞察和标签。
- 可以保留恢复百分比，但提示固定为“设备恢复数据 · 仅作客观参考”。
- 计划标题增加“待确认 ·”前缀；隐藏原始训练详情和负荷，改为“完成当前状态确认后再决定是否执行原计划。”
- 计划状态显示“待确认”。

### `ready`

- 规则 ID：`safety.ready_passthrough`。
- 归一化后的洞察、恢复提示、计划标题、详情和负荷保持现状。
- 本层不能把非 ready 快照升级为 ready，也不根据原始健康数值自行计算 readiness。

### 未知或畸形状态

按 `data_insufficient` 处理，默认关闭训练许可类内容，绝不透传建议。

## 无障碍与视觉行为

- 新增独立的计划状态元素，不只依靠颜色表达“已暂停”或“待确认”。
- `stop_refer` 将洞察文本元素设置为 `role="alert"`、`aria-live="assertive"`；`data_insufficient` 和 `ready` 使用 `role="status"`、`aria-live="polite"`。
- 使用现有颜色变量增加克制的 stop 和 insufficient 卡片状态，不改变看板网格或简洁小组件尺寸。
- 合成演示数据继续保留 `heavy_training_allowed + data_insufficient` 这一故意矛盾组合；更新后的截图将作为“界面成功中和设备许可文字”的回归示例。

## 测试设计

1. 先新增 `scripts/test-safety-presentation.js`，并确认它因为目标模块尚不存在而失败。
2. 覆盖 `ready`、`data_insufficient`、`stop_refer` 和未知状态，精确验证文字、标签、规则 ID、恢复状态和计划状态。
3. 加入 `data_insufficient + heavy_training_allowed` 回归断言，确保结果不包含“可进行较高负荷”“可按计划训练”或模型原始强度建议。
4. 使用真实渲染器增加 Electron 安全状态测试，覆盖 `data_insufficient` 和 `stop_refer` 的 DOM 文字、计划状态、ARIA 语义和 `data-safety-rule`。
5. 扩展 UI 合约测试，验证计划状态元素和警报语义。
6. 创建 Draft PR 前运行聚焦测试、`npm test`、`npm run test:ui`、依赖审计、公开隐私审计和 `git diff --check`。

## 文档

更新候选发布说明、开发状态、需求追踪和 README 安全文字。明确说明设备恢复值只是输入，不是训练许可；任何非 ready 状态都会抑制训练执行建议。

## 验收标准

- `stop_refer` 或 `data_insufficient` 页面中，洞察、恢复或计划均不出现许可训练的文字。
- `ready` 保留现有呈现，并继续受可信来源、快照时效和主观安全确认限制。
- 故意矛盾的演示快照显示中性的恢复提示和“待确认”计划状态。
- 屏幕阅读器对 `stop_refer` 获得 assertive 通知，对 `data_insufficient` 获得 polite 通知。
- 所有聚焦和全仓库检查通过，源码、测试、截图和文档中不加入真实健康数据。
