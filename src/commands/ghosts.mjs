import { parse, out } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { resolveAccount, accountRows } from '../account-select.mjs';
import { loadAllowlist, parseDays } from '../ghosts-config.mjs';
import { findImportedTwins, formatTwinsText } from '../analysis/ghosts.mjs';

// READ-ONLY. Flags later-dated imported copies of earlier imported rows on one
// account (same amount + same original payee, 1–5 days apart, two distinct
// YNAB linked-import ids). Leads for a human; never edits the books.
//   --account <id|name|fragment>  --days N|MIN-MAX (default 1-5)
//   --allowlist FILE (default config/ghosts.json if present)
//   --text for human-readable output (default: JSON, like every command)
export async function run(argv) {
  const opts = parse(argv, {
    account: { type: 'string' },
    days: { type: 'string' },
    allowlist: { type: 'string' },
    text: { type: 'boolean' },
    json: { type: 'boolean' },
  });
  if (opts.text && opts.json) throw new Error('Pick one of --text or --json');
  const data = loadData(opts);
  const acct = resolveAccount(data, opts.account);
  const { minDays, maxDays } = parseDays(opts.days);
  const allow = loadAllowlist(opts.allowlist);
  const rows = accountRows(data.transactions, acct);
  const result = findImportedTwins(rows, { minDays, maxDays, allowlist: allow.entries });

  if (opts.text) {
    let text = formatTwinsText(result, { account: acct.name });
    if (rows.length && result.summary.rowsWithoutImportId === rows.length) {
      text += '\nNo rows carry import ids yet — run `node bin/bukz.mjs pull --full` once to backfill them.';
    }
    console.log(text);
    return;
  }
  out({
    meta: meta(data, opts),
    query: {
      account: acct.name,
      accountId: acct.id,
      days: `${minDays}-${maxDays}`,
      allowlistFile: allow.source,
      allowlistEntries: allow.entries.length,
      accountRows: rows.length,
    },
    ...result,
  });
}
