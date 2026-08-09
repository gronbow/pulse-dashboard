# Pulse PR A Training Safety Presentation Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task, or `superpowers:subagent-driven-development` when the user selects subagent execution.

**Goal:** Make normalized readiness the only authority for training-permission language, so `data_insufficient` and `stop_refer` cannot coexist with permissive insight, recovery, or plan copy.

**Architecture:** Add one deterministic, side-effect-free safety-presentation module. The renderer calls it once per snapshot and renders its output across insight, recovery, and plan surfaces. Unit tests prove all policy branches; Electron smoke tests prove the final DOM text, ARIA behavior, and privacy-safe rule identifier.

**Tech Stack:** CommonJS/UMD JavaScript, Electron renderer DOM, Node `assert`, existing Electron screenshot harness, CSS, Markdown documentation.

**Design source:** `docs/superpowers/specs/2026-08-10-pulse-training-safety-presentation-design.md`

**Scope guard:** Do not add medical thresholds, alter snapshot freshness/provenance rules, redesign refresh, include real health data, create a Release, or change plugin distribution in this PR.

---

## Task 1: Build the pure safety-presentation policy with tests first

**Files:**

- Create: `scripts/test-safety-presentation.js`
- Create: `src/safety-presentation.js`
- Modify: `package.json`

### Step 1: Write the failing policy test

Create `scripts/test-safety-presentation.js` with a synthetic snapshot and exact assertions for `ready`, `data_insufficient`, `stop_refer`, and malformed/unknown states:

```js
const assert = require('node:assert/strict');
const { buildSafetyPresentation } = require('../src/safety-presentation');

const snapshot = {
  health: {
    recovery: { value: 96, level: 'heavy_training_allowed' }
  },
  insight: {
    text: '恢复很好，可以安排高强度训练。',
    tags: ['恢复良好', '高强度']
  },
  plan: {
    title: '间歇跑',
    description: '6 × 1 km，按阈值配速完成。',
    load: 168
  },
  readiness: { status: 'ready' }
};

const ready = buildSafetyPresentation(snapshot);
assert.deepEqual(ready, {
  mode: 'ready',
  ruleId: 'safety.ready_passthrough',
  insight: {
    text: '恢复很好，可以安排高强度训练。',
    tags: ['恢复良好', '高强度']
  },
  recovery: { label: '可进行较高负荷', prescriptive: true },
  plan: {
    titlePrefix: '',
    description: '6 × 1 km，按阈值配速完成。',
    loadVisible: true,
    stateLabel: ''
  },
  announcement: { role: 'status', politeness: 'polite' }
});

const insufficient = buildSafetyPresentation({
  ...snapshot,
  readiness: { status: 'data_insufficient' }
});
assert.deepEqual(insufficient, {
  mode: 'data_insufficient',
  ruleId: 'safety.data_insufficient_override',
  insight: {
    text: '当前缺少完整的主观疲劳与安全确认，仅展示客观数据，不提供训练强度建议。',
    tags: ['数据不足', '仅展示客观数据']
  },
  recovery: { label: '设备恢复数据 · 仅作客观参考', prescriptive: false },
  plan: {
    titlePrefix: '待确认 · ',
    description: '完成当前状态确认后再决定是否执行原计划。',
    loadVisible: false,
    stateLabel: '待确认'
  },
  announcement: { role: 'status', politeness: 'polite' }
});

for (const unsafeText of ['可进行较高负荷', '可按计划训练', '高强度训练', '阈值配速']) {
  assert.doesNotMatch(JSON.stringify(insufficient), new RegExp(unsafeText));
}

const stopped = buildSafetyPresentation({
  ...snapshot,
  readiness: { status: 'stop_refer' }
});
assert.deepEqual(stopped, {
  mode: 'stop_refer',
  ruleId: 'safety.stop_override',
  insight: {
    text: '当前状态需要安全优先，Pulse 已停止训练建议。如症状持续或加重，请寻求适当的专业评估。',
    tags: ['安全优先', '停止训练建议']
  },
  recovery: { label: '当前不用于训练决策', prescriptive: false },
  plan: {
    titlePrefix: '原计划 · ',
    description: '当前状态下暂停训练建议；如症状持续或加重，请寻求适当的专业评估。',
    loadVisible: false,
    stateLabel: '已暂停'
  },
  announcement: { role: 'alert', politeness: 'assertive' }
});

assert.equal(buildSafetyPresentation({ readiness: { status: 'future_state' } }).mode, 'data_insufficient');
assert.equal(buildSafetyPresentation({}).ruleId, 'safety.data_insufficient_override');
assert.equal(buildSafetyPresentation(null).plan.loadVisible, false);

console.log('Safety presentation passed: readiness deterministically governs insight, recovery, plan and ARIA policy.');
```

