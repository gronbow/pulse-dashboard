const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCodexHandoffServer } = require('../bridge/codex-handoff-server');
const {
  bearerHeaders,
  createIdentityChallenge,
  verifyHandoffIdentity
} = require('./handoff-auth');

const filePath = path.join(os.tmpdir(), `pulse-codex-handoff-${process.pid}.json`);
const token = 'A'.repeat(43);
const encodeSnapshot = (snapshot) => JSON.stringify({
  sealed: Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64')
});
const decodeSnapshot = (serialized) => JSON.parse(
  Buffer.from(JSON.parse(serialized).sealed, 'base64').toString('utf8')
);
const server = createCodexHandoffServer({
  filePath,
  authToken: token,
  encodeSnapshot,
  decodeSnapshot,
  getRetentionDays: () => 30
});
let updateEvents = 0;
let clearEvents = 0;
server.on('snapshot-updated', () => { updateEvents += 1; });
server.on('snapshot-cleared', () => { clearEvents += 1; });

function authorized(options = {}) {
  return { ...options, headers: { ...bearerHeaders(token), ...(options.headers || {}) } };
}

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const timestamp = new Date().toISOString();
  const date = timestamp.slice(0, 10);
  const previousDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const payload = {
    meta: { asOf: timestamp, lastUpdated: timestamp, timezone: 'Asia/Shanghai' },
    health: {
      sleep: { durationMinutes: 390, score: 92, date },
      restingHeartRate: { value: 50, date },
      stress: { value: 32, date }
    },
    todayActivities: [{ sport: '跑步', distanceKm: 6, durationSeconds: 1800 }],
    trends: {
      trainingLoad: [
        { date: previousDate, shortTerm: 61, longTerm: 64, ratio: 0.95 },
        { date, shortTerm: 66, longTerm: 65, ratio: 1.01 }
      ]
    },
    insight: { text: 'Codex 已生成测试洞察。', tags: ['测试'] },
    readiness: {
      status: 'data_insufficient',
      confidence: 'low',
      recommendationLevel: 'informational',
      reasons: ['测试未收集主观疲劳与安全状态'],
      subjective: {}
    }
  };
  try {
    const noChallenge = await fetch(`${base}/api/health`);
    assert.equal(noChallenge.status, 400);

    const challenge = createIdentityChallenge();
    const identity = await (await fetch(`${base}/api/health?challenge=${challenge}`)).json();
    assert.equal(verifyHandoffIdentity(identity, token, challenge), true);
    assert.equal(identity.ready, undefined, 'unauthenticated identity response must not reveal snapshot state');

    const unauthenticated = await fetch(`${base}/api/snapshot`);
    assert.equal(unauthenticated.status, 401);
    const wrongToken = await fetch(`${base}/api/snapshot`, {
      headers: bearerHeaders('B'.repeat(43))
    });
    assert.equal(wrongToken.status, 401);

    const unavailable = await fetch(`${base}/api/snapshot`, authorized());
    assert.equal(unavailable.status, 503);

    const accepted = await fetch(`${base}/api/snapshot`, authorized({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }));
    assert.equal(accepted.status, 201, await accepted.text());
    assert.equal(updateEvents, 1);
    assert.equal(fs.readFileSync(filePath, 'utf8').includes(payload.insight.text), false, 'stored snapshot must be sealed');

    const healthChallenge = createIdentityChallenge();
    const health = await (await fetch(
      `${base}/api/health?challenge=${healthChallenge}`,
      authorized()
    )).json();
    assert.equal(health.ready, true);
    assert.equal(verifyHandoffIdentity(health, token, healthChallenge), true);

    const snapshot = await (await fetch(`${base}/api/snapshot`, authorized())).json();
    assert.equal(snapshot.meta.provider, 'codex-coros-mcp');
    assert.equal(snapshot.health.sleep.score, 92);
    assert.equal(snapshot.health.sleep.date, date);
    assert.equal(snapshot.health.stress.value, 32);
    assert.equal(snapshot.trends.trainingLoad.length, 2);
    assert.equal(snapshot.todayActivities[0].distanceKm, 6);
    assert.equal(snapshot.todayActivities[0].sport, '跑步');
    assert.equal(snapshot.insight.text, payload.insight.text);

    const corrupted = await fetch(`${base}/api/snapshot`, authorized({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, insight: { text: '????????', tags: ['????'] } })
    }));
    assert.equal(corrupted.status, 400);
    const afterCorruption = await (await fetch(`${base}/api/snapshot`, authorized())).json();
    assert.equal(afterCorruption.insight.text, payload.insight.text);

    const incomplete = await fetch(`${base}/api/snapshot`, authorized({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        todayActivities: [{ sport: '跑步', distanceKm: 6.72, durationSeconds: 0 }]
      })
    }));
    assert.equal(incomplete.status, 400);
    const afterIncomplete = await (await fetch(`${base}/api/snapshot`, authorized())).json();
    assert.equal(afterIncomplete.todayActivities[0].durationSeconds, 1800);

    const wrongContentType = await fetch(`${base}/api/snapshot`, authorized({
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(payload)
    }));
    assert.equal(wrongContentType.status, 415);
    assert.equal(updateEvents, 1);

    const browserOrigin = await fetch(`${base}/api/snapshot`, authorized({
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.invalid' },
      body: JSON.stringify(payload)
    }));
    assert.equal(browserOrigin.status, 403);
    assert.equal(updateEvents, 1);

    const insight = await (await fetch(`${base}/api/insight`, authorized({ method: 'POST' }))).json();
    assert.equal(insight.text, payload.insight.text);

    server.clearSnapshot();
    assert.equal(clearEvents, 1);
    assert.equal(fs.existsSync(filePath), false);
    assert.equal((await fetch(`${base}/api/snapshot`, authorized())).status, 503);
    console.log('Codex handoff passed: identity proof, bearer auth, sealed storage, validation and clearing are enforced.');
  } finally {
    server.close();
    fs.rmSync(filePath, { force: true });
  }
});
