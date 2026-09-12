// Check transactions against a curated payee→category rule set (user-owned,
// usually synced from the hub sheet into config/rules.json). Exact payee
// string match only — fuzzy merchant variants are a later roadmap slice.
// Output is leads for triage (flag, don't verdict): violations (wrong
// category), uncategorized matches (rule applies but category is null), and
// correct matches. Transfers are excluded. Every finding row includes account.

export function checkCuratedRules(transactions, rules, opts = {}) {
  const includeMatches = opts.includeMatches !== false;
  const activeRules = (rules ?? []).filter((r) => r && r.active !== false && r.payee && r.category);

  // First active rule wins when the curated set has duplicate payees.
  const byPayee = new Map();
  for (const r of activeRules) {
    if (!byPayee.has(r.payee)) byPayee.set(r.payee, r);
  }

  const violations = [];
  const uncategorized = [];
  const matches = [];

  for (const txn of transactions) {
    if (txn.transfer || !txn.payee) continue;
    const rule = byPayee.get(txn.payee);
    if (!rule) continue;

    const finding = {
      payee: txn.payee,
      expectedCategory: rule.category,
      category: txn.category ?? null,
      account: txn.account ?? null,
      date: txn.date,
      amount: txn.amount,
      id: txn.id,
      ruleNotes: rule.notes ?? null,
    };

    if (!txn.category) {
      uncategorized.push(finding);
    } else if (txn.category !== rule.category) {
      violations.push(finding);
    } else {
      // Always count correct matches in summary; only omit the list when
      // includeMatches is false (--violations-only).
      matches.push(finding);
    }
  }

  const sortFindings = (a, b) =>
    a.payee.localeCompare(b.payee) ||
    a.date.localeCompare(b.date) ||
    String(a.id).localeCompare(String(b.id));

  violations.sort(sortFindings);
  uncategorized.sort(sortFindings);
  matches.sort(sortFindings);

  return {
    summary: {
      rulesActive: byPayee.size,
      rulesInactive: (rules ?? []).length - activeRules.length,
      transactionsChecked: transactions.filter((t) => !t.transfer).length,
      violations: violations.length,
      uncategorized: uncategorized.length,
      matches: matches.length,
    },
    violations,
    uncategorized,
    matches: includeMatches ? matches : undefined,
  };
}
