const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const publisherPath = path.join(__dirname, 'publish-snapshot.js');

function runPublisher(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [publisherPath, ...args], {
      env: { ...process.env, ...environment },
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-publisher-test-'));
  const validPath = path.join(tempDir, 'valid.json');
  const invalidPath = path.join(tempDir, 'invalid.json');
  const received = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        contentType: request.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8')
      });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end('{"ok":true}');
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    const environment = { PULSE_HANDOFF_URL: `http://127.0.0.1:${port}/api/snapshot` };

    const validSnapshot = {
      meta: { date: '2026-07-27', timezone: 'Asia/Shanghai' },
      health: {
        sleep: { durationMinutes: 432, score: 91 },
        restingHeartRate: { value: 53 },
        hrv: { value: 82 },
        stress: { value: 32 },
        recovery: { value: 93 }
      },
      todayActivities: [
        { sport: '户外跑步', distanceKm: 6.72, durationSeconds: 2_154, averageHeartRate: 145 }
      ],
      insight: {
        text: '睡眠和恢复状态良好，今日跑步已完成，明日可按计划训练。',
        tags: ['恢复良好', '训练完成']
      }
    };
    fs.writeFileSync(validPath, JSON.stringify(validSnapshot), 'utf8');

    const validResult = await runPublisher(['--file', validPath], environment);
    assert.equal(validResult.code, 0, validResult.stderr);
    assert.match(validResult.stdout, /published/);
    assert.equal(received.length, 1);
    assert.equal(received[0].contentType, 'application/json; charset=utf-8');
    assert.equal(JSON.parse(received[0].body).insight.text, validSnapshot.insight.text);
    assert.equal(JSON.parse(received[0].body).health.stress.value, 32);

    const incompleteSnapshot = {
      health: {
        sleep: { durationMinutes: null, score: 45 },
        restingHeartRate: { value: 0 },
        hrv: { value: 0 },
        stress: { value: 0 },
        recovery: { value: 0 }
      },
      todayActivities: [{ sport: '户外跑步', distanceKm: 6.72, durationSeconds: 0 }],
      insight: { text: '快照暂未包含完整数据。' }
    };
    fs.writeFileSync(invalidPath, JSON.stringify(incompleteSnapshot), 'utf8');

    const invalidResult = await runPublisher(['--file', invalidPath], environment);
    assert.equal(invalidResult.code, 1);
    assert.match(invalidResult.stderr, /at least two valid health signals/);
    assert.equal(received.length, 1, 'incomplete snapshot must be rejected before any HTTP request');

    console.log('Pulse publisher passed: UTF-8 snapshot accepted; incomplete snapshot blocked locally.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const filePath of [validPath, invalidPath]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    fs.rmdirSync(tempDir);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
