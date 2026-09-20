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
    'allow-non-loopback': { type: 'boolean' },
  });
  // Host policy runs first so a refused bind never depends on the port, and
  // tests can prove the opt-in without listening.
  const allowNonLoopback = feedNonLoopbackAllowed(
    opts['allow-non-loopback'],
    process.env.BUKZ_FEED_ALLOW_NON_LOOPBACK,
  );
  const host = assertFeedHost(opts.host || process.env.BUKZ_FEED_HOST || '127.0.0.1', {
    allowNonLoopback,
  });
  const port = num(opts.port ?? process.env.BUKZ_FEED_PORT, 7801);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be 1–65535 (got "${opts.port ?? process.env.BUKZ_FEED_PORT}")`);
  }
  const dataPath = opts.in ? resolve(process.cwd(), opts.in) : CACHE_PATH;
  const billsPath = opts.bills
    ? resolve(process.cwd(), opts.bills)
    : resolve(ROOT, 'config', 'bills.json');

  const loopback = isLoopbackHost(host);
  const auth = Boolean(process.env.BUKZ_API_KEY);
  const server = await startFeedServer({ port, host, dataPath, billsPath });
  const shownHost = host === '::1' ? '[::1]' : host;
  const note = [
    auth
      ? 'Read-only feed. Ctrl-C to stop.'
      : 'BUKZ_API_KEY is unset; every request returns 401. The key is never printed.',
    loopback
      ? 'Loopback only. A public URL needs Cipher CLEAR — this repo is public.'
      : 'Non-loopback bind was explicitly allowed. Do not publish a URL until Cipher has CLEARED this public repo.',
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

// Loopback is the only bind that starts with no extra intent. Anything else
// is a public-repo decision and must be opted into after Cipher CLEAR.
export function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

// `1` is the only accepted env value, with no trimming, so whitespace or a
// typo cannot open the bind. The CLI flag and the env var are independent;
// either one is enough.
export function feedNonLoopbackAllowed(flag, envValue) {
  if (flag) return true;
  return envValue === '1';
}

export function assertFeedHost(rawHost, { allowNonLoopback = false } = {}) {
  const host = assertHost(rawHost);
  if (isLoopbackHost(host) || allowNonLoopback) return host;
  throw new Error(
    `Refusing to bind feed-serve on ${host}: non-loopback hosts are refused ` +
    'unless you pass --allow-non-loopback or set BUKZ_FEED_ALLOW_NON_LOOPBACK=1. ' +
    'This repository is public; Cipher must CLEAR before that flag. ' +
    'Loopback (127.0.0.1, localhost, ::1) needs no flag.',
  );
}

function assertHost(host) {
  if (isLoopbackHost(host)) return host;
  if (typeof host !== 'string' || !/^[A-Za-z0-9.-]+$/.test(host) || host.length > 253 || host.includes('..')) {
    throw new Error('Host must be a hostname or IP (default 127.0.0.1). Set --host or BUKZ_FEED_HOST.');
  }
  return host;
}
