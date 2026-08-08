const $ = (selector) => document.querySelector(selector);
let snapshot;
let config;
let refreshTimer;

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}′${String(s).padStart(2, '0')}″`;
}

function formatMinutes(minutes) {
  if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0) return '—';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function formatPace(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return '—';
  return `${Math.floor(seconds / 60)}′${String(seconds % 60).padStart(2, '0')}″/km`;
}

function setText(selector, value) { $(selector).textContent = value; }

function calendarDateKey(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }
}

function dateParts(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  } catch {
    return {
      month: String(date.getMonth() + 1),
      day: String(date.getDate()),
      hour: String(date.getHours()).padStart(2, '0'),
      minute: String(date.getMinutes()).padStart(2, '0')
    };
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function shortDateLabel(value) {
  const match = String(value || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}月${Number(match[2])}日` : '';
}

function datedNote(label, metricDate, currentDateKey) {
  const dateLabel = metricDate && metricDate !== currentDateKey ? shortDateLabel(metricDate) : '';
  return dateLabel ? `${label} · ${dateLabel}` : label;
}

function applyTheme() {
  const isLight = config.theme === 'light' || (config.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.body.classList.toggle('light', isLight);
}

function applyDisplayMode() {
  document.body.classList.toggle('compact', Boolean(config.compactMode));
  document.body.dataset.compactRatio = config.compactAspectRatio || '16:9';
}

function compactSourceLabel(source, meta, isStaleCodex) {
  if (source === 'unavailable') return '待同步';
  if (isStaleCodex) return '旧快照';
  if (source === 'demo') return '演示';
  if (source === 'cache') return '缓存';
  if (meta.provider === 'codex-coros-mcp') return '已同步';
  return '已连接';
}

function renderBars(selector, values, invert = false) {
  const el = $(selector);
  if (!Array.isArray(values) || !values.length) {
    el.innerHTML = '<span class="trend-empty">暂无七日数据</span>';
    return;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  el.innerHTML = values.map((value) => {
    const height = max === min ? 55 : 26 + ((value - min) / (max - min)) * 64;
    const normalized = invert ? 100 - height : height;
    return `<span class="bar" style="height:${Math.max(20, normalized)}%" title="${value}"></span>`;
  }).join('');
}

function renderLoadBars(entries) {
  const el = $('#load-bars');
  const points = Array.isArray(entries)
    ? entries.filter((entry) => Number.isFinite(Number(entry?.shortTerm))).slice(-7)
    : [];
  if (!points.length) {
    el.innerHTML = '<span class="trend-empty">暂无七日负荷</span>';
    return;
  }
  const max = Math.max(...points.map((entry) => Number(entry.shortTerm)), 1);
  el.innerHTML = points.map((entry) => {
    const height = 8 + (Number(entry.shortTerm) / max) * 24;
    const dateLabel = String(entry.date || '').slice(-2).replace(/^0/, '') || '—';
    const detail = [
      shortDateLabel(entry.date),
      `短期 ${entry.shortTerm}`,
      entry.longTerm == null ? '' : `长期 ${entry.longTerm}`,
      entry.ratio == null ? '' : `比值 ${entry.ratio}`
    ].filter(Boolean).join(' · ');
    return `<span class="load-day" title="${escapeHtml(detail)}"><span class="bar" style="height:${height}px"></span><span class="load-day-label">${escapeHtml(dateLabel)}</span></span>`;
  }).join('');
}

function render(snapshotData) {
  snapshot = snapshotData;
  const { health = {}, todayActivities = [], plan = {}, load = {}, trends = {}, insight = {}, readiness = {}, meta = {} } = snapshot;
  const source = meta.source || 'demo';
  const timezone = meta.timezone || config?.timezone || 'Asia/Shanghai';
  const asOf = new Date(meta.asOf || Date.now());
  const lastUpdatedDate = new Date(meta.lastUpdated || meta.asOf || Date.now());
  const todayKey = calendarDateKey(new Date(), timezone);
  const asOfKey = calendarDateKey(asOf, timezone);
  const isCurrentDay = Boolean(asOfKey) && asOfKey === todayKey;
  const isStaleCodex = meta.provider === 'codex-coros-mcp' && !isCurrentDay;
  const sourceBadge = $('#source-badge');
  sourceBadge.textContent = source === 'bridge' && meta.provider === 'codex-coros-mcp'
    ? isStaleCodex ? 'Codex 快照较旧' : 'Codex 已同步'
    : source === 'bridge'
      ? '数据源已连接'
      : source === 'cache'
        ? meta.provider === 'codex-coros-mcp' ? 'Codex 缓存' : '缓存数据'
        : source === 'unavailable'
          ? '等待首次同步'
        : '演示数据';
  sourceBadge.className = `source-badge ${source}${isStaleCodex ? ' stale' : ''}`;
  const compactSourceBadge = $('#compact-source-badge');
  compactSourceBadge.textContent = compactSourceLabel(source, meta, isStaleCodex);
  compactSourceBadge.className = `compact-source ${source}${isStaleCodex ? ' stale' : ''}`;
  const asOfParts = dateParts(asOf, timezone);
  setText(
    '#today-label',
    asOfParts
      ? `${isCurrentDay ? '今天' : '数据日期'}，${asOfParts.month}月${asOfParts.day}日`
      : '数据日期未知'
  );
  const updatedParts = dateParts(lastUpdatedDate, timezone);
  const updatedAt = updatedParts
    ? `${calendarDateKey(lastUpdatedDate, timezone) === todayKey ? '' : `${updatedParts.month}月${updatedParts.day}日 `}${updatedParts.hour}:${updatedParts.minute}`
    : '未知';
  setText('#last-updated', source === 'unavailable'
    ? '尚未同步真实数据'
    : meta.provider === 'codex-coros-mcp'
      ? `Codex 快照 · ${updatedAt}`
      : `最后更新 ${updatedAt}`);
  setText('#compact-date', asOfParts
    ? `${isCurrentDay ? '今天' : '数据'} · ${asOfParts.month}月${asOfParts.day}日`
    : '数据日期未知');
  setText('#compact-updated', source === 'unavailable' ? '等待同步' : updatedAt);
  setText('#insight-button', config?.dataSource === 'codex' ? '读取最新' : '重新生成');

  const readinessChip = $('#readiness-chip');
  const confidenceLabels = { low: '低可信度', moderate: '中可信度', high: '高可信度' };
  const healthSignalCount = Number(readiness.coverage?.healthSignals || 0);
  if (readiness.status === 'stop_refer') {
    readinessChip.textContent = '安全优先 · 停止训练';
    readinessChip.className = 'readiness-chip stop';
  } else if (readiness.status === 'ready') {
    readinessChip.textContent = `可建议 · ${confidenceLabels[readiness.confidence] || '中可信度'}`;
    readinessChip.className = 'readiness-chip ready';
  } else {
    readinessChip.textContent = `数据不足 · ${healthSignalCount} 项客观信号`;
    readinessChip.className = 'readiness-chip insufficient';
  }
  readinessChip.title = readiness.coverage?.subjectiveComplete
    ? '已包含当前主观疲劳与安全确认'
    : '未完整确认疲劳、酸痛、疼痛、疾病、胸部症状和头晕';

  setText('#insight-text', insight.text || '暂无洞察，请点击重新生成。');
  $('#insight-tags').innerHTML = (insight.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

  const totalSeconds = todayActivities.reduce((sum, activity) => sum + (activity.durationSeconds || 0), 0);
  const totalDistance = todayActivities.reduce((sum, activity) => sum + (activity.distanceKm || 0), 0);
  const heartRates = todayActivities.map((activity) => activity.heartRate).filter(Boolean);
  const isPlannedRestDay = ['rest', 'rest_day'].includes(plan.status) && (!plan.date || plan.date === asOfKey);
  setText('#training-status', todayActivities.length
    ? (todayActivities.some((a) => a.status === 'completed') ? '已完成' : '有安排')
    : isPlannedRestDay ? '休息日' : '暂无记录');
  $('#training-empty').hidden = Boolean(todayActivities.length);
  $('#activity-list').innerHTML = todayActivities.map((activity) => `<div class="activity-row">
    <div class="activity-icon">↗</div><div class="activity-main"><div class="activity-name">${escapeHtml(activity.sport || '运动')}</div><div class="activity-sub">${formatDuration(activity.durationSeconds)}${activity.paceSecondsPerKm ? ` · ${formatPace(activity.paceSecondsPerKm)}` : ''} · ${escapeHtml(activity.heartRate ?? '—')} bpm · ${escapeHtml(activity.calories ?? '—')} kcal</div></div><div class="activity-distance">${Number(activity.distanceKm) > 0 ? `${Number(activity.distanceKm).toFixed(2)}<span class="muted tiny"> km</span>` : '—'}</div>
  </div>`).join('');
  setText('#total-distance', totalDistance > 0 ? `${totalDistance.toFixed(2)} km` : '—');
  setText('#total-duration', todayActivities.length ? formatDuration(totalSeconds) : '—');
  setText('#total-heart-rate', heartRates.length ? `${Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length)} bpm` : '—');
  const totalCalories = todayActivities.reduce((sum, activity) => {
    const calories = Number(activity.calories);
    return sum + (Number.isFinite(calories) && calories > 0 ? calories : 0);
  }, 0);
  setText('#compact-calories', totalCalories > 0 ? Math.round(totalCalories).toLocaleString('en-US') : '—');

  setText('#sleep-value', formatMinutes(health.sleep?.durationMinutes || 0));
  setText('#sleep-score', datedNote(`评分 ${health.sleep?.score ?? '—'}`, health.sleep?.date, asOfKey));
  setText('#rhr-value', health.restingHeartRate?.value == null ? '—' : `${health.restingHeartRate.value} bpm`);
  const trend = health.restingHeartRate?.trend;
  setText('#rhr-trend', datedNote(
    trend == null ? '无对比' : `${trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} ${Math.abs(trend)} bpm vs 前日`,
    health.restingHeartRate?.date,
    asOfKey
  ));
  setText('#hrv-value', health.hrv?.value == null ? '—' : `${health.hrv.value} ms`);
  setText('#hrv-status', datedNote(
    health.hrv?.status === 'above_normal' ? '高于个人正常范围' : health.hrv?.status === 'normal' ? '个人正常范围' : '暂无数据',
    health.hrv?.date,
    asOfKey
  ));
  setText('#recovery-value', health.recovery?.value == null ? '—' : `${health.recovery.value}%`);
  const recoveryLabels = {
    heavy_training_allowed: '可进行较高负荷',
    training_as_planned: '可按计划训练',
    easy_training_recommended: '建议轻松训练',
    rest_recommended: '建议恢复或休息',
    unknown: '暂无判断'
  };
  setText('#recovery-level', datedNote(
    recoveryLabels[health.recovery?.level] || '按状态调整',
    health.recovery?.date,
    asOfKey
  ));
  setText('#steps-value', health.steps?.value == null ? '—' : Number(health.steps.value).toLocaleString('en-US'));
  setText('#steps-note', datedNote('今日累计', health.steps?.date, asOfKey));
  setText('#compact-steps', health.steps?.value == null ? '—' : Number(health.steps.value).toLocaleString('en-US'));
  setText('#compact-rhr', health.restingHeartRate?.value == null ? '—' : String(health.restingHeartRate.value));
  setText('#compact-sleep', formatMinutes(health.sleep?.durationMinutes || 0));
  const hasStress = health.stress?.value != null;
  const secondaryIcon = $('#secondary-health-icon');
  secondaryIcon.className = `metric-icon ${hasStress ? 'stress-icon' : 'spo2-icon'}`;
  setText('#secondary-health-icon', hasStress ? '≈' : 'O₂');
  setText('#secondary-health-label', hasStress ? '日均压力' : '血氧');
  setText('#secondary-health-value', hasStress
    ? String(health.stress.value)
    : health.spo2?.value == null ? '—' : `${health.spo2.value}%`);
  setText('#secondary-health-note', hasStress
    ? datedNote('COROS 今日平均 · 0–100', health.stress?.date, asOfKey)
    : datedNote(health.spo2?.value == null ? '设备未提供' : '最近有效值', health.spo2?.date, asOfKey));

  const planDateLabel = plan.date && plan.date !== asOfKey ? shortDateLabel(plan.date) : '';
  const planTitle = plan.title || '未设置训练计划';
  setText('#plan-title', planDateLabel ? `${planDateLabel} · ${planTitle}` : planTitle);
  setText('#plan-description', plan.description || plan.name || '今天没有计划安排');
  setText('#plan-load', plan.load == null ? '—' : `训练负荷 ${plan.load}`);
  const loadSummary = [
    load.shortTerm == null ? '' : `短 ${load.shortTerm}`,
    load.longTerm == null ? '' : `长 ${load.longTerm}`,
    load.ratio == null ? '' : `比 ${load.ratio}`
  ].filter(Boolean).join(' · ');
  setText('#load-summary', loadSummary || '负荷 —');
  renderLoadBars(trends.trainingLoad);
  renderBars('#rhr-bars', trends.restingHeartRate);
  renderBars('#sleep-bars', trends.sleepScore);

  let statusMessage = '';
  if (source === 'unavailable') {
    statusMessage = meta.provider === 'codex-coros-mcp'
      ? `尚未收到首份完整的 Codex 快照：${meta.error || '本机 Handoff 暂无数据'}。请在 Codex 新任务中刷新 Pulse；在成功发布前不会用演示数字冒充真实数据。`
      : `实时桥接暂不可用且尚无同源缓存：${meta.error || '本机数据源暂无快照'}。`;
  } else if (meta.error) {
    statusMessage = meta.provider === 'codex-coros-mcp'
      ? `Codex 快照暂不可用，已保留最近一次完整数据：${meta.error}。在 Codex 中同步成功后，看板会自动读取。`
      : `实时桥接暂不可用，已回退到本地缓存：${meta.error}`;
  } else if (isStaleCodex && asOfParts) {
    statusMessage = `当前显示 ${asOfParts.month}月${asOfParts.day}日的最近一次完整快照；尚未收到今天的数据。旧数据会保留，避免缺失值覆盖。`;
  }
  $('#error-banner').hidden = !statusMessage;
  if (statusMessage) setText('#error-banner', statusMessage);
  document.body.dataset.snapshotReady = 'true';
}

async function refresh() {
  const buttons = ['#refresh-button', '#compact-refresh-button'].map((selector) => $(selector)).filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; });
  setText('#refresh-label', '读取中');
  try {
    render(await window.pulseDesktop.getSnapshot());
  } catch (error) {
    $('#error-banner').hidden = false;
    setText('#error-banner', `看板加载失败：${error.message}`);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    setText('#refresh-label', '读取同步');
  }
}

async function regenerateInsight() {
  if (config.dataSource === 'codex') {
    await refresh();
    return;
  }
  $('#insight-button').disabled = true;
  setText('#insight-text', '正在基于最新数据生成洞察……');
  try {
    const result = await window.pulseDesktop.generateInsight(snapshot);
    setText('#insight-text', result.text);
  } catch (error) {
    setText('#insight-text', `生成失败：${error.message}`);
  } finally {
    $('#insight-button').disabled = false;
  }
}

function armTimer() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, (Number(config.refreshIntervalMinutes) || 30) * 60 * 1000);
}

