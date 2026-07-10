---
name: bukz-setup
description: Use when the user is setting up bukz for the first time, connecting YNAB or Xero, configuring API keys, or when bukz commands fail with missing-credential errors.
---

# bukz setup (first run)

Goal: get from fresh clone to a working `pull` **without the user's API token ever entering this chat**.

## Steps

1. **Check current state:** `node bin/bukz.mjs check` — it prints booleans only, never values.
2. **If keys are missing**, tell the user to copy `.env.example` to `.env` and fill it in using **their own editor** (VS Code, Notepad, anything — not this chat):
   - **YNAB:** app.ynab.com → Account Settings → Developer Settings → New Personal Access Token → paste into `YNAB_ACCESS_TOKEN`.
   - **Xero:** developer.xero.com → My Apps → New app → **Custom Connection**, grant scopes `accounting.transactions.read accounting.settings.read accounting.contacts.read` → paste client id/secret into `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`.
   - NEVER ask the user to paste a token into the chat. If they paste one anyway, tell them to revoke it and generate a fresh one — anything that enters a chat should be considered exposed.
3. **Re-run check.** If the user has multiple YNAB budgets, run `node bin/bukz.mjs budgets` and help them pick; they set `YNAB_BUDGET_ID` in `.env` themselves (budget *ids* are fine to discuss — they are not secrets).
4. **First pull:** `node bin/bukz.mjs pull` (fetches the last 365 days; scope with `--since YYYY-MM-DD`). Report the summary it prints.
5. **Introduce the team** and offer a first task:
   - `spot-check` — audit a sample of categorizations
   - `anomalies` — duplicates, outliers, missing recurring payments
   - `mismatches` — payees drifting out of their usual category
   - `triage` — categorize the uncategorized
   - `receipts` — extract + match receipt images
   - `close-review` — run everything as a month-end close

## No keys yet?

Everything works on demo data: append `--in fixtures/sample.json` to any analysis command and offer a tour.
