import { parse, out, num } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { findMismatches } from '../analysis/mismatches.mjs';

export async function run(argv) {
  const opts = parse(argv, {
    'min-history': { type: 'string' },
    dominance: { type: 'string' },
  });
  const data = loadData(opts);
  out({
    meta: meta(data, opts),
    mismatches: findMismatches(data.transactions, {
      minHistory: num(opts['min-history'], 3),
      dominance: num(opts.dominance, 0.8),
    }),
  });
}
