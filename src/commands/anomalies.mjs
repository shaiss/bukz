import { parse, out, num } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { findAnomalies } from '../analysis/anomalies.mjs';

export async function run(argv) {
  const opts = parse(argv, {
    z: { type: 'string' },
    window: { type: 'string' },
    top: { type: 'string' },
  });
  const data = loadData(opts);
  out({
    meta: meta(data, opts),
    ...findAnomalies(data.transactions, {
      z: num(opts.z, 3.5),
      window: num(opts.window, 3),
      top: num(opts.top, 5),
    }),
  });
}
