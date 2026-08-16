---
name: rules
description: Use when the user wants a payee→category cheat sheet, auto-categorization rules, or to fix uncategorized transactions using each payee's usual category.
---

# Payee→category rules

Mines the books for the mapping a bookkeeper keeps in their head: "Staples is always
Office Supplies." Each rule carries its supporting history, its exceptions, and the
uncategorized rows it would fix. YNAB's own rules engine is not API-writable, so this
command produces the mapping — applying it, past or future, stays human-confirmed.

## Steps

1. **Get data:** see `_shared/data-prep.md` (fresh pull, or `--in fixtures/sample.json` for demo).
2. **Scan:** `node bin/bukz.mjs rules` (tune: `--min-support 3 --min-confidence 0.8`, scope with `--since`).
3. **Judge before presenting** — a rule is only as good as its history:
   - Read `exceptions` first: a rule whose history contains mislabeled rows propagates
     the error (see the mismatches skill). Netflix → "Subscriptions" with one stray
     "Groceries" row is a clean rule *and* a fixable exception.
   - `ambiguous` payees (no dominant category — think Costco, Amazon) are split-decision
     questions: ask the user whether they need multiple rules, more consistent
     categorization, or split transactions. Do not force a rule.
   - Payees in `summary.belowMinSupport` have too little history to generalize from —
     don't propose rules for them.
4. **Report** rules as a handoff table:

   | Payee | Category | Confidence (support) | Exceptions | Uncategorized rows to fix | Last seen |

   Surface `account` on any per-transaction row you list.
5. **Offer both applications, each human-confirmed:**
   - **Fix history:** for a rule's `uncategorized` rows, run
     `recategorize --txn <id> --category "<rule category>"` per row (dry-run first),
     then apply with `--yes` only on the user's explicit OK — show every planned edit;
     never a silent bulk write.
   - **Set future rules:** YNAB's payee default categories can only be entered in the
     YNAB web app, not via the API. Hand the table to the user's bookkeeper, or — with
     the user's OK — hand this command's JSON to a browser-capable agent to enter them.

## Rules

- Never apply a rule wholesale on the strength of the confidence number — every write
  goes through the confirm-then-apply flow, and a rule's exceptions are judged before
  its uncategorized rows are "fixed" to the dominant category.
