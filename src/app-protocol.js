const fs = require('node:fs');
const path = require('node:path');

const PULSE_APP_SCHEME = 'pulse-app';
const PULSE_APP_HOST = 'dashboard';
const PULSE_APP_ORIGIN = `${PULSE_APP_SCHEME}://${PULSE_APP_HOST}`;
const PULSE_APP_ENTRY_URL = `${PULSE_APP_ORIGIN}/index.html`;
const PULSE_RENDERER_CSP = "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';";

const PULSE_APP_ASSETS = Object.freeze({
  [PULSE_APP_ENTRY_URL]: Object.freeze({ parts: Object.freeze(['renderer', 'index.html']), contentType: 'text/html; charset=utf-8' }),
  [`${PULSE_APP_ORIGIN}/styles.css`]: Object.freeze({ parts: Object.freeze(['renderer', 'styles.css']), contentType: 'text/css; charset=utf-8' }),
  [`${PULSE_APP_ORIGIN}/app.js`]: Object.freeze({ parts: Object.freeze(['renderer', 'app.js']), contentType: 'text/javascript; charset=utf-8' }),
  [`${PULSE_APP_ORIGIN}/data-trust.js`]: Object.freeze({ parts: Object.freeze(['data-trust.js']), contentType: 'text/javascript; charset=utf-8' }),
  [`${PULSE_APP_ORIGIN}/safety-presentation.js`]: Object.freeze({ parts: Object.freeze(['safety-presentation.js']), contentType: 'text/javascript; charset=utf-8' })
});

function registerPulseAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PULSE_APP_SCHEME,
      privileges: {
        standard: true,
        secure: true
      }
    }
  ]);
}

function resolvePulseAppAsset(requestUrl, method = 'GET', sourceRoot = __dirname) {
  if (method !== 'GET') return { ok: false, status: 405 };
  const definition = PULSE_APP_ASSETS[requestUrl];
  if (!definition) return { ok: false, status: 404 };

  const resolvedRoot = path.resolve(sourceRoot);
  const filePath = path.resolve(resolvedRoot, ...definition.parts);
  if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 200, filePath, contentType: definition.contentType };
}

function protocolResponse(status, body = null, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': PULSE_RENDERER_CSP,
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function createPulseAppProtocolHandler(sourceRoot = __dirname) {
  return async (request) => {
    const asset = resolvePulseAppAsset(request.url, request.method, sourceRoot);
    if (!asset.ok) return protocolResponse(asset.status);
    try {
      const body = await fs.promises.readFile(asset.filePath);
      return protocolResponse(200, body, asset.contentType);
    } catch {
      return protocolResponse(500);
    }
  };
}

function installPulseAppProtocol(protocol, sourceRoot = __dirname) {
  protocol.handle(PULSE_APP_SCHEME, createPulseAppProtocolHandler(sourceRoot));
}

module.exports = {
  PULSE_APP_ASSETS,
  PULSE_APP_ENTRY_URL,
  PULSE_APP_HOST,
  PULSE_APP_ORIGIN,
  PULSE_APP_SCHEME,
  PULSE_RENDERER_CSP,
  createPulseAppProtocolHandler,
  installPulseAppProtocol,
  registerPulseAppScheme,
  resolvePulseAppAsset
};
