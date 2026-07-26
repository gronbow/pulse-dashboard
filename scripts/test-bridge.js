const assert = require('node:assert/strict');
const { createServer } = require('../bridge/mock-server');

const server = createServer();

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const healthResponse = await fetch(`${base}/api/health`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.equal(health.ok, true);

    const snapshotResponse = await fetch(`${base}/api/snapshot?timezone=Asia%2FShanghai`);
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshotResponse.status, 200);
    assert.equal(snapshot.meta.source, 'bridge');
    assert.ok(Array.isArray(snapshot.todayActivities));

    const insightResponse = await fetch(`${base}/api/insight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot })
    });
    const insight = await insightResponse.json();
    assert.equal(insightResponse.status, 200);
    assert.equal(typeof insight.text, 'string');
    console.log('Bridge contract passed: snapshot and insight endpoints respond with JSON.');
  } finally {
    server.close();
  }
});
