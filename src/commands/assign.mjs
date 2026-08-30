import { parse, out, num } from '../cli.mjs';
import { loadData, saveCache } from '../data.mjs';
import { getProvider } from '../providers/index.mjs';
import { planAssign, planMonthFunding } from '../analysis/budget.mjs';
import { toCents, fromCents } from '../analysis/money.mjs';

// Assign dollars to categories in a YNAB budget month. DRY-RUN BY DEFAULT:
// prints the plan and touches nothing; --yes (or --apply) executes. Two modes:
//   single:  assign --month 2026-09 --category "Groceries" --amount 400
//   planner: assign --month 2026-09 --copy-from 2026-08
// The planner proposes repeating the source month's budget in the target
// month (rows only where the target differs) and applies them as one
// confirmed batch. Category names must exist in the cached list; amounts are
// zero-or-positive new totals, not increments.
export async function run(argv) {
  const opts = parse(argv, {
    month: { type: 'string' },
    category: { type: 'string' },
    amount: { type: 'string' },
    'copy-from': { type: 'string' },
    yes: { type: 'boolean' },
    apply: { type: 'boolean' },
  });
  const apply = opts.yes || opts.apply;

  const provider = getProvider(opts.provider);
  if (provider.name !== 'ynab') {
    throw new Error(
      `assign is YNAB-only for now (you're on "${provider.name}"). ` +
      'Xero write-back is on the roadmap.'
    );
  }
  if (!opts.month) throw new Error('--month YYYY-MM is required (the budget month to assign in).');
  const single = Boolean(opts.category || opts.amount !== undefined);
  const planner = Boolean(opts['copy-from']);
  if (single === planner) {
    throw new Error(
      'Pass either --category "<name>" --amount N (one assignment) ' +
      'or --copy-from YYYY-MM (repeat a month), not both.'
    );
  }

  const cache = loadData({ in: opts.in });

  if (planner) {
    const plan = planMonthFunding({
      fromMonth: opts['copy-from'],
      toMonth: opts.month,
      budgetMonths: cache.budgetMonths ?? [],
    });
    if (!plan.assignments.length) {
      out({ meta: metaOf(cache, provider), applied: false, status: 'nothing-to-do', plan });
      return;
    }
    if (!apply) {
      out({
        meta: metaOf(cache, provider),
        applied: false,
        status: 'dry-run',
        plan,
        hint: `${plan.assignments.length} assignments, net change ${plan.planTotal}. Re-run with --yes to write them to YNAB.`,
      });
      return;
    }
    const applied = [];
    for (const row of plan.assignments) {
      const result = await provider.assignBudget({
        month: opts.month,
        categoryId: row.categoryId,
        amount: row.proposed,
      });
      applied.push({ category: row.category, budgeted: result.category.budgeted });
      if (!opts.in) mergeBudgetMonth(cache, opts.month, result.category);
    }
    if (!opts.in) saveCache({ ...cache, pulledAt: new Date().toISOString() });
    out({ meta: metaOf(cache, provider), applied: true, status: 'done', plan, applied });
    return;
  }

  // Single assignment.
  if (!opts.category) throw new Error('--category "<name>" is required (list names with: node bin/bukz.mjs categories)');
  const amount = num(opts.amount, NaN);
  if (Number.isNaN(amount)) throw new Error('--amount N is required (the new budgeted total, zero or positive)');
  const plan = planAssign({
    month: opts.month,
    categoryName: opts.category,
    amount,
    categories: cache.categories ?? [],
    budgetMonths: cache.budgetMonths ?? [],
  });
  if (!apply) {
    out({
      meta: metaOf(cache, provider),
      applied: false,
      status: 'dry-run',
      plan,
      hint: 'Re-run with --yes (or --apply) to write this change to YNAB.',
    });
    return;
  }
  const result = await provider.assignBudget({ month: opts.month, categoryId: plan.categoryId, amount });
  if (!opts.in) {
    mergeBudgetMonth(cache, opts.month, result.category);
    saveCache({ ...cache, pulledAt: new Date().toISOString() });
  }
  out({ meta: metaOf(cache, provider), applied: true, status: 'done', plan: { ...plan, newBudgeted: result.category.budgeted } });
}

function metaOf(cache, provider) {
  return { provider: provider.name, pulledAt: cache.pulledAt };
}

// Fold an assignment back into the local budgetMonths snapshot so the
// variance view reflects it without a re-pull. For a month not yet cached
// (e.g. a future month YNAB just created), append a minimal month — the next
// pull replaces it with the full truth.
function mergeBudgetMonth(cache, month, category) {
  const months = cache.budgetMonths ? [...cache.budgetMonths] : [];
  const i = months.findIndex((m) => m.month === month);
  if (i === -1) {
    months.push({ month, budgeted: category.budgeted, activity: 0, toBeBudgeted: 0, ageOfMoney: null, categories: [category] });
    months.sort((a, b) => a.month.localeCompare(b.month));
  } else {
    const snapshot = { ...months[i], categories: [...months[i].categories] };
    const idx = snapshot.categories.findIndex((c) => c.id === category.id);
    if (idx === -1) snapshot.categories.push(category);
    else snapshot.categories[idx] = { ...snapshot.categories[idx], ...category };
    snapshot.budgeted = fromCents(snapshot.categories.reduce((c, x) => c + toCents(x.budgeted), 0));
    months[i] = snapshot;
  }
  cache.budgetMonths = months;
}