### Step 2: Run the test and confirm the expected RED state

Run:

```powershell
node scripts/test-safety-presentation.js
```

Expected: failure with `MODULE_NOT_FOUND` for `src/safety-presentation.js`.

### Step 3: Implement the smallest pure policy module

Create `src/safety-presentation.js` as a UMD-compatible module so Node tests can `require` it and the sandboxed renderer can load it as a local script:

```js
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
    unknown: '暂无判断'
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
    return {
      mode: 'ready',
      ruleId: 'safety.ready_passthrough',
      insight: {
        text: insight.text || '暂无洞察，请点击重新生成。',
        tags: Array.isArray(insight.tags) ? [...insight.tags] : []
      },
      recovery: {
        label: RECOVERY_LABELS[snapshot?.health?.recovery?.level] || '按状态调整',
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
```

### Step 4: Run the focused test and confirm GREEN

Run:

```powershell
node scripts/test-safety-presentation.js
```

Expected: `Safety presentation passed...` and exit code 0.

### Step 5: Register the test in the normal suite

In `package.json` add:

```json
"test:safety-presentation": "node scripts/test-safety-presentation.js"
```

Insert `npm run test:safety-presentation` in `test` immediately after `npm run test:snapshot`.

Run:

```powershell
npm run test:safety-presentation
npm run check
```

Expected: both pass.

### Step 6: Commit Task 1

```powershell
git add src/safety-presentation.js scripts/test-safety-presentation.js package.json
git commit -m "feat: centralize training safety presentation"
```

---

## Task 2: Integrate the policy into the real renderer and accessibility contract

**Files:**

- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/styles.css`
- Modify: `scripts/test-ui-contract.js`

### Step 1: Add failing static UI-contract assertions

Extend `scripts/test-ui-contract.js` to read `src/renderer/app.js` and add:

```js
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');

assert.match(html, /<script src="\.\.\/safety-presentation\.js"><\/script>/);
assert.match(html, /id="plan-state"/);
assert.match(renderer, /PulseSafetyPresentation\.buildSafetyPresentation\(snapshot\)/);
assert.match(renderer, /document\.body\.dataset\.safetyRule/);
assert.match(renderer, /setAttribute\('role', safetyPresentation\.announcement\.role\)/);
assert.match(renderer, /setAttribute\('aria-live', safetyPresentation\.announcement\.politeness\)/);
assert.match(renderer, /currentSafety\.mode !== 'ready'/);
```

### Step 2: Run the contract test and confirm RED

Run:

```powershell
npm run test:ui-contract
```

Expected: failure because the policy script and plan-state element are not yet wired.

### Step 3: Add the renderer-owned DOM elements

In `src/renderer/index.html`:

1. Remove the static `aria-live="polite"` from `#insight-text`; runtime code will set both ARIA attributes from the safety policy.
2. Change the plan heading to include a dedicated visible state:

```html
<div class="card-heading">
  <div class="section-label">训练计划</div>
  <div class="plan-heading-meta">
    <span id="plan-state" class="plan-state" hidden></span>
    <span id="plan-load" class="muted tiny">—</span>
  </div>
</div>
```

3. Load the pure module before `app.js`:

```html
<script src="../safety-presentation.js"></script>
<script src="app.js"></script>
```

### Step 4: Make every prescriptive surface consume one policy result

In `src/renderer/app.js`, immediately after snapshot destructuring inside `render(snapshotData)`:

```js
const safetyPresentation = window.PulseSafetyPresentation.buildSafetyPresentation(snapshot);
document.body.dataset.safetyRule = safetyPresentation.ruleId;
```

Replace direct readiness branching and direct insight rendering with:

