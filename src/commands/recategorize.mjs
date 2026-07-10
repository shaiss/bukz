import { parse, out } from '../cli.mjs';
import { loadData, saveCache, mergeTransactions } from '../data.mjs';
import { getProvider } from '../providers/index.mjs';
import { resolveCategory, findTransaction, planChange } from '../analysis/recategorize.mjs';

// Recategorize a single transaction. DRY-RUN BY DEFAULT: prints the planned
// change and exits without mutating YNAB. Pass --yes (or --apply) to execute.
// Split transactions are refused (YNAB's update endpoint can't restructure
// splits); category must exist in the cached list (no invented names).
export async function run(argv) {
  const opts = parse(argv, {
    txn: { type: 'string' },
    category: { type: 'string' },
    yes: { type: 'boolean' },
    apply: { type: 'boolean' },
  });

  if (!opts.txn) throw new Error('--txn <id> is required (find ids with: node bin/bukz.mjs uncategorized)');
  if (!opts.category) throw new Error('--category "<name>" is required (list names with: node bin/bukz.mjs categories)');

  const provider = getProvider(opts.provider);
  if (provider.name !== 'ynab') {
    throw new Error(
      `recategorize is YNAB-only for now (you're on "${provider.name}"). ` +
      'Xero write-back is on the roadmap — its read-only scopes need re-issuing first.'
    );
  }

  // Load the cache. --in points at a file (used for demo/testing on fixtures);
  // without it we read the real cache at data/transactions.json.
  const cache = loadData({ in: opts.in });
  const target = resolveCategory(cache.categories ?? [], opts.category);
  const { txn, isSplit } = findTransaction(cache.transactions, opts.txn);

  if (isSplit) {
    out({
      meta: { provider: provider.name, pulledAt: cache.pulledAt },
      applied: false,
      status: 'skipped',
      reason: 'YNAB cannot recategorize one line of a split via the API — fix this split in YNAB directly.',
      txn: { id: txn.id, date: txn.date, payee: txn.payee, account: txn.account, amount: txn.amount },
      from: txn.category,
      to: target.name,
    });
    return;
  }

  const change = planChange(txn, txn.category, target);
  const apply = opts.yes || opts.apply;

  if (!apply) {
    out({
      meta: { provider: provider.name, pulledAt: cache.pulledAt },
      applied: false,
      status: 'dry-run',
      change,
      hint: 'Re-run with --yes (or --apply) to write this change to YNAB.',
    });
    return;
  }

  // Execute the write.
  const result = await provider.recategorize({ id: txn.id, categoryId: target.id });

  // Refresh the LOCAL cache only when we were reading from it (not --in, which
  // points at an arbitrary file we must not overwrite). Merge the returned
  // transaction over the old row; bump the cursor if YNAB gave new knowledge.
  if (!opts.in) {
    const updated = mergeTransactions(cache.transactions, [result.transaction].flat());
    saveCache({ ...cache, pulledAt: new Date().toISOString(), cursor: result.serverKnowledge ?? cache.cursor, transactions: updated });
  }

  out({
    meta: { provider: provider.name, pulledAt: cache.pulledAt },
    applied: true,
    status: 'done',
    change,
    serverKnowledge: result.serverKnowledge,
  });
}
