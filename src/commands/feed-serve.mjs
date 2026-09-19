import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parse, out, num } from '../cli.mjs';
import { startFeedServer } from '../feed/server.mjs';
import { CACHE_PATH } from '../data.mjs';
import { ROOT } from '../env.mjs';

// Long-running read-only feed for famdash. Prints one JSON line at startup
// (booleans and paths only — never the API key) and then stays quiet.
// Request logs would risk echoing Authorization.
export async function run(argv) {
  const opts = parse(argv, {
    port: { type: 'string' },
    host: { type: 'string' },
    bills: { type: 'string' },
  });
  const port = num(opts.port ?? process.env.BUKZ_FEED_PORT, 7801);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be 1–65535 (got "${opts.port ?? process.env.BUKZ_FEED_PORT}")`);
  }
  const host = assertHost(opts.host || process.env.BUKZ_FEED_HOST || '127.0.0.1');
  const dataPath = opts.in ? resolve(process.cwd(), opts.in) : CACHE_PATH;
  const billsPath = opts.bills
    ? resolve(process.cwd(), opts.bills)
    : resolve(ROOT, 'config', 'bills.json');

  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const auth = Boolean(process.env.BUKZ_API_KEY);
  const server = await startFeedServer({ port, host, dataPath, billsPath });
  const shownHost = host === '::1' ? '[::1]' : host;
  const note = [
    auth
      ? 'Read-only feed. Ctrl-C to stop.'
      : 'BUKZ_API_KEY is unset; every request returns 401. The key is never printed.',
    loopback
      ? 'Loopback only. A public URL needs Cipher CLEAR — this repo is public.'
      : 'Non-loopback bind. Do not publish a URL until Cipher has CLEARED this repo.',
  ].join(' ');
  out({
    url: `http://${shownHost}:${server.address().port}`,
    host,
    auth,
    data: { path: dataPath, ok: existsSync(dataPath) },
    bills: { path: billsPath, ok: existsSync(billsPath) },
    note,
  });
  await new Promise(() => {});
}

function assertHost(host) {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return host;
  if (!/^[A-Za-z0-9.-]+$/.test(host) || host.length > 253 || host.includes('..')) {
    throw new Error('Host must be a hostname or IP (default 127.0.0.1). Set --host or BUKZ_FEED_HOST.');
  }
  return host;
}
