import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './env.mjs';

export const CACHE_PATH = resolve(ROOT, 'data', 'transactions.json');

// Cache shape: { pulledAt, provider, since, categories: [...], transactions: [...],
//                accounts?: [...], budgetMonths?: [...],   // optional provider capabilities
//                cursor?: any }   // provider-specific delta cursor (e.g. YNAB server_knowledge)
// Transactions are the normalized cross-provider shape (see providers/index.mjs).
// `accounts` (balances) and `budgetMonths` (per-month budget snapshots) are
// refreshed whole on every pull by providers that expose them (YNAB); providers
// without the capability omit the keys.

// Atomic write: stage to a temp file, then rename over the target. A plain
// writeFileSync truncates the target *before* writing, so an interrupted pull
// (Ctrl-C, crash) would corrupt the whole cache. rename is atomic on the same
// filesystem, so the cache is either the old version or the new one — never half.
// On Windows, renaming over an existing target can transiently fail with EPERM
// if another reader has it open; one retry after a beat covers that.
// `path` is for tests; callers use the default cache location.
export function saveCache(data, path = CACHE_PATH) {
  const dir = resolve(path, '..');
  mkdirSync(dir, { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  const swap = () => renameSync(tmp, path);
  try {
    swap();
  } catch (err) {
    if (err.code !== 'EPERM') throw err;
    swap(); // one retry handles a transiently-held target
  }
}

export function loadData(opts = {}) {
  const path = opts.in ? resolve(process.cwd(), opts.in) : CACHE_PATH;
  if (!existsSync(path)) {
    throw new Error(
      opts.in
        ? `No such file: ${path}`
        : 'No transaction cache yet. Run: node bin/bukz.mjs pull  ' +
          '(or use demo data: --in fixtures/sample.json)'
    );
  }
  const data = JSON.parse(readFileSync(path, 'utf8'));
  let transactions = data.transactions ?? [];
  if (opts.since) transactions = transactions.filter((t) => t.date >= opts.since);
  if (opts.until) transactions = transactions.filter((t) => t.date <= opts.until);
  return { ...data, transactions };
}

// Does a usable cache exist? (false on missing OR corrupt/unparseable.)
export function existsCache() {
  try {
    loadData({});
    return true;
  } catch {
    return false;
  }
}

// Merge a changeset into an existing transaction list by key, deterministically.
// Used by incremental pulls: `existing` is the cache, `changes` is the delta.
//
// `deletedParentIds` is a set of base ids whose provider rows were deleted or
// restructured. YNAB's delta stream emits deleted transactions, and a split
// transaction's lines all share a prefix of the parent id (`<parentId>:<n>`),
// so a structural change must evict *all* rows under that parent before the
// replacement rows are inserted — otherwise stale split lines linger.
export function mergeTransactions(existing, changes, deletedParentIds = new Set()) {
  const byKey = new Map(existing.map((t) => [t.id, t]));
  // Evict any row whose id matches a deleted parent or is one of its split lines.
  if (deletedParentIds.size) {
    for (const id of [...byKey.keys()]) {
      const base = id.includes(':') ? id.slice(0, id.indexOf(':')) : id;
      if (deletedParentIds.has(base)) byKey.delete(id);
    }
  }
  for (const t of changes) byKey.set(t.id, t);
  return [...byKey.values()].sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)
  );
}

// Every analysis command leads its output with this so Claude can judge staleness.
export function meta(data, opts = {}) {
  return {
    provider: data.provider,
    pulledAt: data.pulledAt,
    since: opts.since ?? data.since ?? null,
    until: opts.until ?? null,
    transactionCount: data.transactions.length,
  };
}
