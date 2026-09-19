import { groupBy, median, mad, robustZ, daysBetween } from './stats.mjs';
import { isUncategorized } from './categorization.mjs';

// Mechanical anomaly candidates. Everything here is a *lead*, not a verdict —
// the skills layer (Claude) triages each flag with payee/context judgment.
// "Now" is the newest transaction date, not the wall clock, so results are
// deterministic and fixtures never go stale.
export function findAnomalies(transactions, opts = {}) {
  const { z = 3.5, window = 3, top = 5, newPayeeDays = 30 } = opts;
  const t = transactions.filter((x) => !x.transfer);
  const referenceDate = t.reduce((m, x) => (x.date > m ? x.date : m), '0000-00-00');
  return {
    referenceDate,
    duplicates: findDuplicates(t, window),
    amountOutliers: findAmountOutliers(t, z),
    signFlips: findSignFlips(t),
    newLargePayees: findNewLargePayees(t, referenceDate, newPayeeDays),
    missingRecurring: findMissingRecurring(t, referenceDate),
    largest: [...t].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, top),
    uncategorizedCount: t.filter(isUncategorized).length,
    unapprovedCount: t.filter((x) => x.approved === false).length,
  };
}

// Same payee + same amount within a few days → possible double charge.
// Monthly/weekly recurrences don't trip this because their gaps exceed the window.
function findDuplicates(t, windowDays) {
  const groups = groupBy(
    t.filter((x) => x.payee && x.amount !== 0),
    (x) => `${x.payee}|${x.amount.toFixed(2)}`
  );
  const dups = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(sorted[i - 1].date, sorted[i].date);
      if (gap <= windowDays) {
        dups.push({ daysApart: gap, first: sorted[i - 1], second: sorted[i] });
      }
    }
  }
  return dups;
}

// Leave-one-out robust z-score of each amount against the payee's other amounts.
function findAmountOutliers(t, zThreshold) {
  const byPayee = groupBy(t.filter((x) => x.payee), (x) => x.payee);
  const flags = [];
  for (const list of byPayee.values()) {
    if (list.length < 4) continue;
    for (const txn of list) {
      const others = list.filter((o) => o.id !== txn.id).map((o) => o.amount);
      const score = robustZ(txn.amount, others);
      if (Math.abs(score) >= zThreshold) {
        flags.push({
          z: +score.toFixed(1),
          typicalAmount: +median(others).toFixed(2),
          history: list.length,
          txn,
        });
      }
    }
  }
  return flags.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

// A payee that is almost always money-out suddenly shows money-in (or vice
// versa) — usually a refund, sometimes a sign error at entry.
function findSignFlips(t) {
  const byPayee = groupBy(t.filter((x) => x.payee && x.amount !== 0), (x) => x.payee);
  const flags = [];
  for (const [payee, list] of byPayee) {
    if (list.length < 5) continue;
    const outflowShare = list.filter((x) => x.amount < 0).length / list.length;
    if (outflowShare >= 0.8 && outflowShare < 1) {
      flags.push({
        payee,
        history: list.length,
        usualDirection: 'outflow',
        exceptions: list.filter((x) => x.amount > 0),
      });
    } else if (outflowShare <= 0.2 && outflowShare > 0) {
      flags.push({
        payee,
        history: list.length,
        usualDirection: 'inflow',
        exceptions: list.filter((x) => x.amount < 0),
      });
    }
  }
  return flags;
}

// First-ever appearance of a payee, recently, with an amount in the top decile
// of the whole dataset — worth a "did you expect this?" question.
function findNewLargePayees(t, referenceDate, days) {
  const withPayee = t.filter((x) => x.payee);
  if (!withPayee.length) return [];
  const firstSeen = new Map();
  for (const x of withPayee) {
    const current = firstSeen.get(x.payee);
    if (!current || x.date < current) firstSeen.set(x.payee, x.date);
  }
  const absAmounts = withPayee.map((x) => Math.abs(x.amount)).sort((a, b) => a - b);
  const p90 = absAmounts[Math.floor(absAmounts.length * 0.9)] ?? 0;
  const flags = [];
  for (const [payee, first] of firstSeen) {
    if (daysBetween(first, referenceDate) > days) continue;
    const large = withPayee.filter((x) => x.payee === payee && Math.abs(x.amount) >= p90);
    if (large.length) flags.push({ payee, firstSeen: first, largeTransactions: large });
  }
  return flags;
}

// Payees with a steady weekly/biweekly/monthly outflow cadence that have gone
// quiet for 1.5x their usual gap — cancelled service, failed payment, or a
// missed entry.
function findMissingRecurring(t, referenceDate) {
  const byPayee = groupBy(t.filter((x) => x.payee && x.amount < 0), (x) => x.payee);
  const flags = [];
  for (const [payee, list] of byPayee) {
    const dates = [...new Set(list.map((x) => x.date))].sort();
    if (dates.length < 3) continue;
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
    const typicalGap = median(gaps);
    const cadence =
      typicalGap >= 6 && typicalGap <= 8 ? 'weekly'
      : typicalGap >= 13 && typicalGap <= 16 ? 'biweekly'
      : typicalGap >= 27 && typicalGap <= 33 ? 'monthly'
      : null;
    if (!cadence || mad(gaps) > 3) continue;
    const daysSinceLast = daysBetween(dates.at(-1), referenceDate);
    if (daysSinceLast > typicalGap * 1.5) {
      flags.push({
        payee,
        cadence,
        medianGapDays: typicalGap,
        lastSeen: dates.at(-1),
        daysSinceLast,
        typicalAmount: +median(list.map((x) => x.amount)).toFixed(2),
      });
    }
  }
  return flags;
}
