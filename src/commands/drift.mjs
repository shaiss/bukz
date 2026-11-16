import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, out, num } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { resolveAccount, accountRows } from '../account-select.mjs';
import { loadAllowlist, parseDays } from '../ghosts-config.mjs';
import { findImportedTwins } from '../analysis/ghosts.mjs';
import { balanceDrift } from '../analysis/drift.mjs';

// READ-ONLY drift alarm: an account's cached cleared balance vs an issuer
// balance you supply (bukz has no bank integration — nothing is fetched).
//   --account <id|name|fragment>
//   --issuer-balance N  [--convention owed|signed]  (default signed)
//   or --issuer-file FILE  ({"balance": N, "convention": "owed", "asOf": "YYYY-MM-DD"})
//   --threshold N (default 1.00)  --fail-on-alert (exit 2 when alerting)
//   --days / --allowlist  tune the imported-duplicate total reported alongside
//   --text for human-readable output
export async function run(argv) {
  const opts = parse(argv, {
    account: { type: 'string' },
    'issuer-balance': { type: 'string' },
    'issuer-file': { type: 'string' },
    convention: { type: 'string' },
    threshold: { type: 'string' },
    'fail-on-alert': { type: 'boolean' },
    days: { type: 'string' },
    allowlist: { type: 'string' },
    text: { type: 'boolean' },
    json: { type: 'boolean' },
  });
  if (opts.text && opts.json) throw new Error('Pick one of --text or --json');
  if ((opts['issuer-balance'] === undefined) === (opts['issuer-file'] === undefined)) {
    throw new Error('Give exactly one of --issuer-balance N or --issuer-file FILE');
  }
  let issuer;
  if (opts['issuer-file']) {
    const f = JSON.parse(readFileSync(resolve(process.cwd(), opts['issuer-file']), 'utf8'));
    issuer = {
      balance: f.balance,
      convention: opts.convention ?? f.convention ?? 'signed',
      asOf: f.asOf ?? null,
      source: f.source ?? null,
      file: opts['issuer-file'],
    };
  } else {
    issuer = {
      balance: num(opts['issuer-balance']),
      convention: opts.convention ?? 'signed',
      asOf: null,
      source: null,
      file: null,
    };
  }

  const data = loadData(opts);
  const acct = resolveAccount(data, opts.account);
  if (!acct.account) {
    throw new Error(
      `No balance snapshot for "${acct.name}". Pull from a provider that exposes balances (YNAB), ` +
        'or try demo mode: --in fixtures/sample.json'
    );
  }
  const { minDays, maxDays } = parseDays(opts.days);
  const allow = loadAllowlist(opts.allowlist);
  const twins = findImportedTwins(accountRows(data.transactions, acct), {
    minDays,
    maxDays,
    allowlist: allow.entries,
  });
  const drift = balanceDrift({
    ledgerCleared: acct.account.clearedBalance,
    issuerBalance: issuer.balance,
    convention: issuer.convention,
    threshold: num(opts.threshold, 1),
    twinTotal: twins.summary.flaggedClearedTwinTotal,
  });
  if (drift.alert && opts['fail-on-alert']) process.exitCode = 2;

  if (opts.text) {
    const lines = [
      `Balance drift — ${acct.name}: ledger cleared ${drift.ledgerCleared.toFixed(2)} vs issuer ${drift.issuer.toFixed(2)}` +
        `${issuer.asOf ? ` (as of ${issuer.asOf})` : ''}`,
      `Gap ${drift.gap.toFixed(2)} — ${drift.alert ? `ALERT (over ${drift.threshold.toFixed(2)})` : 'within threshold'}`,
      `Flagged imported-duplicate copies: ${twins.summary.flaggedPairs}, cleared total ${drift.explained.byFlaggedTwins.toFixed(2)}; ` +
        `residual after removing them ${drift.explained.residualAfterTwins.toFixed(2)}` +
        `${drift.explained.residualAlert ? ' (still over threshold)' : ''}`,
    ];
    console.log(lines.join('\n'));
    return;
  }
  out({
    meta: meta(data, opts),
    query: {
      account: acct.name,
      accountId: acct.id,
      issuerInput: issuer.file ?? '--issuer-balance',
      issuerSource: issuer.source,
      issuerAsOf: issuer.asOf,
      convention: issuer.convention,
      days: `${minDays}-${maxDays}`,
      allowlistFile: allow.source,
    },
    drift,
    twins: twins.summary,
  });
}
