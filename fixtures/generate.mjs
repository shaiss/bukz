// Regenerates fixtures/sample.json — a deterministic demo dataset with planted
// bookkeeping issues. Each PLANT below has a matching assertion in
// tests/analysis.test.mjs; keep them in sync.
//
//   PLANT 1  Netflix, June miscategorized as Groceries      → mismatches
//   PLANT 2  Starbucks, one $250 charge                      → amountOutliers
//   PLANT 3  Iron Works Gym, double charge Jul 2 + Jul 3     → duplicates
//   PLANT 4  City Utilities, +$85 inflow among outflows      → signFlips
//   PLANT 5  Blue Bottle Water, biweekly stops in March      → missingRecurring
//   PLANT 6  Apex Consulting, brand-new payee at -$2,500     → newLargePayees
//   PLANT 7  Two uncategorized txns + one unapproved         → triage
//   PLANT 8  Staples: 4× Office Supplies + 1 uncategorized   → rules
//            (its uncategorized row raises triage's count to 3)
//   PLANT 9  Costco Wholesale: 3× Groceries vs 3× Dining Out → rules (ambiguous)
//
// Run: node fixtures/generate.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const transactions = [];
let n = 0;
const add = (date, payee, amount, category, extra = {}) =>
  transactions.push({
    id: `fx-${String(++n).padStart(3, '0')}`,
    date,
    amount,
    payee,
    category,
    categoryId: category,
    account: 'Demo Checking',
    memo: '',
    status: 'cleared',
    approved: true,
    transfer: false,
    provider: 'fixture',
    ...extra,
  });

const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

// Healthy monthly recurrences (control group — should NOT be flagged)
for (const m of months) add(`${m}-01`, 'Oakwood Property Mgmt', -1800, 'Rent');
for (const m of months) add(`${m}-05`, 'Amazon Web Services', -87.5, 'Software');

// PLANT 1 — Netflix: June landed in Groceries
for (const m of months.slice(0, 6)) {
  add(`${m}-15`, 'Netflix', -15.99, m === '2026-06' ? 'Groceries' : 'Subscriptions');
}

// PLANT 2 — Starbucks: normal coffee money, then one $250 charge
const starbucks = [
  ['2026-01-08', -5.75], ['2026-01-22', -6.25], ['2026-02-05', -4.95],
  ['2026-02-19', -5.75], ['2026-03-12', -6.5], ['2026-03-26', -5.25],
  ['2026-04-09', -7.1], ['2026-05-14', -5.75], ['2026-06-11', -6.25],
  ['2026-07-02', -5.5],
];
for (const [d, a] of starbucks) add(d, 'Starbucks', a, 'Dining Out');
add('2026-06-20', 'Starbucks', -250, 'Dining Out');

// Normal grocery variation (should NOT trip the outlier test)
const wholeFoods = [
  ['2026-01-14', -84.2], ['2026-02-02', -121.7], ['2026-02-25', -64.1],
  ['2026-03-18', -98.35], ['2026-04-21', -132.6], ['2026-05-16', -77.4],
  ['2026-06-13', -105.2], ['2026-07-03', -89.9],
];
for (const [d, a] of wholeFoods) add(d, 'Whole Foods Market', a, 'Groceries');

// PLANT 3 — gym membership charged twice in July
for (const m of months.slice(0, 6)) add(`${m}-03`, 'Iron Works Gym', -45, 'Health & Fitness');
add('2026-07-02', 'Iron Works Gym', -45, 'Health & Fitness');
add('2026-07-03', 'Iron Works Gym', -45, 'Health & Fitness');

// PLANT 4 — utilities refund among steady outflows
const utilities = [
  ['2026-01-20', -118.4], ['2026-02-20', -131.9], ['2026-03-20', -112.75],
  ['2026-04-20', -108.3], ['2026-05-20', -96.2], ['2026-06-20', -104.6],
  ['2026-07-05', -99.1],
];
for (const [d, a] of utilities) add(d, 'City Utilities', a, 'Utilities');
add('2026-06-25', 'City Utilities', 85, 'Utilities');

