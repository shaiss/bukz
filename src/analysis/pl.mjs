import { toCents, fromCents } from './money.mjs';

// Profit & loss over a period: income vs expense by category. Classification
// is purely sign-based (positive = income, negative = expense) so it works for
// any provider; a category's group comes from the cached category list.
// Transfers are excluded — they move money, they don't earn or spend it.
// Rows with no category roll up under "Uncategorized" so nothing hides.
export function profitAndLoss(transactions, categories = []) {
  const groupByName = new Map(categories.map((c) => [c.name, c.group ?? null]));
  const income = new Map();
  const expenses = new Map();

  for (const t of transactions) {
    if (t.transfer || t.amount === 0) continue;
    const side = t.amount > 0 ? income : expenses;
    const key = t.category ?? 'Uncategorized';
    const row =
      side.get(key) ?? { category: key, group: groupByName.get(key) ?? null, cents: 0, count: 0 };
    row.cents += toCents(t.amount);
    row.count++;
    side.set(key, row);
  }

  // Largest total first, then name — deterministic regardless of row order.
  const shape = (side) =>
    [...side.values()]
      .map((r) => ({ category: r.category, group: r.group, total: fromCents(Math.abs(r.cents)), count: r.count }))
      .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));

  const incomeRows = shape(income);
  const expenseRows = shape(expenses);
  const incomeCents = incomeRows.reduce((c, r) => c + toCents(r.total), 0);
  const expenseCents = expenseRows.reduce((c, r) => c + toCents(r.total), 0);
  return {
    income: incomeRows,
    expenses: expenseRows,
    totals: {
      income: fromCents(incomeCents),
      expenses: fromCents(expenseCents),
      net: fromCents(incomeCents - expenseCents),
    },
  };
}
