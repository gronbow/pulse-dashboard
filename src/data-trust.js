(function exposeDataTrust(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PulseDataTrust = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const PROVENANCE_VALUES = Object.freeze([
    'coros',
    'derived',
    'user',
    'demo',
    'local',
    'mixed',
    'unknown'
  ]);
  const PROVENANCE_SET = new Set(PROVENANCE_VALUES);
  const SOURCE_LABELS = Object.freeze({
    coros: 'COROS',
    derived: '汇总',
    user: '用户确认',
    demo: '演示',
    local: '本地源',
    mixed: '多来源',
    unknown: '来源未知'
  });

  function normalizeProvenance(value, fallback = 'unknown') {
    if (typeof value === 'string' && PROVENANCE_SET.has(value)) return value;
    return PROVENANCE_SET.has(fallback) ? fallback : 'unknown';
  }

  function combineProvenance(values) {
    const normalized = (Array.isArray(values) ? values : []).map((value) => normalizeProvenance(value));
    if (!normalized.length) return 'unknown';
    const unique = new Set(normalized);
    return unique.size === 1 ? normalized[0] : 'mixed';
  }

  function validDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    return candidate.getUTCFullYear() === year
      && candidate.getUTCMonth() === month - 1
      && candidate.getUTCDate() === day;
  }

  function dateKeyInTimezone(timestamp, timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date(timestamp));
      const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
      const dateKey = `${values.year}-${values.month}-${values.day}`;
      return validDateKey(dateKey) ? dateKey : '';
    } catch {
      return '';
    }
  }

  function inferProvenance(meta) {
    if (!meta || typeof meta !== 'object') return 'unknown';
    const source = Object.hasOwn(meta, 'source') ? meta.source : undefined;
    const provider = Object.hasOwn(meta, 'provider') ? meta.provider : undefined;
    if (source === 'demo') return 'demo';
    if (provider === 'codex-coros-mcp') return 'coros';
    if (provider === 'mcp-bridge' || source === 'bridge' || source === 'cache') return 'local';
    return 'unknown';
  }

  function entityProvenance(entity, meta) {
    if (entity && typeof entity === 'object' && Object.hasOwn(entity, 'provenance')) {
      return normalizeProvenance(entity.provenance);
    }
    return inferProvenance(meta);
  }

  function datePresentation(rawDate, timezone, now, allowFuture) {
    if (rawDate == null || rawDate === '') {
      return { state: 'unknown', freshnessLabel: '日期未知', compactLabel: '日期未知' };
    }
    if (!validDateKey(rawDate)) {
      return { state: 'unknown', freshnessLabel: '日期异常', compactLabel: '日期异常' };
    }
    const today = dateKeyInTimezone(now, timezone);
    if (!today) return { state: 'unknown', freshnessLabel: '日期未知', compactLabel: '日期未知' };
    const ageDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${rawDate}T00:00:00Z`)) / 86_400_000);
    if (ageDays < 0) {
      if (!allowFuture) return { state: 'unknown', freshnessLabel: '日期异常', compactLabel: '日期异常' };
      const [, month, day] = rawDate.split('-').map(Number);
      return { state: 'scheduled', freshnessLabel: `${month}月${day}日`, compactLabel: `${month}/${day}` };
    }
    if (ageDays === 0) return { state: 'current', freshnessLabel: '今日', compactLabel: '今日' };
    if (ageDays === 1) return { state: 'recent', freshnessLabel: '昨日', compactLabel: '昨日' };
    if (ageDays === 2) return { state: 'recent', freshnessLabel: '2天前', compactLabel: '2天前' };
    const [, month, day] = rawDate.split('-').map(Number);
    return {
      state: 'old',
      freshnessLabel: `${month}月${day}日`,
      compactLabel: `${month}/${day}`
    };
  }

  function buildDataTrust(entity, meta = {}, {
    now = Date.now(),
    available = true,
    allowFuture = false
  } = {}) {
    const safeEntity = entity && typeof entity === 'object' ? entity : {};
    const provenance = entityProvenance(safeEntity, meta);
    const sourceLabel = SOURCE_LABELS[provenance];
    const rawDate = Object.hasOwn(safeEntity, 'date') ? safeEntity.date : null;
    const dateState = available
      ? datePresentation(rawDate, meta?.timezone || 'Asia/Shanghai', now, allowFuture)
      : { state: 'unavailable', freshnessLabel: '暂无数据', compactLabel: '暂无数据' };
    const label = `${dateState.freshnessLabel} · ${sourceLabel}`;
    return {
      state: dateState.state,
      provenance,
      freshnessLabel: dateState.freshnessLabel,
      sourceLabel,
      label,
      compactLabel: dateState.compactLabel,
      title: `数据日期：${dateState.freshnessLabel}；来源：${sourceLabel}`
    };
  }

  return {
    PROVENANCE_VALUES,
    buildDataTrust,
    combineProvenance,
    inferProvenance,
    normalizeProvenance
  };
}));