function updateDataSourceControls() {
  const source = $('#data-source').value;
  $('#bridge-url-row').hidden = source !== 'bridge';
  $('#bridge-help').hidden = source !== 'bridge';
  $('#codex-handoff-help').hidden = source !== 'codex';
  $('#test-bridge-button').textContent = source === 'codex' ? '测试 Codex 连接' : '测试桥接';
}

function updateDisplayModeControls() {
  $('#compact-aspect-ratio-row').hidden = !$('#compact-mode').checked;
}

async function openSettings() {
  $('#data-source').value = config.dataSource || 'demo';
  $('#bridge-url').value = config.bridgeUrl || '';
  $('#refresh-interval').value = String(config.refreshIntervalMinutes || 30);
  $('#data-retention-days').value = String(config.dataRetentionDays || 7);
  $('#always-on-top').checked = Boolean(config.alwaysOnTop);
  $('#launch-at-login').checked = Boolean(config.launchAtLogin);
  $('#compact-mode').checked = Boolean(config.compactMode);
  $('#compact-aspect-ratio').value = config.compactAspectRatio || '16:9';
  $('#theme').value = config.theme || 'dark';
  $('#opacity').value = String(config.opacity || 96);
  setText('#opacity-label', `${config.opacity || 96}%`);
  setText('#bridge-test-status', '');
  setText('#clear-local-data-status', '');
  updateDataSourceControls();
  updateDisplayModeControls();
  if (!$('#settings-dialog').open) $('#settings-dialog').showModal();
}

