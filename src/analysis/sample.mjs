import { groupBy } from './stats.mjs';
import { isUncategorized } from './categorization.mjs';

// Stratified sample for the category spot check: for each category, always
// include its largest transaction (highest audit value), then fill with a
// recency-biased random draw. Seeded PRNG so the same books + seed always
// produce the same sample — reviews are reproducible and re-runs comparable.
export function sampleForSpotCheck(transactions, opts = {}) {
  const { perCategory = 5, seed = 42 } = opts;
  const t = transactions.filter((x) => !x.transfer && !isUncategorized(x));
  const rand = mulberry32(seed);
  const result = [];
  const byCategory = [...groupBy(t, (x) => x.category).entries()]
    .sort((a, b) => b[1].length - a[1].length);
  for (const [category, list] of byCategory) {
    const byRecency = [...list].sort((a, b) => b.date.localeCompare(a.date));
    const largest = [...list].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
    const picks = new Map([[largest.id, largest]]);
    const target = Math.min(perCategory, list.length);
    // Iteration bound guards against pathological inputs (e.g. duplicate ids).
    for (let i = 0; i < target * 50 && picks.size < target; i++) {
      // rand()^2 biases the draw toward recent transactions.
      const pick = byRecency[Math.floor(rand() ** 2 * byRecency.length)];
      picks.set(pick.id, pick);
    }
    result.push({
      category,
      totalTransactions: list.length,
      sample: [...picks.values()].sort((a, b) => b.date.localeCompare(a.date)),
    });
  }
  return result;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
