import { groupBy, median } from './stats.mjs';

// Payee→category rule candidates: a payee with enough categorized history that
// lands in one category most of the time proposes the rule itself. Where
// `mismatches` flags a dominant payee's stragglers, this extracts the mapping —
// for a bookkeeper, or an agent entering default categories in the YNAB UI
// (YNAB's rules are not API-writable). Each rule carries the uncategorized rows
// it would fix: leads for per-row, confirmed `recategorize` — never a bulk write.
// Payees with no dominant category (e.g. Costco) are listed as ambiguous; a
// human decides whether they need splits or multiple rules.
export function deriveRules(transactions, opts = {}) {
  const { minSupport = 3, minConfidence = 0.8 } = opts;
  const t = transactions.filter((x) => !x.transfer && x.payee);
  const rules = [];
  const ambiguous = [];
  let belowMinSupport = 0;

  for (const [payee, rows] of groupBy(t, (x) => x.payee)) {
    const categorized = rows.filter((x) => x.category);
    const uncategorized = rows.filter((x) => !x.category);
    if (categorized.length < minSupport) {
      belowMinSupport++;
      continue;
    }
    // Count desc, then name asc, so the top category — and the whole output —
    // is deterministic regardless of row order.
    const categories = [...groupBy(categorized, (x) => x.category).entries()]
      .map(([category, list]) => ({ category, count: list.length }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    const top = categories[0];
    const confidence = top.count / categorized.length;
    const base = {
      payee,
      support: categorized.length,
      medianAmount: +median(rows.map((x) => x.amount)).toFixed(2),
      lastDate: rows.reduce((m, x) => (x.date > m ? x.date : m), rows[0].date),
    };
    if (confidence >= minConfidence) {
      rules.push({
        ...base,
        category: top.category,
        confidence: +confidence.toFixed(2),
        exceptions: categorized.filter((x) => x.category !== top.category),
        uncategorized,
      });
    } else {
      ambiguous.push({ ...base, categories, uncategorizedCount: uncategorized.length });
    }
  }

  rules.sort(
    (a, b) =>
      b.uncategorized.length - a.uncategorized.length ||
      b.support - a.support ||
      a.payee.localeCompare(b.payee)
  );
  ambiguous.sort((a, b) => b.support - a.support || a.payee.localeCompare(b.payee));

  return {
    rules,
    ambiguous,
    summary: {
      payeesConsidered: rules.length + ambiguous.length + belowMinSupport,
      rules: rules.length,
      ambiguous: ambiguous.length,
      belowMinSupport,
      uncategorizedRowsInRules: rules.reduce((n, r) => n + r.uncategorized.length, 0),
    },
  };
}
