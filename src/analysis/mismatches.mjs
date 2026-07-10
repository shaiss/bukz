import { groupBy } from './stats.mjs';

// Payee/category divergence: if a payee lands in one category >= `dominance`
// of the time (with enough history), the stragglers are mismatch candidates.
// Payees with no dominant category (e.g. Amazon) are intentionally NOT flagged
// here — reviewing those is what spot-check is for.
export function findMismatches(transactions, opts = {}) {
  const { minHistory = 3, dominance = 0.8 } = opts;
  const t = transactions.filter((x) => !x.transfer && x.category && x.payee);
  const flags = [];
  for (const [payee, list] of groupBy(t, (x) => x.payee)) {
    if (list.length < minHistory) continue;
    let top = null;
    for (const [category, txns] of groupBy(list, (x) => x.category)) {
      if (!top || txns.length > top.count) top = { category, count: txns.length };
    }
    const share = top.count / list.length;
    if (share >= dominance && share < 1) {
      flags.push({
        payee,
        usualCategory: top.category,
        share: +share.toFixed(2),
        history: list.length,
        outliers: list.filter((x) => x.category !== top.category),
      });
    }
  }
  return flags.sort((a, b) => b.history - a.history);
}
