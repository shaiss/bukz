import { parse, out, num, assertDate } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { daysBetween } from '../analysis/stats.mjs';

// Receipt-to-transaction matcher: exact amount within a date window, plus
// near-misses (small tip/tax deltas) as a second tier.
export async function run(argv) {
  const opts = parse(argv, {
    amount: { type: 'string' },
    date: { type: 'string' },
    window: { type: 'string' },
    payee: { type: 'string' },
  });
  const amount = Math.abs(num(opts.amount, NaN));
  if (Number.isNaN(amount)) throw new Error('--amount is required, e.g. --amount 42.50');
  if (!opts.date) throw new Error('--date YYYY-MM-DD is required');
  assertDate('--date', opts.date);
  const window = num(opts.window, 4);

  const data = loadData(opts);
  let nearby = data.transactions.filter(
    (t) => !t.transfer && Math.abs(daysBetween(t.date, opts.date)) <= window
  );
  if (opts.payee) {
    const needle = opts.payee.toLowerCase();
    nearby = nearby.filter((t) => t.payee?.toLowerCase().includes(needle));
  }
  const exact = nearby.filter((t) => Math.abs(Math.abs(t.amount) - amount) < 0.005);
  const close = nearby
    .filter(
      (t) =>
        !exact.includes(t) &&
        Math.abs(Math.abs(t.amount) - amount) <= Math.max(0.02 * amount, 1)
    )
    .slice(0, 10);

  out({
    meta: meta(data, opts),
    query: { amount, date: opts.date, windowDays: window, payee: opts.payee ?? null },
    exact,
    close,
  });
}
