import { resolve } from 'node:path';
import { parse, out, num } from '../cli.mjs';
import { startServer } from '../server.mjs';
import { CACHE_PATH } from '../data.mjs';
import { ROOT } from '../env.mjs';
import { existsSync } from 'node:fs';

// Starts the read-only visualization SPA. Long-running, so it prints one JSON
// line at startup and then stays quiet (request logs would be noise). The data
// and bills endpoints re-read their files per request — pull again and refresh
// the browser, no server restart needed.
export async function run(argv) {
  const opts = parse(argv, {
    port: { type: 'string' },
    bills: { type: 'string' },
  });
  const port = num(opts.port, 7800);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be 1–65535 (got "${opts.port}")`);
  }
  const dataPath = opts.in ? resolve(process.cwd(), opts.in) : CACHE_PATH;
  const billsPath = opts.bills
    ? resolve(process.cwd(), opts.bills)
    : resolve(ROOT, 'config', 'bills.json');

  const server = await startServer({ port, dataPath, billsPath });
  const url = `http://127.0.0.1:${server.address().port}`;
  out({
    url,
    data: { path: dataPath, ok: existsSync(dataPath) },
    bills: { path: billsPath, ok: existsSync(billsPath) },
    note: 'Ctrl-C to stop. The server binds 127.0.0.1 only (private data).',
  });
  await new Promise(() => {}); // serve until killed
}
