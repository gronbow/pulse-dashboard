const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCodexHandoffServer } = require('../bridge/codex-handoff-server');

const filePath = path.join(os.tmpdir(), `pulse-codex-handoff-${process.pid}.json`);
const server = createCodexHandoffServer({ filePath });
let updateEvents = 0;
server.on('snapshot-updated', () => { updateEvents += 1; });

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const payload = {
    meta: { asOf: '2026-07-24T08:00:00+08:00', lastUpdated: '2026-07-24T08:00:00+08:00' },
    health: { sleep: { durationMinutes: 390, score: 92 }, restingHeartRate: { value: 50 } },
    todayActivities: [{ sport: '跑步', distanceKm: 6, durationSeconds: 1800 }],
    insight: { text: 'Codex 已生成测试洞察。', tags: ['测试'] }
  };
  try {
    const unavailable = await fetch(`${base}/api/snapshot`);
    assert.equal(unavailable.status, 503);

    const accepted = await fetch(`${base}/api/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(accepted.status, 201);
    assert.equal(updateEvents, 1);

    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ready, true);

    const snapshot = await (await fetch(`${base}/api/snapshot`)).json();
    assert.equal(snapshot.meta.provider, 'codex-coros-mcp');
    assert.equal(snapshot.health.sleep.score, 92);
    assert.equal(snapshot.todayActivities[0].distanceKm, 6);
    assert.equal(snapshot.todayActivities[0].sport, '跑步');
    assert.equal(snapshot.insight.text, payload.insight.text);

    const corrupted = await fetch(`${base}/api/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, insight: { text: '????????', tags: ['????'] } })
    });
    assert.equal(corrupted.status, 400);
    const afterCorruption = await (await fetch(`${base}/api/snapshot`)).json();
    assert.equal(afterCorruption.insight.text, payload.insight.text);

    const incomplete = await fetch(`${base}/api/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        todayActivities: [{ sport: '跑步', distanceKm: 6.72, durationSeconds: 0 }]
      })
    });
    assert.equal(incomplete.status, 400);
    const afterIncomplete = await (await fetch(`${base}/api/snapshot`)).json();
    assert.equal(afterIncomplete.todayActivities[0].durationSeconds, 1800);

    const wrongContentType = await fetch(`${base}/api/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    assert.equal(wrongContentType.status, 415);
    assert.equal(updateEvents, 1);

    const browserOrigin = await fetch(`${base}/api/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.invalid' },
      body: JSON.stringify(payload)
    });
    assert.equal(browserOrigin.status, 403);
    assert.equal(updateEvents, 1);

    const insight = await (await fetch(`${base}/api/insight`, { method: 'POST' })).json();
    assert.equal(insight.text, payload.insight.text);
    console.log('Codex handoff passed: valid local updates are atomic; incomplete and browser-origin writes are blocked.');
  } finally {
    server.close();
    fs.rmSync(filePath, { force: true });
  }
});
