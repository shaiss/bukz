# Google Sheets hub → local `config/` (read-path)

bukz can pull curated bookkeeping tabs from a hub Google Spreadsheet into the
machine-local (gitignored) files under `config/`:

| Tab (default name) | Local file | Purpose |
|---|---|---|
| `Bills` | `config/bills.json` | Recurring bills registry (`outlook`) |
| `Rules` | `config/rules.json` | Curated payee→category expectations (`rule-check`) |

This is the **read** path only. The sheet remains the human review/edit surface;
bukz does not write back to Sheets in this slice.

## Auth (machine-to-machine)

Same spirit as Xero's Custom Connection — no browser OAuth dance on the
bookkeeper's laptop.

1. In Google Cloud Console, create a service account and download its JSON key.
2. Enable the **Google Sheets API** for that GCP project.
3. Share the hub spreadsheet with the service account's `client_email` as **Viewer**.
4. Put the key file somewhere on this machine (outside the repo is fine) and set:

```sh
# .env — never commit; never paste into chat
GOOGLE_SERVICE_ACCOUNT_FILE=/absolute/or/repo-relative/path/to/sa.json
GOOGLE_SHEETS_SPREADSHEET_ID=theSpreadsheetIdFromTheUrl
# Optional tab renames (defaults shown):
# GOOGLE_SHEETS_BILLS_TAB=Bills
# GOOGLE_SHEETS_RULES_TAB=Rules
```

`node bin/bukz.mjs check` reports booleans for whether those env vars are set,
and optionally whether a 1-cell Sheets read succeeds — never secret values.

## Column layouts

### Bills tab

Header row (order flexible; names matched case-insensitively):

`name | amount | cadence | dayOfMonth | month | anchor | paidFrom | autopay | active | notes`

Field meanings match `config/bills.example.json`. Empty `amount` → `null`.
`active` accepts `true`/`yes`/`1` or `false`/`no`/`0` (default true).

### Rules tab

`payee | category | active | notes`

- **payee** — exact string match against transaction `payee` (no fuzzy variants yet;
  `payeePattern` is accepted as an alternate header name for the same column).
- **category** — expected category name (must already exist in the books when you
  later fix a row; `rule-check` only flags).
- **active** — inactive rows are ignored by `rule-check`.
- **notes** — optional free text.

See also `config/rules.example.json`.

## Commands

```sh
# Live pull (needs Sheets env vars)
node bin/bukz.mjs sync-config

# Demo / offline / CI — no credentials
node bin/bukz.mjs sync-config --from fixtures/sheets-hub.json

# Check cache (or demo fixture) against curated rules
node bin/bukz.mjs rule-check --in fixtures/sample.json --rules fixtures/rules.json
node bin/bukz.mjs rule-check --violations-only   # after sync-config wrote config/rules.json
```

`sync-config` writes atomically (temp + rename), same as `pull`.
`rule-check` emits JSON leads: `violations`, `uncategorized`, and (unless
`--violations-only`) correct `matches`. Every finding includes `account`.
