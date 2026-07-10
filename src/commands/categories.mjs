import { parse, out } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';

export async function run(argv) {
  const opts = parse(argv);
  const data = loadData(opts);
  out({ meta: meta(data, opts), categories: data.categories ?? [] });
}
