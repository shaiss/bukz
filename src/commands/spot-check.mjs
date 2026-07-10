import { parse, out, num } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { sampleForSpotCheck } from '../analysis/sample.mjs';

export async function run(argv) {
  const opts = parse(argv, {
    'per-category': { type: 'string' },
    seed: { type: 'string' },
  });
  const data = loadData(opts);
  out({
    meta: meta(data, opts),
    seed: num(opts.seed, 42),
    categories: sampleForSpotCheck(data.transactions, {
      perCategory: num(opts['per-category'], 5),
      seed: num(opts.seed, 42),
    }),
  });
}
