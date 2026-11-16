# Imported-duplicate checks: `ghosts` and `drift`

Both commands are **read-only**. They read the local cache (or `--in FILE`),
never call a provider, and never edit the books. Output is a lead for a human,
not a verdict.

## The pattern

A linked bank feed sometimes reports one charge twice, a few days apart (for
example once near the authorization date and again near the posting date).
YNAB builds a linked import's id from amount, date and occurrence
(`YNAB:<milliunits>:<YYYY-MM-DD>:<n>`), so two dates give two distinct import
ids and YNAB's own de-dupe never fires. Its matcher only pairs an import with a
manually-entered row, never two imports, so both rows land in the register and
the account balance drifts from what the issuer says is owed.

## `ghosts`

```sh
node bin/bukz.mjs ghosts --account <id|name|fragment> [--days 1-5] [--allowlist FILE] [--text]
node bin/bukz.mjs ghosts --in fixtures/ghosts.json --account "Demo Card" \
  --allowlist fixtures/ghosts-allowlist.json --text           # synthetic demo
```

Flags pairs on one account with the same amount and the same original bank
payee (`importPayeeNameOriginal`, falling back to `payee`), 1–5 days apart,
where both rows carry a YNAB linked-import id and the ids' date segments differ.
Pairing is one-to-one per (account, amount, payee) group, so three identical
charges plus three copies give three pairs. Transfers and rows without a linked
import id (manual, API or file imports) are skipped and counted.

Default output is JSON (`meta`, `query`, `flagged`, `allowlisted`, `summary`)
like every bukz command; `--text` prints a short human-readable list suitable
for a triage queue.

**Backfill:** `importId`, `importPayeeNameOriginal` and `accountId` are new on
the cached transaction shape. Rows cached before this change lack them until a
`node bin/bukz.mjs pull --full` refreshes the cache (incremental pulls only
return changed rows).

### Allowlist

Real repeats look the same as ghosts: a recurring charge, short transit fares,
same-size crypto buys. Suppress known-real shapes with a JSON array in
`config/ghosts.json` (gitignored; template `config/ghosts.example.json`) or
`--allowlist FILE`. Each entry may set:

| field | match |
|---|---|
| `payee` | case-insensitive exact original payee |
| `payeePattern` | case-insensitive regex on the original payee |
| `amount` | exact signed amount |
| `maxAbsAmount` | `abs(amount) <= value` |
| `account` | account name, case-insensitive exact |
| `note` | free text, echoed in the output |

An entry matches when every field it sets matches, and both rows of a pair must
match the same entry. An entry with no matcher fields matches nothing.
Allowlisted pairs are still listed under `allowlisted` for transparency.

## `drift`

```sh
node bin/bukz.mjs drift --account <id|name|fragment> \
  (--issuer-balance=N [--convention owed|signed] | --issuer-file FILE) \
  [--threshold 1.00] [--fail-on-alert] [--days ...] [--allowlist ...] [--text]
node bin/bukz.mjs drift --in fixtures/ghosts.json --account "Demo Card" \
  --issuer-file fixtures/ghosts-issuer.json --allowlist fixtures/ghosts-allowlist.json --text
```

Compares the account's cached **cleared** balance with an issuer balance you
supply. bukz has no bank/aggregator integration; the issuer number is an
input. Issuers usually report a card's balance as a positive amount owed — use
`--convention owed` (or `"convention": "owed"` in the file) and it is negated
before comparing; `signed` (the default) means the number already uses the
ledger's sign. Issuer file shape:

```json
{ "balance": 123.45, "convention": "owed", "asOf": "YYYY-MM-DD", "source": "free text" }
```

`gap = ledgerCleared - issuer`; `alert` is true when `|gap| > threshold`. The
output also reports the total of the flagged `ghosts` copies on the same
account and the residual gap if they were removed. `--fail-on-alert` exits 2
when alerting, for routines. Negative numbers on the command line need the
`=` form: `--issuer-balance=-123.45`.
