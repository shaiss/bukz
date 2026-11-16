// Resolve an --account selector against the cache. Accepts an account id, an
// exact account name, or a fragment of the name (e.g. a card's last four
// digits when the account name includes them). Ambiguous selectors fail loudly
// rather than silently mixing accounts.
export function resolveAccount(data, selector) {
  if (!selector || !String(selector).trim()) throw new Error('--account is required (id, name, or name fragment)');
  const sel = String(selector).trim();
  const lc = sel.toLowerCase();
  const accounts = (data.accounts ?? []).filter((a) => !a.closed || a.id === sel);
  const pick = (list) => {
    if (list.length === 1) return list[0];
    if (list.length > 1) {
      throw new Error(`--account "${sel}" is ambiguous: ${list.map((a) => a.name).join(', ')}`);
    }
    return null;
  };
  const found =
    pick(accounts.filter((a) => a.id === sel)) ??
    pick(accounts.filter((a) => String(a.name).toLowerCase() === lc)) ??
    pick(accounts.filter((a) => String(a.name).toLowerCase().includes(lc)));
  if (found) return { id: found.id, name: found.name, account: found };

  // No balance snapshot (or no match there): fall back to transaction account names.
  const names = [...new Set(data.transactions.map((t) => t.account).filter(Boolean))];
  const byName = names.filter((n) => n.toLowerCase() === lc);
  const byFrag = byName.length ? byName : names.filter((n) => n.toLowerCase().includes(lc));
  if (byFrag.length > 1) throw new Error(`--account "${sel}" is ambiguous: ${byFrag.join(', ')}`);
  if (byFrag.length === 1) return { id: null, name: byFrag[0], account: null };
  throw new Error(`No account matches --account "${sel}"`);
}

// Rows belonging to a resolved account (id when the row carries one, else name).
export function accountRows(transactions, resolved) {
  return transactions.filter((t) =>
    resolved.id && t.accountId ? t.accountId === resolved.id : t.account === resolved.name
  );
}
