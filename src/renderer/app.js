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

function applyTheme() {
  const isLight = config.theme === 'light' || (config.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.body.classList.toggle('light', isLight);
}

function renderBars(selector, values, invert = false) {
  const el = $(selector);
  const min = Math.min(...values);
  const max = Math.max(...values);
  el.innerHTML = values.map((value) => {
    const height = max === min ? 55 : 26 + ((value - min) / (max - min)) * 64;
    const normalized = invert ? 100 - height : height;
    return `<span class="bar" style="height:${Math.max(20, normalized)}%" title="${value}"></span>`;
  }).join('');
}

function render(snapshotData) {
  snapshot = snapshotData;
  const { health = {}, todayActivities = [], plan = {}, load = {}, trends = {}, insight = {}, meta = {} } = snapshot;
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
        : '演示数据';
  sourceBadge.className = `source-badge ${source}${isStaleCodex ? ' stale' : ''}`;
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
  setText('#last-updated', meta.provider === 'codex-coros-mcp'
    ? `Codex 快照 · ${updatedAt}`
    : `最后更新 ${updatedAt}`);
  setText('#insight-button', config?.dataSource === 'codex' ? '读取最新' : '重新生成');

  setText('#insight-text', insight.text || '暂无洞察，请点击重新生成。');
  $('#insight-tags').innerHTML = (insight.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

  const totalSeconds = todayActivities.reduce((sum, activity) => sum + (activity.durationSeconds || 0), 0);
  const totalDistance = todayActivities.reduce((sum, activity) => sum + (activity.distanceKm || 0), 0);
  const heartRates = todayActivities.map((activity) => activity.heartRate).filter(Boolean);
  setText('#training-status', todayActivities.length ? (todayActivities.some((a) => a.status === 'completed') ? '已完成' : '有安排') : '休息日');
  $('#training-empty').hidden = Boolean(todayActivities.length);
  $('#activity-list').innerHTML = todayActivities.map((activity) => `<div class="activity-row">
    <div class="activity-icon">↗</div><div class="activity-main"><div class="activity-name">${escapeHtml(activity.sport || '运动')}</div><div class="activity-sub">${formatDuration(activity.durationSeconds)}${activity.paceSecondsPerKm ? ` · ${formatPace(activity.paceSecondsPerKm)}` : ''} · ${escapeHtml(activity.heartRate ?? '—')} bpm · ${escapeHtml(activity.calories ?? '—')} kcal</div></div><div class="activity-distance">${Number(activity.distanceKm) > 0 ? `${Number(activity.distanceKm).toFixed(2)}<span class="muted tiny"> km</span>` : '—'}</div>
  </div>`).join('');
  setText('#total-distance', totalDistance > 0 ? `${totalDistance.toFixed(2)} km` : '—');
  setText('#total-duration', todayActivities.length ? formatDuration(totalSeconds) : '—');
  setText('#total-heart-rate', heartRates.length ? `${Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length)} bpm` : '—');

  setText('#sleep-value', formatMinutes(health.sleep?.durationMinutes || 0));
  setText('#sleep-score', `评分 ${health.sleep?.score ?? '—'}`);
  setText('#rhr-value', health.restingHeartRate?.value == null ? '—' : `${health.restingHeartRate.value} bpm`);
  const trend = health.restingHeartRate?.trend;
  setText('#rhr-trend', trend == null ? '无对比' : `${trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} ${Math.abs(trend)} bpm vs 昨日`);
  setText('#hrv-value', health.hrv?.value == null ? '—' : `${health.hrv.value} ms`);
  setText('#hrv-status', health.hrv?.status === 'above_normal' ? '高于个人正常范围' : health.hrv?.status === 'normal' ? '个人正常范围' : '暂无数据');
  setText('#recovery-value', health.recovery?.value == null ? '—' : `${health.recovery.value}%`);
  const recoveryLabels = {
    heavy_training_allowed: '可进行较高负荷',
    training_as_planned: '可按计划训练',
    easy_training_recommended: '建议轻松训练',
    rest_recommended: '建议恢复或休息',
    unknown: '暂无判断'
  };
  setText('#recovery-level', recoveryLabels[health.recovery?.level] || '按状态调整');
  setText('#steps-value', health.steps?.value == null ? '—' : Number(health.steps.value).toLocaleString('en-US'));
  setText('#spo2-value', health.spo2?.value == null ? '—' : `${health.spo2.value}%`);
  setText('#spo2-status', health.spo2?.value == null ? '设备未提供' : '今日最新值');

  setText('#plan-title', plan.title || '未设置训练计划');
  setText('#plan-description', plan.description || plan.name || '今天没有计划安排');
  setText('#plan-load', plan.load == null ? '—' : `训练负荷 ${plan.load}`);
  setText('#load-summary', load.ratio == null ? '负荷 —' : `负荷比 ${load.ratio}`);
  $('#rhr-bars').innerHTML = '';
  $('#sleep-bars').innerHTML = '';
  if (trends.restingHeartRate?.length) renderBars('#rhr-bars', trends.restingHeartRate);
  if (trends.sleepScore?.length) renderBars('#sleep-bars', trends.sleepScore);

  let statusMessage = '';
  if (meta.error) {
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
  const button = $('#refresh-button');
  button.disabled = true;
  setText('#refresh-label', '读取中');
  try {
    render(await window.pulseDesktop.getSnapshot());
  } catch (error) {
    $('#error-banner').hidden = false;
    setText('#error-banner', `看板加载失败：${error.message}`);
  } finally {
    button.disabled = false;
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

async function openSettings() {
  $('#data-source').value = config.dataSource || 'demo';
  $('#bridge-url').value = config.bridgeUrl || '';
  $('#refresh-interval').value = String(config.refreshIntervalMinutes || 30);
  $('#always-on-top').checked = Boolean(config.alwaysOnTop);
  $('#launch-at-login').checked = Boolean(config.launchAtLogin);
  $('#compact-mode').checked = Boolean(config.compactMode);
  $('#theme').value = config.theme || 'dark';
  $('#opacity').value = String(config.opacity || 96);
  setText('#opacity-label', `${config.opacity || 96}%`);
  setText('#bridge-test-status', '');
  updateDataSourceControls();
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
    alwaysOnTop: $('#always-on-top').checked,
    launchAtLogin: $('#launch-at-login').checked,
    compactMode: $('#compact-mode').checked,
    theme: $('#theme').value,
    opacity: Number($('#opacity').value)
  });
  document.body.classList.toggle('compact', config.compactMode);
  applyTheme();
  $('#settings-dialog').close();
  armTimer();
  await refresh();
}

$('#refresh-button').addEventListener('click', refresh);
$('#insight-button').addEventListener('click', regenerateInsight);
$('#settings-button').addEventListener('click', openSettings);
$('#hide-button').addEventListener('click', () => window.pulseDesktop.hide());
$('#settings-form').addEventListener('submit', saveSettings);
$('#test-bridge-button').addEventListener('click', testBridge);
$('#data-source').addEventListener('change', updateDataSourceControls);
$('#opacity').addEventListener('input', (event) => setText('#opacity-label', `${event.target.value}%`));
window.pulseDesktop.onRefresh(refresh);
window.pulseDesktop.onOpenSettings(openSettings);

(async function init() {
  config = await window.pulseDesktop.getConfig();
  document.body.classList.toggle('compact', config.compactMode);
  applyTheme();
  armTimer();
  await refresh();
})();
