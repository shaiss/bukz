import { parse, out } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { cashflow } from '../analysis/cashflow.mjs';

// Cash movement by month and account, across the whole cached range unless
// bounded by --since/--until. Includes transfers — the point is where cash
// actually went (see the analysis module for why this is the one exception).
export async function run(argv) {
  const opts = parse(argv);
  const data = loadData(opts);
  out({ meta: meta(data, opts), ...cashflow(data.transactions) });
}
