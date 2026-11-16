// Balance drift alarm: a bookkeeping account's cleared balance vs the balance
// the issuer reports. Pure — no node:* imports.
//
// bukz has no bank/aggregator integration, so the issuer balance is an INPUT
// (flag or local file), never fetched here.
//
// Sign conventions: bukz/YNAB balances are signed (a credit card that owes
// money is negative). Issuers usually report "amount owed" as a positive
// number; pass convention "owed" for that and it is negated before comparing.

import { toCents, fromCents } from './money.mjs';

export function issuerSigned(balance, convention = 'signed') {
  if (typeof balance !== 'number' || !Number.isFinite(balance)) {
    throw new Error(`Issuer balance must be a finite number (got ${balance})`);
  }
  if (convention === 'owed') return -balance;
  if (convention === 'signed') return balance;
  throw new Error(`Unknown issuer balance convention "${convention}" (use "owed" or "signed")`);
}

// Returns { ledgerCleared, issuer, gap, threshold, alert, explained? }.
//   gap = ledgerCleared - issuer (negative = the ledger shows MORE owed/spent
//   than the issuer). alert when |gap| > threshold.
//   twinTotal (optional): sum of flagged imported-duplicate copies on the same
//   account; reported as how much of the gap they would explain if removed.
export function balanceDrift({ ledgerCleared, issuerBalance, convention = 'signed', threshold = 1, twinTotal = null }) {
  if (typeof ledgerCleared !== 'number' || !Number.isFinite(ledgerCleared)) {
    throw new Error('Ledger cleared balance is missing for this account (pull from YNAB first)');
  }
  if (!(typeof threshold === 'number' && threshold >= 0)) {
    throw new Error(`Threshold must be a number >= 0 (got ${threshold})`);
  }
  const issuerC = toCents(issuerSigned(issuerBalance, convention));
  const gapC = toCents(ledgerCleared) - issuerC;
  const result = {
    ledgerCleared: fromCents(toCents(ledgerCleared)),
    issuer: fromCents(issuerC),
    gap: fromCents(gapC),
    threshold: fromCents(toCents(threshold)),
    alert: Math.abs(gapC) > toCents(threshold),
  };
  if (twinTotal != null) {
    const residualC = gapC - toCents(twinTotal);
    result.explained = {
      byFlaggedTwins: fromCents(toCents(twinTotal)),
      residualAfterTwins: fromCents(residualC),
      residualAlert: Math.abs(residualC) > toCents(threshold),
    };
  }
  return result;
}
