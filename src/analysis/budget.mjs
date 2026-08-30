// Budget-work analysis: month-ahead metrics, assignment planning, and the
// dry-run plan for `assign`. Everything here is pure — the command layer owns
// confirmation and writes. Conventions match variance.mjs: positive-outflow
// money, integer cents, deterministic sorts.

import { toCents, fromCents, round2 } from './money.mjs';
import { newestDate } from './period.mjs';

const nextMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y, m, 1)); // day 1 of the following month
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const assignedTotal = (snapshot) =>
  fromCents(snapshot.categories.reduce((c, x) => c + toCents(x.budgeted), 0));

// The get-a-month-ahead question: while living in month M, is M+1 already
// funded? Focus month = the newest transaction's month (the month you're
// living in, never the wall clock). Next month's `assigned` reads from its
// cached snapshot if the month exists in the budget yet, else zero. The
// reference for "fully funded" is the total assigned in the month BEFORE the
// focus month — "fund next month like last month". When that month has
// nothing assigned (a budget never funded at category level), the reference
// falls back to the largest monthly assignment in the cache, and to zero
// (fundedPct null) when no month was ever funded. Age of Money and Ready to
// Assign come straight from the focus month's snapshot.
export function monthAhead(transactions, budgetMonths = []) {
  const focus = newestDate(transactions).slice(0, 7);
  const byMonth = new Map(budgetMonths.map((m) => [m.month, m]));
  const focusSnapshot = byMonth.get(focus) ?? null;
  const next = byMonth.get(nextMonth(focus)) ?? null;
  const prior = byMonth.get(
    [...byMonth.keys()].filter((m) => m < focus).sort().pop() ?? focus
  ) ?? null;

  const focusAssigned = focusSnapshot ? assignedTotal(focusSnapshot) : 0;
  const priorAssigned = prior && prior.month !== focus ? assignedTotal(prior) : 0;
  const reference = priorAssigned > 0
    ? priorAssigned
    : Math.max(focusAssigned, ...budgetMonths.map((m) => assignedTotal(m)), 0);
  const assigned = next ? assignedTotal(next) : 0;
  return {
    focusMonth: focus,
    ageOfMoney: focusSnapshot?.ageOfMoney ?? null,
    readyToAssign: focusSnapshot ? round2(focusSnapshot.toBeBudgeted) : null,
    next: {
      month: nextMonth(focus),
      cached: Boolean(next),
      assigned,
      reference,
      fundedPct: reference > 0 ? Math.round((assigned / reference) * 100) : null,
    },
  };
}

// Dry-run plan for a single assignment. Resolves the category by NAME against
// the cached category list (never an invented name), reads the current
// budgeted amount from the month snapshot when the month exists in the cache,
// and computes the delta. Mirrors planChange in recategorize.mjs.
export function planAssign({ month, categoryName, amount, categories = [], budgetMonths = [] }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`--month must be YYYY-MM, e.g. 2026-09 (got "${month}")`);
  }
  if (!(amount >= 0)) {
    throw new Error(`--amount must be zero or positive (got ${amount})`);
  }
  const match = categories.filter((c) => c.name === categoryName);
  if (!match.length) {
    throw new Error(`No category named "${categoryName}" in the cache. Load real names with: node bin/bukz.mjs categories`);
  }
  const snapshotMonth = budgetMonths.find((m) => m.month === month);
  const current = snapshotMonth?.categories.find((c) => c.id === match[0].id);
  return {
    month,
    categoryId: match[0].id,
    category: categoryName,
    currentBudgeted: current ? round2(current.budgeted) : null,
    newBudgeted: round2(amount),
    delta: fromCents(toCents(amount) - toCents(current?.budgeted ?? 0)),
    monthCached: Boolean(snapshotMonth),
    applied: false,
  };
}

// The month-funding planner: propose next month's assignments as "repeat the
// source month's budget". A row appears for every category where the target
// differs from the source (no-ops are skipped), sorted by name — deterministic.
// `total` is the plan's net change, shown alongside the target month's
// Ready to Assign so the caller can judge whether the plan is coverable.
export function planMonthFunding({ fromMonth, toMonth, budgetMonths = [] }) {
  const source = budgetMonths.find((m) => m.month === fromMonth);
  const target = budgetMonths.find((m) => m.month === toMonth);
  if (!source) {
    const have = budgetMonths.map((m) => m.month).join(', ') || 'none cached';
    throw new Error(`--copy-from month ${fromMonth} is not in the cache (have: ${have}).`);
  }
  const targetById = new Map((target?.categories ?? []).map((c) => [c.id, c]));
  const rows = [];
  for (const src of source.categories) {
    const current = targetById.get(src.id)?.budgeted ?? 0;
    if (toCents(current) === toCents(src.budgeted)) continue; // already right
    rows.push({
      category: src.name,
      categoryId: src.id,
      from: round2(src.budgeted),
      current: target ? round2(current) : null,
      proposed: round2(src.budgeted),
      delta: fromCents(toCents(src.budgeted) - toCents(current)),
    });
  }
  rows.sort((a, b) => a.category.localeCompare(b.category));
  return {
    fromMonth,
    toMonth,
    toMonthCached: Boolean(target),
    readyToAssign: target ? round2(target.toBeBudgeted) : null,
    alreadyAssigned: target ? assignedTotal(target) : 0,
    planTotal: fromCents(rows.reduce((c, r) => c + toCents(r.delta), 0)),
    assignments: rows,
  };
}
