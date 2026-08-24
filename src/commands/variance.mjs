import { parse, out } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { budgetVariance, defaultMonth } from '../analysis/variance.mjs';

// Budget vs actual for one calendar month. Scoped by --month, not
// --since/--until: a month's variance needs the whole month of transactions,
// and a partial window would silently understate actuals.
export async function run(argv) {
  const opts = parse(argv, { month: { type: 'string' } });
  if (opts.since || opts.until) {
    throw new Error('--since/--until do not apply to variance — scope it with --month YYYY-MM (whole month).');
  }
  const data = loadData({ in: opts.in });
  const month = opts.month ?? defaultMonth(data.transactions, data.budgetMonths ?? []);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`--month must be YYYY-MM, e.g. 2026-08 (got "${month}")`);
  }
  if (!data.budgetMonths) {
    throw new Error(
      'No budget months in the cache. Pull from a provider that exposes budgets (YNAB), ' +
        'or try demo mode: --in fixtures/sample.json'
    );
  }
  out({
    meta: meta(data, opts),
    ...budgetVariance(data.transactions, data.budgetMonths, month),
  });
}