```js
const readinessChip = $('#readiness-chip');
const readinessContent = safetyPresentation.mode === 'stop_refer'
  ? { label: '安全优先 · 停止训练', className: 'stop' }
  : safetyPresentation.mode === 'ready'
    ? { label: '状态已确认', className: 'ready' }
    : { label: '数据不足', className: 'insufficient' };
readinessChip.textContent = readinessContent.label;
readinessChip.className = `readiness-chip ${readinessContent.className}`;

const insightText = $('#insight-text');
insightText.setAttribute('role', safetyPresentation.announcement.role);
insightText.setAttribute('aria-live', safetyPresentation.announcement.politeness);
setText('#insight-text', safetyPresentation.insight.text);
$('#insight-tags').innerHTML = safetyPresentation.insight.tags
  .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
  .join('');
```

Replace the existing recovery-label map with:

```js
setText('#recovery-level', datedNote(
  safetyPresentation.recovery.label,
  health.recovery?.date,
  asOfKey
));
```

Replace direct plan rendering with:

```js
const planDateLabel = plan.date && plan.date !== asOfKey ? shortDateLabel(plan.date) : '';
const planTitle = plan.title || '未设置训练计划';
const basePlanTitle = planDateLabel ? `${planDateLabel} · ${planTitle}` : planTitle;
setText('#plan-title', `${safetyPresentation.plan.titlePrefix}${basePlanTitle}`);
setText('#plan-description', safetyPresentation.plan.description);

const planLoad = $('#plan-load');
planLoad.hidden = !safetyPresentation.plan.loadVisible;
setText('#plan-load', plan.load == null ? '—' : `训练负荷 ${plan.load}`);

const planState = $('#plan-state');
planState.hidden = !safetyPresentation.plan.stateLabel;
setText('#plan-state', safetyPresentation.plan.stateLabel);

for (const element of [$('.insight-card'), $('.plan-card')]) {
  element.dataset.safetyMode = safetyPresentation.mode;
}
```

Also prevent the `regenerateInsight()` action from bypassing the presentation layer. Keep the Codex path as a snapshot refresh, but gate bridge/demo generation and re-render the updated snapshot rather than writing returned model text directly:

```js
async function regenerateInsight() {
  if (config.dataSource === 'codex') {
    await refresh();
    return;
  }

  const currentSafety = window.PulseSafetyPresentation.buildSafetyPresentation(snapshot);
  if (currentSafety.mode !== 'ready') {
    render(snapshot);
    return;
  }

  $('#insight-button').disabled = true;
  setText('#insight-text', '正在基于最新数据生成洞察……');
  try {
    const result = await window.pulseDesktop.generateInsight(snapshot);
    snapshot = { ...snapshot, insight: result };
    render(snapshot);
  } catch (error) {
    setText('#insight-text', `生成失败：${error.message}`);
  } finally {
    $('#insight-button').disabled = false;
  }
}
```

Do not alter completed activity rendering, recovery percentage rendering, compact metric values, or source/refresh behavior.

### Step 5: Add restrained, text-backed state styling

Add to `src/renderer/styles.css`:

```css
.plan-heading-meta { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 7px; }
.plan-state { padding: 4px 7px; border-radius: 7px; font-size: 10px; line-height: 1.25; font-weight: 700; }
.card[data-safety-mode="data_insufficient"] { border-color: rgba(255, 179, 111, .34); }
.card[data-safety-mode="stop_refer"] { border-color: rgba(255, 105, 105, .4); }
.card[data-safety-mode="data_insufficient"] .plan-state { color: var(--orange); background: rgba(255, 179, 111, .12); }
.card[data-safety-mode="stop_refer"] .plan-state { color: #ffabab; background: rgba(255, 105, 105, .14); }
body.light .card[data-safety-mode="stop_refer"] .plan-state { color: #8f2020; background: rgba(143, 32, 32, .11); }
```

### Step 6: Run focused renderer checks

Run:

```powershell
npm run test:ui-contract
npm run test:safety-presentation
npm run check
```

Expected: all pass.

### Step 7: Commit Task 2

```powershell
git add src/renderer/index.html src/renderer/app.js src/renderer/styles.css scripts/test-ui-contract.js
git commit -m "feat: enforce readiness across dashboard guidance"
```

