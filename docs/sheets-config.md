# Google Sheets hub → local `config/` (read-path)

bukz can pull curated bookkeeping tabs from a hub Google Spreadsheet into the
machine-local (gitignored) files under `config/`:

| Tab (default name) | Local file | Purpose |
|---|---|---|
| `Bills` | `config/bills.json` | Recurring bills registry (`outlook`) |
| `Rules` | `config/rules.json` | Curated payee→category expectations (`rule-check`) |

This is the **read** path only. The sheet remains the human review/edit surface;
bukz does not write back to Sheets in this slice.

**Local config stays preferred.** `sync-config` is a hydrate step that writes
`config/*.json`. `outlook`, `rule-check`, and friends keep calling `loadConfig`
and never hit Sheets at runtime. If a local file already exists, sync updates it;
commands do not require a live Sheet connection.

## Auth (machine-to-machine) — CLI flags preferred

Same spirit as Xero's Custom Connection — no browser OAuth dance.

1. In Google Cloud Console, create a service account and download its JSON key.
2. Enable the **Google Sheets API** for that GCP project.
3. Share the hub spreadsheet with the service account's `client_email` as **Viewer**.
4. Run sync with **CLI flags** (no `.env` edit required — skills must not touch `.env`):

```sh
node bin/bukz.mjs sync-config \
  --service-account /path/to/sa.json \
  --spreadsheet-id theSpreadsheetIdFromTheUrl
# Optional tab renames:
#   --bills-tab Bills --rules-tab Rules
```

Optional env fallbacks (handy for a personal laptop; never required for the happy path):

```sh
# .env — never commit; never paste into chat; skills must not read or rewrite this
GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/sa.json
GOOGLE_SHEETS_SPREADSHEET_ID=theSpreadsheetIdFromTheUrl
# GOOGLE_SHEETS_BILLS_TAB=Bills
# GOOGLE_SHEETS_RULES_TAB=Rules
```

`sync-config` / `sheets/*` never open or rewrite `.env`. `node bin/bukz.mjs check`
reports booleans for whether Sheets env vars are set — never secret values.

## Column layouts

Bills schema shape matches `config/bills.example.json` (and any local draft
`config/bills.json` you keep gitignored as a personal reference — **do not commit
personal bills**).

### Bills tab

Header row (order flexible; names matched case-insensitively):

`name | amount | cadence | dayOfMonth | month | anchor | paidFrom | autopay | active | notes`

Empty `amount` → `null`. `active` accepts `true`/`yes`/`1` or `false`/`no`/`0`
(default true).

### Rules tab

`payee | category | active | notes`

- **payee** — exact string match against transaction `payee` (no fuzzy variants yet;
  `payeePattern` is accepted as an alternate header name for the same column).
- **category** — expected category name (`rule-check` only flags; it does not invent categories).
- **active** — inactive rows are ignored by `rule-check`.
- **notes** — optional free text.

See also `config/rules.example.json`.

## Commands

```sh
# Live hydrate via CLI flags (no .env required)
node bin/bukz.mjs sync-config --service-account ./sa.json --spreadsheet-id <id>

# Demo / offline / CI — no credentials; does not alter fixtures/sample.json
node bin/bukz.mjs sync-config --from fixtures/sheets-hub.json

# Check cache (or demo fixture) against curated rules
node bin/bukz.mjs rule-check --in fixtures/sample.json --rules fixtures/rules.json
node bin/bukz.mjs rule-check --violations-only   # after sync-config wrote config/rules.json
```

`sync-config` writes atomically (temp + rename), same as `pull`.
`rule-check` emits JSON leads: `violations`, `uncategorized`, and (unless
`--violations-only`) correct `matches`. Every finding includes `account`.
