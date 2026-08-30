import { toCents, fromCents, round2 } from './money.mjs';
import { newestDate } from './period.mjs';

// The month a variance report targets when --month is not given: the newest
// transaction's month, or — when that month has no snapshot yet (e.g. a demo
// fixture, or a cache pulled before the month opened in the budget) — the
// newest cached budget month. The chosen month is always in the output.
export function defaultMonth(transactions, budgetMonths = []) {
  const newest = newestDate(transactions).slice(0, 7);
  if (!budgetMonths.length || budgetMonths.some((m) => m.month === newest)) return newest;
  return budgetMonths.reduce((m, x) => (x.month > m ? x.month : m), budgetMonths[0].month);
}

// Budget vs actual for one calendar month, per category. `budgeted` comes from
// the provider's month snapshot (cached by pull); `actual` is recomputed from
// the cached transactions so it reflects the local reality. Refunds count
// against spend (an inflow to a category reduces its actual), matching YNAB's
// activity. All numbers use the positive-outflow convention;
// remaining = budgeted − actual (positive = under budget).
// Transfers are excluded — they carry no category. Spending in categories
// missing from the snapshot (e.g. uncategorized) is appended so it can't hide.
export function budgetVariance(transactions, budgetMonths, month) {
  const snapshot = (budgetMonths ?? []).find((m) => m.month === month);
  if (!snapshot) {
    const available = (budgetMonths ?? []).map((m) => m.month).join(', ') || 'none cached';
    throw new Error(
      `No budget data for ${month} (cached months: ${available}). ` +
        'Pull from a provider that exposes budgets (YNAB).'
    );
  }

  const actualCents = new Map(); // keyed by categoryId (fallback: category name)
  const displayFor = new Map();
  for (const t of transactions) {
    if (t.transfer || !t.date.startsWith(month)) continue;
    const key = t.categoryId ?? t.category ?? 'Uncategorized';
    actualCents.set(key, (actualCents.get(key) ?? 0) - toCents(t.amount));
    displayFor.set(key, t.category ?? 'Uncategorized');
  }

  const rows = [];
  for (const c of snapshot.categories) {
    const cents = actualCents.get(c.id) ?? actualCents.get(c.name) ?? 0;
    actualCents.delete(c.id);
    actualCents.delete(c.name);
    rows.push({
      category: c.name,
      budgeted: round2(c.budgeted),
      actual: fromCents(cents),
      remaining: fromCents(toCents(c.budgeted) - cents),
      target: c.goalTarget != null ? round2(c.goalTarget) : null,
    });
  }
  for (const [key, cents] of actualCents) {
    // Net-inflow categories (income) aren't unbudgeted spend — skip them.
    // Snapshot categories above keep full sign behavior (refunds net against
    // spend); this filter only applies to categories with no budget line.
    if (cents <= 0) continue;
    rows.push({ category: displayFor.get(key) ?? key, budgeted: 0, actual: fromCents(cents), remaining: fromCents(-cents), target: null });
  }

  // Worst overshoot first, then name — deterministic.
  rows.sort((a, b) => toCents(a.remaining) - toCents(b.remaining) || a.category.localeCompare(b.category));

  return {
    month,
    // The provider's own month-level numbers, for cross-checking the recompute.
    snapshot: {
      budgeted: round2(snapshot.budgeted),
      activity: round2(snapshot.activity),
      toBeBudgeted: round2(snapshot.toBeBudgeted),
    },
    categories: rows,
  };
}
