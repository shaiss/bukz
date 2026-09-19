import { parse, out } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { isUncategorized } from '../analysis/categorization.mjs';

const LIST_CAP = 100; // real budgets can have thousands; keep output readable

export async function run(argv) {
  const opts = parse(argv);
  const data = loadData(opts);
  const t = data.transactions.filter((x) => !x.transfer);
  const uncategorized = t.filter(isUncategorized);
  const unapproved = t.filter((x) => x.approved === false);
  out({
    meta: meta(data, opts),
    uncategorized: { count: uncategorized.length, transactions: uncategorized.slice(0, LIST_CAP) },
    unapproved: { count: unapproved.length, transactions: unapproved.slice(0, LIST_CAP) },
  });
}
