// Shared "is this row uncategorized?" predicate. Broader than `!category`:
// a blank name, the literal label "Uncategorized", or a missing category id
// all count. Transfers are not special-cased — callers that exclude them
// (the feed, anomalies, the uncategorized command) filter first or the
// predicate is applied only to non-transfers.
export function isUncategorized(txn) {
  if (!txn || typeof txn !== 'object') return false;
  const name = txn.category;
  const blankName = name == null || String(name).trim() === '';
  const labeled =
    typeof name === 'string' && name.trim().toLowerCase() === 'uncategorized';
  const id = txn.categoryId;
  const missingId = id == null || String(id).trim() === '';
  return blankName || labeled || missingId;
}
