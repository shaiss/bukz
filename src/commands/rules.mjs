import { parse, out, num } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { deriveRules } from '../analysis/rules.mjs';

export async function run(argv) {
  const opts = parse(argv, {
    'min-support': { type: 'string' },
    'min-confidence': { type: 'string' },
  });
  const minSupport = num(opts['min-support'], 3);
  if (!Number.isInteger(minSupport) || minSupport < 1) {
    throw new Error(`--min-support must be an integer >= 1 (got "${opts['min-support']}")`);
  }
  const minConfidence = num(opts['min-confidence'], 0.8);
  if (minConfidence <= 0 || minConfidence > 1) {
    throw new Error(`--min-confidence must be in (0, 1] (got "${opts['min-confidence']}")`);
  }
  const data = loadData(opts);
  const { rules, ambiguous, summary } = deriveRules(data.transactions, {
    minSupport,
    minConfidence,
  });
  out({
    meta: meta(data, opts),
    query: { minSupport, minConfidence },
    summary,
    rules,
    ambiguous,
  });
}
