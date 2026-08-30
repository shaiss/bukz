import { parse, out } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { profitAndLoss } from '../analysis/pl.mjs';
import { newestDate, monthBounds } from '../analysis/period.mjs';

// P&L for a period. With neither --since nor --until, the period defaults to
// the calendar month of the newest transaction (month-to-date on fresh data) —
// derived from the data, never the wall clock, so demo runs stay stable.
export async function run(argv) {
  const opts = parse(argv);
  const data = loadData(opts);
  let transactions = data.transactions;
  let period;
  if (!opts.since && !opts.until) {
    const month = newestDate(transactions).slice(0, 7);
    period = { month, ...monthBounds(month) };
    transactions = transactions.filter((t) => t.date >= period.since && t.date <= period.until);
  } else {
    // Actual data range, so the report shows what it really covered.
    period = transactions.length
      ? { since: transactions[0].date, until: transactions.at(-1).date }
      : { since: opts.since ?? null, until: opts.until ?? null };
  }
  out({
    meta: meta({ ...data, transactions }, { ...opts, since: period.since, until: period.until }),
    period,
    ...profitAndLoss(transactions, data.categories ?? []),
  });
}