---

## Task 3: Add real Electron regression tests for both blocked states

**Files:**

- Create: `scripts/test-safety-states.js`
- Modify: `src/main.js`
- Modify: `package.json`

### Step 1: Write the failing Electron safety-state runner

Create `scripts/test-safety-states.js`. It must derive runtime-only synthetic fixtures from `src/mock/snapshot.json`, update `meta.asOf`/`meta.lastUpdated` to the current test time, and never use personal data:

```js
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const runtimeDir = path.join(root, '.runtime-check-v8');
const base = JSON.parse(fs.readFileSync(path.join(root, 'src', 'mock', 'snapshot.json'), 'utf8'));
const now = new Date().toISOString();

function runCase(name, mutate, expectations, attributes) {
  const snapshot = structuredClone(base);
  snapshot.meta.asOf = now;
  snapshot.meta.lastUpdated = now;
  mutate(snapshot);
  const fixturePath = path.join(runtimeDir, `safety-${name}.json`);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(fixturePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  try {
    const result = spawnSync(process.execPath, ['scripts/test-electron-smoke.js'], {
      cwd: root,
      env: {
        ...process.env,
        PULSE_SMOKE_SNAPSHOT_PATH: fixturePath,
        PULSE_SMOKE_OUTPUT_NAME: `pulse-dashboard-safety-${name}.png`,
        PULSE_SMOKE_EXPECTATIONS: JSON.stringify(expectations),
        PULSE_SMOKE_ATTRIBUTE_EXPECTATIONS: JSON.stringify(attributes)
      },
      encoding: 'utf8',
      timeout: 30_000
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
}

runCase('data-insufficient', (snapshot) => {
  snapshot.readiness = { status: 'data_insufficient', reasons: ['subjective check-in missing'] };
}, {
  '#insight-text': '当前缺少完整的主观疲劳与安全确认，仅展示客观数据，不提供训练强度建议。',
  '#recovery-level': '设备恢复数据 · 仅作客观参考',
  '#plan-title': '待确认 · ',
  '#plan-description': '完成当前状态确认后再决定是否执行原计划。',
  '#plan-state': '待确认'
}, [
  { selector: 'body', attribute: 'data-safety-rule', expected: 'safety.data_insufficient_override' },
  { selector: '#insight-text', attribute: 'role', expected: 'status' },
  { selector: '#insight-text', attribute: 'aria-live', expected: 'polite' }
]);

runCase('stop-refer', (snapshot) => {
  snapshot.readiness = {
    status: 'ready',
    subjective: {
      collectedAt: now,
      fatigue: 1,
      soreness: 1,
      pain: true,
      illness: false,
      chestSymptoms: false,
      dizziness: false
    }
  };
}, {
  '#insight-text': '当前状态需要安全优先，Pulse 已停止训练建议。',
  '#recovery-level': '当前不用于训练决策',
  '#plan-title': '原计划 · ',
  '#plan-description': '当前状态下暂停训练建议',
  '#plan-state': '已暂停'
}, [
  { selector: 'body', attribute: 'data-safety-rule', expected: 'safety.stop_override' },
  { selector: '#insight-text', attribute: 'role', expected: 'alert' },
  { selector: '#insight-text', attribute: 'aria-live', expected: 'assertive' }
]);

console.log('Electron safety states passed: blocked guidance and accessibility semantics are rendered end to end.');
```

### Step 2: Run the Electron test and confirm RED

Run:

```powershell
node scripts/test-safety-states.js
```

Expected: failure because `PULSE_SMOKE_ATTRIBUTE_EXPECTATIONS` is not yet enforced by the smoke harness.

### Step 3: Add narrowly validated attribute expectations to the smoke harness

In `src/main.js`, add next to `smokeTextExpectations()`:

