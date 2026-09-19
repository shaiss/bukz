import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';

import { amountsUnlocked, buildFeed, clampFeedLimit } from './feed.mjs';

// Read-only famdash feed. Separate from the dashboard server on purpose:
// `serve` is unauthenticated and must stay on 127.0.0.1, while this process
// speaks only GET /api/feed/recent and checks a bearer token. It reads the
// last cache from disk — it never calls YNAB or Xero.

export function bearerOk(authorization, expected) {
  if (!expected) return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  if (!match) return false;
  const provided = Buffer.from(match[1]);
  const want = Buffer.from(String(expected));
  if (provided.length !== want.length) {
    timingSafeEqual(want, want);
    return false;
  }
  return timingSafeEqual(provided, want);
}

export function startFeedServer({
  port = 7801,
  host = '127.0.0.1',
  dataPath,
  billsPath,
  apiKey,
  now = () => new Date(),
} = {}) {
  const server = createServer((req, res) => {
    handle(req, res, { dataPath, billsPath, apiKey, now }).catch(() => {
      sendJson(res, 500, { error: 'feed unavailable' });
    });
  });
  return new Promise((resolveStarted, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveStarted(server));
  });
}

async function handle(req, res, opts) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/api/feed/recent') {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  // `apiKey: ''` forces "unset" in tests. Omitting it reads BUKZ_API_KEY per request.
  const expected = opts.apiKey !== undefined ? opts.apiKey || '' : process.env.BUKZ_API_KEY || '';
  if (!bearerOk(req.headers.authorization, expected)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  const cache = await readJson(opts.dataPath);
  const bills = (await readJson(opts.billsPath)) ?? [];
  const body = buildFeed({
    cache,
    bills,
    now: opts.now(),
    limit: clampFeedLimit(url.searchParams.get('limit')),
    amounts: amountsUnlocked(url.searchParams.get('amounts')),
  });
  sendJson(res, 200, body);
}

async function readJson(path) {
  if (!path) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}
