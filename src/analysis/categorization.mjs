// Shared "is this row uncategorized?" predicate. Broader than `!category`:
// a blank name, the literal label "Uncategorized", or a missing category id
// all count — YNAB often lands inbox rows with a truthy name and null id.
// Keep this the single definition; feed, anomalies, uncategorized, rules,
// curated-rules, mismatches, and spot-check sampling share it. Transfers are
// not special-cased — callers that exclude them filter first.
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
