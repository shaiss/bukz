import { parse, out } from '../cli.mjs';
import { getProvider } from '../providers/index.mjs';
import { saveCache, CACHE_PATH } from '../data.mjs';

export async function run(argv) {
  const opts = parse(argv);
  const provider = getProvider(opts.provider);
  const since = opts.since ?? defaultSince();
  const [categories, transactions] = await Promise.all([
    provider.fetchCategories(),
    provider.fetchTransactions({ since }),
  ]);
  transactions.sort((a, b) => a.date.localeCompare(b.date));
  saveCache({
    pulledAt: new Date().toISOString(),
    provider: provider.name,
    since,
    categories,
    transactions,
  });
  out({
    provider: provider.name,
    since,
    transactions: transactions.length,
    categories: categories.length,
    dateRange: transactions.length
      ? { from: transactions[0].date, to: transactions.at(-1).date }
      : null,
    cache: CACHE_PATH,
  });
}

function defaultSince() {
  const d = new Date();
  d.setDate(d.getDate() - 365);
  return d.toISOString().slice(0, 10);
}
