(function exposeSafetyPresentation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PulseSafetyPresentation = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const RECOVERY_LABELS = Object.freeze({
    heavy_training_allowed: '可进行较高负荷',
    training_as_planned: '可按计划训练',
    easy_training_recommended: '建议轻松训练',
    rest_recommended: '建议恢复或休息',
    unknown: '暂无判断',
    fallback: '按状态调整'
  });

  const INSUFFICIENT = Object.freeze({
    mode: 'data_insufficient',
    ruleId: 'safety.data_insufficient_override',
    insight: Object.freeze({
      text: '当前缺少完整的主观疲劳与安全确认，仅展示客观数据，不提供训练强度建议。',
      tags: Object.freeze(['数据不足', '仅展示客观数据'])
    }),
    recovery: Object.freeze({ label: '设备恢复数据 · 仅作客观参考', prescriptive: false }),
    plan: Object.freeze({
      titlePrefix: '待确认 · ',
      description: '完成当前状态确认后再决定是否执行原计划。',
      loadVisible: false,
      stateLabel: '待确认'
    }),
    announcement: Object.freeze({ role: 'status', politeness: 'polite' })
  });

  const STOPPED = Object.freeze({
    mode: 'stop_refer',
    ruleId: 'safety.stop_override',
    insight: Object.freeze({
      text: '当前状态需要安全优先，Pulse 已停止训练建议。如症状持续或加重，请寻求适当的专业评估。',
      tags: Object.freeze(['安全优先', '停止训练建议'])
    }),
    recovery: Object.freeze({ label: '当前不用于训练决策', prescriptive: false }),
    plan: Object.freeze({
      titlePrefix: '原计划 · ',
      description: '当前状态下暂停训练建议；如症状持续或加重，请寻求适当的专业评估。',
      loadVisible: false,
      stateLabel: '已暂停'
    }),
    announcement: Object.freeze({ role: 'alert', politeness: 'assertive' })
  });

  function clonePolicy(policy) {
    return {
      ...policy,
      insight: { ...policy.insight, tags: [...policy.insight.tags] },
      recovery: { ...policy.recovery },
      plan: { ...policy.plan },
      announcement: { ...policy.announcement }
    };
  }

  function buildSafetyPresentation(snapshot) {
    const status = snapshot?.readiness?.status;
    if (status === 'stop_refer') return clonePolicy(STOPPED);
    if (status !== 'ready') return clonePolicy(INSUFFICIENT);

    const insight = snapshot?.insight || {};
    const plan = snapshot?.plan || {};
    const recoveryLevel = snapshot?.health?.recovery?.level;
    return {
      mode: 'ready',
      ruleId: 'safety.ready_passthrough',
      insight: {
        text: insight.text || '暂无洞察，请点击重新生成。',
        tags: Array.isArray(insight.tags) ? [...insight.tags] : []
      },
      recovery: {
        label: Object.hasOwn(RECOVERY_LABELS, recoveryLevel)
          ? RECOVERY_LABELS[recoveryLevel]
          : RECOVERY_LABELS.fallback,
        prescriptive: true
      },
      plan: {
        titlePrefix: '',
        description: plan.description || plan.name || '今天没有计划安排',
        loadVisible: true,
        stateLabel: ''
      },
      announcement: { role: 'status', politeness: 'polite' }
    };
  }

  return { buildSafetyPresentation };
}));
