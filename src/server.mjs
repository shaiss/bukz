import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = resolve(ROOT, 'web');
const ANALYSIS_ROOT = resolve(ROOT, 'src', 'analysis');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Read-only local server for the visualization SPA. Serves exactly three
// things: the static app from web/, the pure analysis modules the browser
// imports (so chart numbers come from the SAME code the CLI runs — the
// architecture split survives the move to the screen), and two JSON endpoints
// that re-read the cache/bills on every request (a re-pull shows up on the
// next page refresh). Binds 127.0.0.1 only — this is private financial data,
// and nothing outside this machine may ask for it.
export function startServer({ port = 7800, host = '127.0.0.1', dataPath, billsPath } = {}) {
  const server = createServer((req, res) => {
    route(req, res, { dataPath, billsPath }).catch((err) => {
      sendJson(res, err.status ?? 500, { error: err.message });
    });
  });
  return new Promise((resolveStarted, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveStarted(server));
  });
}

async function route(req, res, { dataPath, billsPath }) {
  if (req.method !== 'GET') throw new HttpError(405, 'GET only — this dashboard is read-only.');
  // decode AFTER the line arrives, so %2e%2e can't sneak past as a literal path.
  // (The WHATWG URL parser re-encodes malformed sequences, so decode cannot
  // throw here; even if it did, the caller's .catch answers with a JSON 500.)
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  if (path === '/api/data') {
    return sendJsonFile(res, dataPath, {
      missing: 'No transaction cache at ' + dataPath + '. Run: node bin/bukz.mjs pull ' +
        '(or serve demo data: --in fixtures/sample.json --bills fixtures/bills.json)',
    });
  }
  if (path === '/api/bills') {
    return sendJsonFile(res, billsPath, {
      missing: 'No bills registry at ' + billsPath + '. Copy config/bills.example.json to ' +
        'config/bills.json and edit it (the outlook view needs it).',
    });
  }
  if (path === '/' || path === '/index.html') {
    return sendStatic(res, WEB_ROOT, '/index.html');
  }
  if (path.startsWith('/src/analysis/')) {
    return sendStatic(res, ANALYSIS_ROOT, path.slice('/src/analysis'.length));
  }
  return sendStatic(res, WEB_ROOT, path);
}

async function sendStatic(res, root, relPath) {
  const target = safeJoin(root, relPath);
  const type = MIME[extnameOf(target)];
  if (!type) throw new HttpError(403, 'Refused: not a servable file type.');
  let body;
  try {
    body = await readFile(target);
  } catch {
    throw new HttpError(404, `Not found: ${relPath}`);
  }
  res.writeHead(200, { 'Content-Type': type, ...NOSNIFF });
  res.end(body);
}

async function sendJsonFile(res, path, { missing }) {
  let body;
  try {
    body = await readFile(path);
  } catch {
    throw new HttpError(404, missing);
  }
  res.writeHead(200, { 'Content-Type': MIME['.json'], ...NOSNIFF });
  res.end(body);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], ...NOSNIFF });
  res.end(JSON.stringify(obj));
}

const NOSNIFF = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

// Containment check: the resolved target must be the root itself or live
// directly under it. Everything that survives decode + resolve outside the
// root — literal `..`, encoded `%2e%2e`, absolute drift — is refused.
// Threat model note: a symlink INSIDE web/ or src/analysis/ pointing elsewhere
// would be followed — acceptable for a localhost tool whose served dirs are
// git-controlled; the secrets (.env, config/) simply do not live there.
function safeJoin(root, relPath) {
  const target = resolve(root, '.' + relPath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new HttpError(403, 'Forbidden.');
  }
  return target;
}

function extnameOf(target) {
  const dot = target.lastIndexOf('.');
  return dot === -1 ? '' : target.slice(dot).toLowerCase();
}
