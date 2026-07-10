// Pure logic for the recategorize command. Kept separate from the command
// wrapper (and the YNAB HTTP call) so it can be unit-tested without a live API.
// The command layer composes these with provider.recategorize() on --yes.

// Resolve a category NAME to a provider id via the cached category list.
// Refuses invented names (mirrors the triage skill's rule) and surfaces
// ambiguity (two categories with the same name in different groups).
export function resolveCategory(categories, name) {
  const matches = categories.filter((c) => c.name === name);
  if (!matches.length) {
    throw new Error(
      `No category named "${name}". List real names with: node bin/bukz.mjs categories`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Category "${name}" is ambiguous — it appears in groups: ` +
      matches.map((c) => c.group).join(', ') +
      '. Specify by editing in YNAB (category ids are not accepted from chat).'
    );
  }
  return matches[0];
}

// Find a transaction by id in the cache. Returns { txn, isSplit }.
// A split id is detected the YNAB way: the normalized id carries the
// subtransaction id, but multiple cached rows share the same parent
// transaction. We mark a target as split if *any* other cached row shares its
// parent prefix — because recategorizing one line of a split is unsupported by
// YNAB's update endpoint, and the parent itself has no single category.
export function findTransaction(transactions, id) {
  const txn = transactions.find((t) => t.id === id);
  if (!txn) {
    throw new Error(
      `Transaction "${id}" not found in the cache. It may belong to a window ` +
      'outside the last pull — run: node bin/bukz.mjs pull'
    );
  }
  return { txn, isSplit: isSplitLine(transactions, txn) };
}

// A YNAB split normalizes to rows whose ids share a "<parentId>:<n>" shape. If
// the target's id contains a colon, OR other rows share its id prefix, it's a
// split line that can't be recategorized in isolation.
export function isSplitLine(transactions, txn) {
  if (txn.id.includes(':')) return true;
  const base = txn.id;
  return transactions.some((t) => t.id !== txn.id && t.id.startsWith(base + ':'));
}

// Build the planned change object shown in dry-run output and applied reports.
// Same shape either way so skills can present it uniformly.
export function planChange(txn, fromCategory, toCategory) {
  return {
    txnId: txn.id,
    date: txn.date,
    payee: txn.payee,
    account: txn.account,
    amount: txn.amount,
    from: fromCategory,
    to: toCategory.name,
    toCategoryId: toCategory.id,
  };
}
