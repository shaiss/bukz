// Period/date helpers for the reporting commands. "Now" is always derived from
// the data (the newest transaction date), never the wall clock — the same
// convention as anomaly detection, so demos and tests are reproducible.

// YYYY-MM-DD strings parse to UTC midnights, making day arithmetic exact in
// any local timezone (same trick as daysBetween in stats.mjs).
const DAY_MS = 86_400_000;

export function addDays(date, n) {
  return new Date(new Date(date).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

// Days in a month; `month` is 1-based. Day 0 of the following month is the
// last day of this one.
export function monthLength(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function newestDate(transactions) {
  if (!transactions.length) {
    throw new Error('No transactions in the cached range — nothing to report on.');
  }
  return transactions.reduce((m, t) => (t.date > m ? t.date : m), transactions[0].date);
}

// First and last calendar day of a YYYY-MM month, as YYYY-MM-DD strings.
export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  return { since: `${month}-01`, until: `${month}-${String(monthLength(y, m)).padStart(2, '0')}` };
}
