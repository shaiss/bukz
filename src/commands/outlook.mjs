import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, out, num } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { loadConfig } from '../config.mjs';
import { outlook } from '../analysis/outlook.mjs';

// The N-day cash look-ahead: per-account balance minus bills due, with a
// red/yellow/green coverage status and a worst-of rollup. Bills come from the
// local registry config/bills.json; --bills points at another file (demo mode
// uses fixtures/bills.json).
export async function run(argv) {
  const opts = parse(argv, {
    days: { type: 'string' },
    bills: { type: 'string' },
  });
  const days = num(opts.days, 14);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error(`--days must be a whole number of days, 1–90 (got "${opts.days}")`);
  }
  const data = loadData(opts);
  if (!data.accounts) {
    throw new Error(
      'No account balances in the cache. Pull from a provider that exposes them (YNAB), ' +
        'or try demo mode: --in fixtures/sample.json --bills fixtures/bills.json'
    );
  }
  const bills = opts.bills
    ? JSON.parse(readFileSync(resolve(process.cwd(), opts.bills), 'utf8'))
    : loadConfig('bills.json');
  out({
    meta: meta(data, opts),
    ...outlook(data.transactions, data.accounts, bills, { days }),
  });
}
