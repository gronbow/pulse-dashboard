const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'mock', 'snapshot.json'), 'utf8'));
const port = Number(process.env.PULSE_BRIDGE_PORT || process.env.COROS_BRIDGE_PORT || 19090);

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  response.end(JSON.stringify(body));
}

function createServer() {
  return http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/api/health') {
    json(response, 200, { ok: true, service: 'demo-bridge', version: 1 });
    return;
  }
  if (request.method === 'GET' && request.url.startsWith('/api/snapshot')) {
    json(response, 200, { ...snapshot, meta: { ...snapshot.meta, source: 'bridge' } });
    return;
  }
  if (request.method === 'POST' && request.url === '/api/insight') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => json(response, 200, { text: snapshot.insight.text }));
    return;
  }
  json(response, 404, { error: 'not_found' });
  });
}

if (require.main === module) {
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`Demo bridge listening at http://127.0.0.1:${port}`);
  });
}

module.exports = { createServer };