```js
function smokeAttributeExpectations() {
  if (app.isPackaged) return [];
  const raw = String(process.env.PULSE_SMOKE_ATTRIBUTE_EXPECTATIONS || '').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('smoke attribute expectations must be a JSON array');

  return parsed.map((entry) => {
    const selector = String(entry?.selector || '');
    const attribute = String(entry?.attribute || '');
    const expected = String(entry?.expected || '');
    if (!/^(?:body|[#.][A-Za-z0-9_-]+)$/.test(selector) || selector.length > 80) {
      throw new Error(`invalid smoke attribute selector: ${selector}`);
    }
    if (!/^(?:role|aria-live|data-safety-rule)$/.test(attribute)) {
      throw new Error(`invalid smoke attribute name: ${attribute}`);
    }
    if (!expected || expected.length > 100) {
      throw new Error(`invalid smoke attribute value for ${selector}`);
    }
    return { selector, attribute, expected };
  });
}
```

In `captureSmokeScreenshot()` after text expectations, add:

```js
for (const expectation of smokeAttributeExpectations()) {
  const actual = await mainWindow.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(expectation.selector)})?.getAttribute(${JSON.stringify(expectation.attribute)}) || ''`,
    true
  );
  if (actual !== expectation.expected) {
    throw new Error(
      `smoke attribute mismatch for ${expectation.selector}[${expectation.attribute}]: `
      + `expected ${JSON.stringify(expectation.expected)}, received ${JSON.stringify(actual)}`
    );
  }
}
```

Keep the environment path development-only by retaining the `app.isPackaged` guard.

### Step 4: Register and run the real UI regression

In `package.json` add:

```json
"test:safety-states": "node scripts/test-safety-states.js"
```

Insert `npm run test:safety-states` in `test:ui` immediately after `npm run test:desktop`.

Run:

```powershell
npm run test:safety-states
npm run test:ui-contract
```

Expected: both pass and two synthetic screenshots exist under `.runtime-check-v8/`.

### Step 5: Commit Task 3

```powershell
git add scripts/test-safety-states.js src/main.js package.json
git commit -m "test: cover blocked training guidance in Electron"
```

---

## Task 4: Update the public demo screenshot and safety documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/DEVELOPMENT_STATUS.md`
- Modify: `docs/REQUIREMENTS_TRACEABILITY.md`
- Modify: `docs/RELEASE_NOTES.md`
- Replace: `docs/assets/pulse-dashboard-v0.5.6-demo.png`

### Step 1: Generate the intentional contradiction demo

Confirm `src/mock/snapshot.json` still contains both:

```json
"level": "heavy_training_allowed"
```

and:

```json
"status": "data_insufficient"
```

Do not “fix” the fixture. Run:

```powershell
npm run test:desktop
```

Expected: the screenshot shows the recovery percentage as objective data, but shows `设备恢复数据 · 仅作客观参考`, `待确认`, and no permissive training text.

### Step 2: Perform visual QA before copying the image

Open `.runtime-check-v8/pulse-dashboard-smoke.png` and check:

- no clipped Chinese text at the insight and plan cards;
- plan-state and readiness chips do not collide;
- warning borders work in dark theme without dominating the page;
- the scrollbar/card geometry and compact modes are unchanged;
- no personal values, identifiers, coordinates, paths, or raw responses are present.

If visual defects exist, fix only PR A state presentation, rerun focused tests, and regenerate the image.

### Step 3: Replace the public full-dashboard example

Copy the verified synthetic screenshot onto the existing README-referenced full-dashboard asset. Do not add the `stop_refer` synthetic screenshot to public docs unless it improves explanation and remains clearly labelled as synthetic.

### Step 4: Update README without overstating medical or live-data capabilities

Add or update a concise safety section with this meaning:

```markdown
### 训练建议的安全边界

Pulse 将设备恢复值视为参考输入，而不是训练许可或医疗判断。只有可信、当前、完整的快照通过主观安全确认时，界面才会显示训练执行建议；`data_insufficient` 会隐藏强度与负荷建议，`stop_refer` 会停止训练建议并提示用户在症状持续或加重时寻求适当的专业评估。
```

In the screenshot caption, explicitly say the demo intentionally combines a high device recovery value with incomplete subjective confirmation to demonstrate safe neutralization.

### Step 5: Update repository status documents

- `docs/DEVELOPMENT_STATUS.md`: mark PR A as implemented on its feature branch, but not merged or released.
- `docs/REQUIREMENTS_TRACEABILITY.md`: link the safety-presentation requirement to `src/safety-presentation.js`, its unit test, and the Electron safety-state test.
- `docs/RELEASE_NOTES.md`: add a candidate/unreleased entry describing deterministic readiness overrides and accessibility semantics; do not change the package version.

