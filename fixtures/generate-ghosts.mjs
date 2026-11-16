// Regenerates fixtures/ghosts.json (+ ghosts-issuer.json) — a SYNTHETIC demo
// for `ghosts` and `drift`. Every payee, id, and amount is invented. Each
// PLANT has a matching assertion in tests/ghosts.test.mjs.
//
//   G1  Example Theme Park -500.00, copy +2 days (YNAB renamed the payee on
//       one row; the bank's original payee still matches)      → flagged
//   G2  Example Ticketing -20.00 ×3 on one day, ×3 copies +2 days
//       (occurrence counters 1..3)                              → 3 flagged pairs
//   G3  Example Ride -2.00 twice, 2 days apart                  → allowlisted
//       (fixtures/ghosts-allowlist.json: maxAbsAmount 3)
//   G4  Example Streaming Service -9.99 monthly                 → not paired
//   G5  Manual row (no import id) + imported row, same charge   → not flagged
//   G6  Example Hardware -75.00, copy +7 days                   → outside 1-5
//   G7  Same G1-shaped pair on Demo Checking                    → separate
//       account; never mixed into Demo Card
//   G8  Transfer pair                                           → skipped
//   Balances: Demo Card cleared = sum of its rows; issuer owed (ghosts-issuer
//   .json) excludes the G1+G2 copies, so drift's gap == the flagged total and
//   the residual is 0.
//
// Run: node fixtures/generate-ghosts.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const transactions = [];
let n = 0;
const occ = new Map();
const add = (date, payee, amount, extra = {}) => {
  const account = extra.account ?? 'Demo Card';
  const accountId = account === 'Demo Card' ? 'acc-card' : 'acc-chk';
  const mu = Math.round(amount * 1000);
  const key = `${accountId}:${mu}:${date}`;
  occ.set(key, (occ.get(key) ?? 0) + 1);
  transactions.push({
    id: `gx-${String(++n).padStart(3, '0')}`,
    date,
    amount,
    payee: extra.payee ?? payee,
    category: 'Demo',
    categoryId: 'Demo',
    account,
    memo: '',
    status: 'cleared',
    approved: true,
    transfer: false,
    provider: 'fixture',
    accountId,
    importId: extra.manual ? null : `YNAB:${mu}:${date}:${occ.get(key)}`,
    importPayeeNameOriginal: extra.manual ? null : payee,
    ...(extra.transfer ? { transfer: true } : {}),
  });
};

// G4 — monthly recurrence (control)
for (const m of ['2026-01', '2026-02', '2026-03']) add(`${m}-05`, 'Example Streaming Service', -9.99);
// G1 — original renamed in the ledger, copy 2 days later
add('2026-03-10', 'Example Theme Park', -500, { payee: 'Theme Park (renamed)' });
add('2026-03-12', 'Example Theme Park', -500);
// G2 — three same-day charges, three copies
for (let i = 0; i < 3; i++) add('2026-03-14', 'Example Ticketing', -20);
for (let i = 0; i < 3; i++) add('2026-03-16', 'Example Ticketing', -20);
// G3 — real short rides (allowlisted)
add('2026-03-11', 'Example Ride', -2);
add('2026-03-13', 'Example Ride', -2);
// G5 — manual entry, then the import
add('2026-03-18', 'Example Bakery', -12.5, { manual: true });
add('2026-03-20', 'Example Bakery', -12.5);
// G6 — 7 days apart
add('2026-03-01', 'Example Hardware', -75);
add('2026-03-08', 'Example Hardware', -75);
// G7 — other account
add('2026-03-10', 'Example Theme Park', -500, { account: 'Demo Checking' });
add('2026-03-12', 'Example Theme Park', -500, { account: 'Demo Checking' });
// G8 — transfer pair
add('2026-03-21', 'Transfer : Demo Checking', 100, { transfer: true });
add('2026-03-23', 'Transfer : Demo Checking', 100, { transfer: true });

const cents = (a) => Math.round(a * 100);
const sum = (rows) => rows.reduce((s, t) => s + cents(t.amount), 0) / 100;
const card = transactions.filter((t) => t.account === 'Demo Card');
const chk = transactions.filter((t) => t.account === 'Demo Checking');
const ghostCopies = ['gx-005', 'gx-009', 'gx-010', 'gx-011']; // G1 + G2 copies
const cardCleared = sum(card);
const owed = -(cardCleared - sum(card.filter((t) => ghostCopies.includes(t.id))));

const fixture = {
  pulledAt: '2026-03-24T12:00:00.000Z',
  provider: 'fixture',
  since: '2026-01-01',
  categories: [{ id: 'Demo', name: 'Demo', group: 'Demo' }],
  accounts: [
    { id: 'acc-card', name: 'Demo Card', type: 'creditCard', onBudget: true, closed: false, balance: cardCleared, clearedBalance: cardCleared, unclearedBalance: 0 },
    { id: 'acc-chk', name: 'Demo Checking', type: 'checking', onBudget: true, closed: false, balance: sum(chk), clearedBalance: sum(chk), unclearedBalance: 0 },
  ],
  transactions,
};

const dir = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(dir, 'ghosts.json'), JSON.stringify(fixture, null, 2) + '\n');
writeFileSync(
  resolve(dir, 'ghosts-issuer.json'),
  JSON.stringify({ balance: +owed.toFixed(2), convention: 'owed', asOf: '2026-03-24', source: 'synthetic demo' }, null, 2) + '\n'
);
writeFileSync(
  resolve(dir, 'ghosts-allowlist.json'),
  JSON.stringify([{ payeePattern: '^example ride', maxAbsAmount: 3, note: 'synthetic: short rides repeat for real' }], null, 2) + '\n'
);
console.log(`Wrote ${transactions.length} synthetic transactions; Demo Card cleared ${cardCleared}, issuer owed ${owed}`);