async function testBridge() {
  const button = $('#test-bridge-button');
  button.disabled = true;
  setText('#bridge-test-status', '测试中……');
  try {
    const result = await window.pulseDesktop.testBridge($('#bridge-url').value, config.timezone, $('#data-source').value);
    setText('#bridge-test-status', result.ok ? result.message : `失败：${result.message}`);
  } catch (error) {
    setText('#bridge-test-status', `失败：${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  config = await window.pulseDesktop.updateConfig({
    dataSource: $('#data-source').value,
    bridgeUrl: $('#bridge-url').value,
    timezone: config.timezone,
    refreshIntervalMinutes: Number($('#refresh-interval').value),
    dataRetentionDays: Number($('#data-retention-days').value),
    alwaysOnTop: $('#always-on-top').checked,
    launchAtLogin: $('#launch-at-login').checked,
    compactMode: $('#compact-mode').checked,
    compactAspectRatio: $('#compact-aspect-ratio').value,
    theme: $('#theme').value,
    opacity: Number($('#opacity').value)
  });
  applyDisplayMode();
  applyTheme();
  $('#settings-dialog').close();
  armTimer();
  await refresh();
}

async function clearLocalData() {
  const button = $('#clear-local-data-button');
  button.disabled = true;
  setText('#clear-local-data-status', '');
  try {
    const result = await window.pulseDesktop.clearLocalData();
    setText('#clear-local-data-status', result.cleared ? '已清除' : '已取消');
    if (result.cleared) await refresh();
  } catch (error) {
    setText('#clear-local-data-status', `失败：${error.message}`);
  } finally {
    button.disabled = false;
  }
}

$('#refresh-button').addEventListener('click', refresh);
$('#insight-button').addEventListener('click', regenerateInsight);
$('#settings-button').addEventListener('click', openSettings);
$('#hide-button').addEventListener('click', () => window.pulseDesktop.hide());
$('#compact-refresh-button').addEventListener('click', refresh);
$('#compact-settings-button').addEventListener('click', openSettings);
$('#compact-hide-button').addEventListener('click', () => window.pulseDesktop.hide());
$('#settings-form').addEventListener('submit', saveSettings);
$('#test-bridge-button').addEventListener('click', testBridge);
$('#clear-local-data-button').addEventListener('click', clearLocalData);
$('#data-source').addEventListener('change', updateDataSourceControls);
$('#compact-mode').addEventListener('change', updateDisplayModeControls);
$('#opacity').addEventListener('input', (event) => setText('#opacity-label', `${event.target.value}%`));
window.pulseDesktop.onRefresh(refresh);
window.pulseDesktop.onOpenSettings(openSettings);

(async function init() {
  config = await window.pulseDesktop.getConfig();
  applyDisplayMode();
  applyTheme();
  armTimer();
  await refresh();
})();