### Step 6: Run public-document and screenshot checks

Run:

```powershell
npm run audit:public
npm run test:ui-contract
npm run test:safety-states
git diff --check
```

Expected: all pass.

### Step 7: Commit Task 4

```powershell
git add README.md docs/DEVELOPMENT_STATUS.md docs/REQUIREMENTS_TRACEABILITY.md docs/RELEASE_NOTES.md docs/assets
git commit -m "docs: explain readiness safety behavior"
```

---

## Task 5: Full verification, security review, and implementation self-review

**Files:**

- Modify only files required by failures found in this task.

### Step 1: Restore dependencies reproducibly if needed

If Electron or another locked dependency is missing, run:

```powershell
npm ci
```

Do not update dependency versions or `package-lock.json` in PR A unless a locked install cannot be reproduced and the change is separately justified.

### Step 2: Run the complete repository checks from a clean command prompt

Run each command separately and preserve its exit result:

```powershell
npm test
npm run test:ui
npm run audit:dependencies
npm run audit:production
npm run audit:public
npm run audit:history
git diff --check
```

Expected: all exit 0.

### Step 3: Review the implementation against the approved design

Inspect the final diff and verify:

- every insight, recovery-label, and plan-detail permission path comes from `buildSafetyPresentation()`;
- unknown statuses fail closed;
- `stop_refer` cannot be cleared by a high recovery percentage;
- activity history and objective recovery percentage remain visible;
- no model text is rendered in blocked states;
- rule IDs contain no personal data;
- smoke-only environment parsing remains disabled in packaged builds;
- no real snapshot, token, absolute local path, coordinate, internal activity ID, or health record is tracked;
- compact layout and refresh paths are untouched except for shared snapshot rendering.

### Step 4: Request code review and address only evidence-backed findings

Use `superpowers:requesting-code-review` after all checks pass. If review identifies a defect, use `superpowers:receiving-code-review`, add or adjust a failing test first, implement the smallest fix, rerun focused and full verification, and commit with a scoped message.

### Step 5: Confirm a clean, intentional branch

Run:

```powershell
git status --short --branch
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected: only approved PR A commits and files are present; no generated runtime files are tracked.

---

## Task 6: Push PR A and open a Draft pull request

**Files:**

- No source changes expected.

### Step 1: Reconfirm publication boundary

The user's approval authorizes implementation and a Draft PR for PR A. It does **not** authorize merging, tagging, creating a GitHub Release, or publishing installers/plugins.

### Step 2: Push the feature branch

Run:

```powershell
git push -u origin codex/pr-a-training-safety
```

Expected: branch push succeeds without force.

### Step 3: Open a Draft PR

Use `github:yeet` and create a Draft PR with:

- title: `feat: enforce training safety presentation`
- base: `main`
- head: `codex/pr-a-training-safety`
- summary: centralized readiness-controlled presentation across insight, recovery, and plan;
- tests: list every full verification command and its confirmed result;
- privacy: state that only synthetic snapshots/screenshots are included;
- scope: state that freshness/provenance remains PR B and no Release is included.

### Step 4: Report the exact handoff state

Return the Draft PR URL, commits, verified checks, screenshot path, and any remaining limitation. Do not say “released” or “merged.”

---

## Final acceptance checklist

- [ ] `ready`, `data_insufficient`, `stop_refer`, and malformed states have deterministic unit coverage.
- [ ] The intentionally contradictory demo no longer displays permissive recovery or plan language.
- [ ] `stop_refer` uses `role="alert"` and `aria-live="assertive"`; other modes use status/polite.
- [ ] `document.body.dataset.safetyRule` exposes only a non-sensitive rule ID.
- [ ] Objective data and completed activity history remain visible.
- [ ] No medical threshold, PR B provenance work, refresh redesign, personal data, or Release work entered the diff.
- [ ] Full tests, UI tests, dependency audits, privacy/history audits, and whitespace checks pass.
- [ ] PR A is pushed only as a feature branch and opened as a Draft PR.