// Occasional rides (too irregular to be "recurring" — control group)
for (const [d, a] of [
  ['2026-02-11', -18.4], ['2026-03-30', -24.75], ['2026-05-09', -13.2], ['2026-06-27', -31.6],
]) add(d, 'Uber', a, 'Transport');

// PLANT 5 — biweekly water delivery that silently stopped
for (const d of ['2026-01-10', '2026-01-24', '2026-02-07', '2026-02-21', '2026-03-07', '2026-03-21']) {
  add(d, 'Blue Bottle Water Delivery', -30, 'Office Supplies');
}

// Client income (inflow control group)
for (const m of ['2026-05', '2026-06', '2026-07']) {
  add(`${m}-01`, 'Acme Corp', 5000, 'Inflow: Ready to Assign');
}

// PLANT 6 — brand-new payee, large amount
add('2026-06-28', 'Apex Consulting LLC', -2500, 'Professional Services');

// PLANT 7 — inbox work: uncategorized + unapproved
add('2026-07-02', 'Amazon', -63.12, null);
add('2026-06-30', 'Check #204', -400, null);
add('2026-07-04', 'Starbucks', -5.75, 'Dining Out', { approved: false });

// PLANT 8 — Staples: consistent payee whose latest row is uncategorized.
// Amounts stay in a smooth band (no robust-Z outlier) and dates are irregular
// (gap MAD > 3) so no anomaly detector trips; mismatches skips it (share = 1.0).
add('2026-02-09', 'Staples', -45.6, 'Office Supplies');
add('2026-02-27', 'Staples', -67.89, 'Office Supplies');
add('2026-04-14', 'Staples', -89.99, 'Office Supplies');
add('2026-05-19', 'Staples', -112.4, 'Office Supplies');
add('2026-06-18', 'Staples', -76.4, null);

// PLANT 9 — Costco: evenly split between two categories → ambiguous, no rule.
add('2026-01-17', 'Costco Wholesale', -35.4, 'Groceries');
add('2026-03-05', 'Costco Wholesale', -58.2, 'Groceries');
add('2026-04-22', 'Costco Wholesale', -72.6, 'Groceries');
add('2026-05-08', 'Costco Wholesale', -88.1, 'Dining Out');
add('2026-06-13', 'Costco Wholesale', -101.3, 'Dining Out');
add('2026-07-01', 'Costco Wholesale', -114.9, 'Dining Out');

transactions.sort((a, b) => a.date.localeCompare(b.date));

const categories = [
  { id: 'Rent', name: 'Rent', group: 'Fixed Costs' },
  { id: 'Utilities', name: 'Utilities', group: 'Fixed Costs' },
  { id: 'Software', name: 'Software', group: 'Business' },
  { id: 'Professional Services', name: 'Professional Services', group: 'Business' },
  { id: 'Office Supplies', name: 'Office Supplies', group: 'Business' },
  { id: 'Groceries', name: 'Groceries', group: 'Everyday' },
  { id: 'Dining Out', name: 'Dining Out', group: 'Everyday' },
  { id: 'Transport', name: 'Transport', group: 'Everyday' },
  { id: 'Health & Fitness', name: 'Health & Fitness', group: 'Everyday' },
  { id: 'Subscriptions', name: 'Subscriptions', group: 'Everyday' },
  { id: 'Inflow: Ready to Assign', name: 'Inflow: Ready to Assign', group: 'Income' },
];

const fixture = {
  pulledAt: '2026-07-05T12:00:00.000Z', // fixed so the fixture is byte-stable
  provider: 'fixture',
  since: '2026-01-01',
  categories,
  transactions,
};

const path = resolve(dirname(fileURLToPath(import.meta.url)), 'sample.json');
writeFileSync(path, JSON.stringify(fixture, null, 2));
console.log(`Wrote ${transactions.length} transactions to ${path}`);
