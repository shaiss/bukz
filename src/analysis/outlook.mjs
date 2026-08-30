import { toCents, fromCents, round2 } from './money.mjs';
import { newestDate, addDays, monthLength } from './period.mjs';

// Cash look-ahead: for each open account, the current balance minus the bills
// falling due in the window, with a red/yellow/green coverage status.
// Statuses are deliberately simple and fixed in v1 — the raw numbers always
// ship alongside so a skill (or the human) can disagree:
//   red    projected balance below zero — a bill bounces
//   yellow projected balance under the cushion: max(25% of projected outflows, $250)
//   green  otherwise (an account with nothing due is green while balance >= 0)
// Bills with no amount (variable) or cadence "manual" are not projected;
// non-autopay bills with a known next date surface in manualWatch, and bills
// whose paidFrom doesn't match any cached account surface in unmatchedBills
// (glossary drift — fix the name in config/bills.json).
// "Now" is the newest transaction date (determinism convention), so a fresh
// pull makes the window start effectively today.
export function outlook(transactions, accounts = [], bills = [], { days = 14 } = {}) {
  const referenceDate = newestDate(transactions);
  const windowEnd = addDays(referenceDate, days);
  const manualEnd = addDays(referenceDate, 30);

  const known = new Set(accounts.map((a) => a.name));
  const open = accounts.filter((a) => !a.closed);
  const dueByAccount = new Map(open.map((a) => [a.name, []]));
  const manualWatch = [];
  const unmatched = [];

  for (const bill of bills) {
    if (bill.active === false) continue;
    if (bill.paidFrom && !known.has(bill.paidFrom)) {
      unmatched.push({ name: bill.name, paidFrom: bill.paidFrom });
    }
    if (bill.amount != null && bill.paidFrom && dueByAccount.has(bill.paidFrom)) {
      dueByAccount.get(bill.paidFrom).push(
        ...occurrences(bill, referenceDate, windowEnd).map((date) => ({
          name: bill.name,
          amount: round2(bill.amount),
          date,
        }))
      );
    }
    if (bill.autopay !== 'yes') {
      const next = occurrences(bill, referenceDate, manualEnd)[0];
      if (next) {
        manualWatch.push({
          name: bill.name,
          amount: bill.amount == null ? null : round2(bill.amount),
          date: next,
          paidFrom: bill.paidFrom ?? null,
          autopay: bill.autopay ?? null,
        });
      }
    }
  }

  const accountRows = open
    .map((a) => {
      const billsDue = (dueByAccount.get(a.name) ?? []).sort(
        (x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name)
      );
      const outCents = billsDue.reduce((c, b) => c + toCents(b.amount), 0);
      const projected = toCents(a.balance) - outCents;
      const cushion = Math.max(Math.round(outCents * 0.25), 25_000);
      const status =
        projected < 0 ? 'red' : outCents === 0 ? 'green' : projected < cushion ? 'yellow' : 'green';
      return {
        account: a.name,
        type: a.type ?? null,
        balance: round2(a.balance),
        billsDue,
        projectedOutflows: fromCents(outCents),
        projectedBalance: fromCents(projected),
        cushion: fromCents(cushion),
        status,
      };
    })
    .sort((a, b) => a.account.localeCompare(b.account));

  const rank = { green: 0, yellow: 1, red: 2 };
  const status = accountRows.reduce(
    (worst, r) => (rank[r.status] > rank[worst] ? r.status : worst),
    'green'
  );

  manualWatch.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  return {
    referenceDate,
    window: { days, to: windowEnd },
    status, // worst of accounts — "everything green" only if all are
    accounts: accountRows,
    manualWatch,
    unmatchedBills: unmatched.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// All occurrence dates of a bill in (fromDate, toDate]. fromDate itself is
// excluded: a bill that already posted on the reference date is already
// reflected in the balance. Weekly/biweekly bills key off `anchor` (a known
// past occurrence); everything else keys off dayOfMonth (+ `month` for
// quarterly/annual anchors).
function occurrences(bill, fromDate, toDate) {
  const out = [];

  if (bill.cadence === 'weekly' || bill.cadence === 'biweekly') {
    if (!bill.anchor) return out;
    const step = bill.cadence === 'weekly' ? 7 : 14;
    let d = bill.anchor;
    while (d <= fromDate) d = addDays(d, step);
    while (d <= toDate) {
      out.push(d);
      d = addDays(d, step);
    }
    return out;
  }

  if (!bill.dayOfMonth) return out;

  const stepMonths = bill.cadence === 'quarterly' ? 3 : bill.cadence === 'annual' ? 12 : 1;
  if (stepMonths > 1 && bill.month == null) return out; // quarterly/annual need an anchor month
  const [fy, fm] = fromDate.split('-').map(Number);
  const [ty, tm] = toDate.split('-').map(Number);
  const phase = bill.month != null ? (fy * 12 + bill.month - 1) % stepMonths : null;
  for (let idx = fy * 12 + fm - 1; idx <= ty * 12 + tm - 1; idx++) {
    if (phase != null && idx % stepMonths !== phase) continue;
    const y = Math.floor(idx / 12);
    const m = idx % 12 + 1;
    const day = Math.min(bill.dayOfMonth, monthLength(y, m));
    const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (date > fromDate && date <= toDate) out.push(date);
  }
  return out;
}
