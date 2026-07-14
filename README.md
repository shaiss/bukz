# bukz — the AI bookkeeper's team

bukz turns [Claude Code](https://claude.com/claude-code) into a team of AI assistants for professional bookkeepers. It doesn't replace the bookkeeper — it does the tedious sweeps (category audits, anomaly hunts, receipt matching) so the human can spend their time on judgment and client work.

Works with **YNAB** and **Xero** out of the box. Zero dependencies — if you have Node 18+ and Claude Code, `git clone` is the whole install.

## Quickstart

```sh
git clone <this repo> && cd bukz
cp .env.example .env     # then add your API keys IN YOUR EDITOR — never in a chat
claude
```

Then just talk to it:

> "set up bukz" · "spot check my categories" · "does anything look off in June?" · "I have receipts to log"

**No keys yet?** Ask for a demo — every check runs against `fixtures/sample.json`, a sample budget with planted bookkeeping errors.

## The team

| Skill | What it does |
|---|---|
| `bukz-setup` | First-run onboarding: keys, budget selection, first pull |
| `spot-check` | Samples transactions per category, reviews payee/category fit |
| `anomalies` | Duplicate charges, amount outliers, refund/sign flips, recurring payments that stopped, suspicious new payees |
| `mismatches` | Payees drifting out of their usual category |
| `triage` | Proposes categories for the uncategorized, reviews the unapproved |
| `receipts` | Extracts receipt images/PDFs → ledger CSV, matches them to transactions, flags receipts missing from the books |
| `close-review` | Runs everything, synthesizes one month-end report with an action checklist |

Under the hood each skill drives a deterministic CLI (`node bin/bukz.mjs help`) and applies bookkeeper judgment to its JSON output. Numbers come from code; opinions come from the model; fixes come from **you** — bukz is strictly read-only against your books.

## Your keys never meet the model

- Keys live in `.env`, which is **gitignored** and **permission-denied** to Claude in `.claude/settings.json`.
- Every skill is instructed never to read `.env` and never to ask you for a token in chat.
- `node bin/bukz.mjs check` diagnoses config by printing booleans only.
- Getting keys: **YNAB** — app.ynab.com → Account Settings → Developer Settings → Personal Access Token. **Xero** — developer.xero.com → New app → *Custom Connection* with the three `*.read` accounting scopes.

Honest caveat: no local setup can make secrets provably invisible to a tool that can execute code on your machine. These layers make access denied-by-default and auditable — and the code never prints secret values. Use read-only tokens where offered, and rotate anything you suspect was exposed.

## What's on the roadmap

- ~~Write-back (apply approved category fixes via the YNAB API)~~ — shipped: `recategorize` (dry-run by default, `--yes` to apply)
- Xero invoices/bills (ACCPAY/ACCREC), QuickBooks provider
- Rules engine ("payee X is always category Y") the AI can propose additions to
- Packaging as an installable Claude Code plugin

## License

MIT
