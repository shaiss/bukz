import { parse, out } from '../cli.mjs';
import { getProvider } from '../providers/index.mjs';
import { saveCache, loadData, mergeTransactions, CACHE_PATH, existsCache } from '../data.mjs';

// Default fetch window for a FIRST pull (no cache yet). Subsequent pulls are
// incremental — deltas only — so this window doesn't bound the cache's history.
const FIRST_PULL_DAYS = 365;

export async function run(argv) {
  const opts = parse(argv, { full: { type: 'boolean' } });
  const provider = getProvider(opts.provider);

  // An incremental pull is only valid against a cache from the SAME provider.
  // A provider switch (or --full) forces a clean full fetch so we never blend
  // two sources into one cache.
  const cache = existsCache() && !opts.full ? safeLoad() : null;
  const sameProvider = cache?.provider === provider.name;
  const incremental = sameProvider && !opts.full;

  let categories;
  let transactions;
  let cursor;
  let fetched;
  let accounts;
  let budgetMonths;
  if (incremental) {
    // Deltas since the last cursor. Categories, balances, and budget months
    // are cheap snapshots that can change, so refresh them on every pull;
    // transactions are the expensive, mergeable part.
    const [cats, extras, delta] = await Promise.all([
      provider.fetchCategories(),
      fetchExtras(provider),
      provider.fetchTransactions({ knowledge: cache.cursor }),
    ]);
    categories = cats;
    ({ accounts, budgetMonths } = extras);
    fetched = delta.transactions.length;
    transactions = mergeTransactions(cache.transactions, delta.transactions, delta.deleted);
    cursor = delta.knowledge ?? cache.cursor;
  } else {
    // Full fetch: a fresh cache. `--since` bounds the initial window only here.
    const since = opts.since ?? defaultSince();
    const [cats, full, extras] = await Promise.all([
      provider.fetchCategories(),
      provider.fetchTransactions({ since }),
      fetchExtras(provider),
    ]);
    categories = cats;
    ({ accounts, budgetMonths } = extras);
    transactions = [...full.transactions].sort((a, b) => a.date.localeCompare(b.date));
    fetched = transactions.length;
    cursor = full.knowledge ?? null;
    if (cache && !sameProvider) {
      // Warn (don't throw) so `pull` still succeeds; the old cache is replaced.
      process.stderr.write(
        `bukz: cache was for "${cache.provider}", switching to "${provider.name}" — full re-fetch.\n`
      );
    }
  }

  // `accounts`/`budgetMonths` are undefined for providers without them, and
  // JSON.stringify drops undefined keys — so the cache shape matches the
  // provider's capabilities.
  saveCache({
    pulledAt: new Date().toISOString(),
    provider: provider.name,
    since: cache?.since ?? opts.since ?? defaultSince(),
    cursor,
    categories,
    accounts,
    budgetMonths,
    transactions,
  });

  out({
    provider: provider.name,
    mode: incremental ? 'incremental' : 'full',
    fetched,
    total: transactions.length,
    categories: categories.length,
    accounts: accounts?.length ?? 0,
    budgetMonths: budgetMonths?.length ?? 0,
    dateRange: transactions.length
      ? { from: transactions[0].date, to: transactions.at(-1).date }
      : null,
    cache: CACHE_PATH,
  });
}

// Balances and budget months are optional provider capabilities (YNAB has
// them; Xero does not yet). Refreshed whole on every pull — cheap snapshots,
// not mergeable history. Missing capabilities yield undefined so the cache
// keys are dropped entirely (see saveCache below).
async function fetchExtras(provider) {
  const [accounts, budgetMonths] = await Promise.all([
    provider.fetchAccounts ? provider.fetchAccounts() : undefined,
    provider.fetchBudgetMonths ? provider.fetchBudgetMonths() : undefined,
  ]);
  return { accounts, budgetMonths };
}

function defaultSince() {
  const d = new Date();
  d.setDate(d.getDate() - FIRST_PULL_DAYS);
  return d.toISOString().slice(0, 10);
}

// Load without throwing if the cache is corrupt — a bad cache shouldn't block a
// pull; we just fall back to a full fetch and overwrite it.
function safeLoad() {
  try {
    return loadData({});
  } catch {
    return null;
  }
}
