// Regenerates fixtures/sample.json — a deterministic demo dataset with planted
// bookkeeping issues. Each PLANT below has a matching assertion — PLANTs 1–9 in
// tests/analysis.test.mjs, PLANTs 10–12 in tests/reporting.test.mjs; keep them
// in sync.
//
//   PLANT 1  Netflix, June miscategorized as Groceries      → mismatches
//   PLANT 2  Starbucks, one $250 charge                      → amountOutliers
//   PLANT 3  Iron Works Gym, double charge Jul 2 + Jul 3     → duplicates
//   PLANT 4  City Utilities, +$85 inflow among outflows      → signFlips
//   PLANT 5  Blue Bottle Water, biweekly stops in March      → missingRecurring
//   PLANT 6  Apex Consulting, brand-new payee at -$2,500     → newLargePayees
//   PLANT 7  Two uncategorized txns + one unapproved         → triage
//   PLANT 8  Staples: 4× Office Supplies + 1 named Uncategorized (null id)
//            → rules fix-list + uncategorized (raises triage count to 3)
//   PLANT 9  Costco Wholesale: 3× Groceries vs 3× Dining Out → rules (ambiguous)
//   PLANT 10 Inter-account transfer pair (July, ±$1000)      → cashflow
//            (counted there; invisible to every other analysis)
//   PLANT 11 June budget snapshot: Groceries over-spent by the miscategorized
//            Netflix, Subscriptions untouched, Dining Out blown by the $250
//            Starbucks, uncategorized spend with no budget line → variance
//   PLANT 12 Balances + fixtures/bills.json: Demo Checking green, Demo Credit
//            Card yellow (thin cushion), Demo Savings red (property tax) → outlook
//   PLANT 13 July + August budget months: July partially funded with Groceries
//            under its goal; August (the get-ahead month) only Rent-funded →
//            monthAhead 35%, planner June→July/→August rows → budget tests
//
// Curated rule-check (fixtures/rules.json, not planted here) reuses PLANT 1
// (Netflix→Subscriptions violation) and PLANT 8 (Staples uncategorized lead).
// Sheets sync demo uses fixtures/sheets-hub.json (no live Google credentials).
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

// PLANT 8 — Staples: consistent payee whose latest row is YNAB-style named
// "Uncategorized" with null categoryId (truthy name the old `!category` filter
// missed). Amounts stay in a smooth band (no robust-Z outlier) and dates are
// irregular (gap MAD > 3) so no anomaly detector trips; mismatches skips it
// (uncategorized rows are excluded from the categorized set, share stays 1.0).
add('2026-02-09', 'Staples', -45.6, 'Office Supplies');
add('2026-02-27', 'Staples', -67.89, 'Office Supplies');
add('2026-04-14', 'Staples', -89.99, 'Office Supplies');
add('2026-05-19', 'Staples', -112.4, 'Office Supplies');
add('2026-06-18', 'Staples', -76.4, 'Uncategorized', { categoryId: null });

// PLANT 9 — Costco: evenly split between two categories → ambiguous, no rule.
add('2026-01-17', 'Costco Wholesale', -35.4, 'Groceries');
add('2026-03-05', 'Costco Wholesale', -58.2, 'Groceries');
add('2026-04-22', 'Costco Wholesale', -72.6, 'Groceries');
add('2026-05-08', 'Costco Wholesale', -88.1, 'Dining Out');
add('2026-06-13', 'Costco Wholesale', -101.3, 'Dining Out');
add('2026-07-01', 'Costco Wholesale', -114.9, 'Dining Out');

// PLANT 10 — an inter-account transfer pair: cashflow must count it, every
// other analysis must ignore it (they all filter transfer rows first).
add('2026-07-03', 'Transfer to Savings', -1000, null, {
  account: 'Demo Checking',
  transfer: true,
});
add('2026-07-03', 'Transfer from Checking', 1000, null, {
  account: 'Demo Savings',
  transfer: true,
});

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

// PLANT 11 — the June budget snapshot. The numbers cross into the transaction
// plants: Groceries' actual includes the miscategorized Netflix (PLANT 1),
// Subscriptions shows budgeted-but-unspent because June's Netflix landed in
// Groceries, Dining Out is blown by the $250 Starbucks (PLANT 2), Utilities is
// net of the refund (PLANT 4), and June's uncategorized spend (Check #204 +
// Staples) has no budget line at all. `activity`/`balance` follow YNAB's
// sign conventions for cross-checking; `variance` recomputes actuals itself.
const budgetMonths = [
  {
    month: '2026-06',
    budgeted: 5126,
    activity: -4962.44,
    toBeBudgeted: 0,
    ageOfMoney: 24,
    categories: [
      { id: 'Rent', name: 'Rent', budgeted: 1800, activity: -1800, balance: 0, goalType: 'MF', goalTarget: 1800 },
      { id: 'Utilities', name: 'Utilities', budgeted: 120, activity: -19.6, balance: 100.4, goalType: null, goalTarget: null },
      { id: 'Groceries', name: 'Groceries', budgeted: 300, activity: -121.19, balance: 178.81, goalType: 'NEED', goalTarget: 350 },
      { id: 'Dining Out', name: 'Dining Out', budgeted: 100, activity: -357.55, balance: -257.55, goalType: null, goalTarget: null },
      { id: 'Subscriptions', name: 'Subscriptions', budgeted: 16, activity: 0, balance: 16, goalType: 'TB', goalTarget: 16 },
      { id: 'Health & Fitness', name: 'Health & Fitness', budgeted: 50, activity: -45, balance: 5, goalType: null, goalTarget: null },
      { id: 'Software', name: 'Software', budgeted: 100, activity: -87.5, balance: 12.5, goalType: 'TB', goalTarget: 100 },
      { id: 'Professional Services', name: 'Professional Services', budgeted: 2600, activity: -2500, balance: 100, goalType: null, goalTarget: null },
      { id: 'Transport', name: 'Transport', budgeted: 40, activity: -31.6, balance: 8.4, goalType: null, goalTarget: null },
    ],
  },
  // July — the month being lived in (newest transactions): partially funded,
  // Rent already matches June so the planner skips it. Groceries sits UNDER
  // its June budget (and its goal) for the under-goal story.
  {
    month: '2026-07',
    budgeted: 2116,
    activity: -2355.77,
    toBeBudgeted: 400,
    ageOfMoney: 41,
    categories: [
      { id: 'Rent', name: 'Rent', budgeted: 1800, activity: -1800, balance: 0, goalType: 'MF', goalTarget: 1800 },
      { id: 'Utilities', name: 'Utilities', budgeted: 0, activity: -99.1, balance: -99.1, goalType: null, goalTarget: null },
      { id: 'Groceries', name: 'Groceries', budgeted: 200, activity: -89.9, balance: 110.1, goalType: 'NEED', goalTarget: 350 },
      { id: 'Dining Out', name: 'Dining Out', budgeted: 0, activity: -126.15, balance: -126.15, goalType: null, goalTarget: null },
      { id: 'Subscriptions', name: 'Subscriptions', budgeted: 16, activity: 0, balance: 16, goalType: 'TB', goalTarget: 16 },
      { id: 'Health & Fitness', name: 'Health & Fitness', budgeted: 100, activity: -90, balance: 10, goalType: null, goalTarget: null },
      { id: 'Software', name: 'Software', budgeted: 0, activity: -87.5, balance: -87.5, goalType: 'TB', goalTarget: 100 },
      { id: 'Professional Services', name: 'Professional Services', budgeted: 0, activity: 0, balance: 0, goalType: null, goalTarget: null },
      { id: 'Transport', name: 'Transport', budgeted: 0, activity: 0, balance: 0, goalType: null, goalTarget: null },
    ],
  },
  // August — PLANT 13: the get-ahead month. Only Rent is pre-funded (1800 of
  // June's 5126 reference), so monthAhead reports 35% funded. No activity —
  // the month hasn't started. ageOfMoney is null for future months.
  {
    month: '2026-08',
    budgeted: 1800,
    activity: 0,
    toBeBudgeted: 0,
    ageOfMoney: null,
    categories: [
      { id: 'Rent', name: 'Rent', budgeted: 1800, activity: 0, balance: 1800, goalType: 'MF', goalTarget: 1800 },
      { id: 'Utilities', name: 'Utilities', budgeted: 0, activity: 0, balance: 0, goalType: null, goalTarget: null },
      { id: 'Groceries', name: 'Groceries', budgeted: 0, activity: 0, balance: 0, goalType: 'NEED', goalTarget: 350 },
      { id: 'Dining Out', name: 'Dining Out', budgeted: 0, activity: 0, balance: 0, goalType: null, goalTarget: null },
      { id: 'Subscriptions', name: 'Subscriptions', budgeted: 0, activity: 0, balance: 0, goalType: 'TB', goalTarget: 16 },
      { id: 'Health & Fitness', name: 'Health & Fitness', budgeted: 0, activity: 0, balance: 0, goalType: null, goalTarget: null },
      { id: 'Software', name: 'Software', budgeted: 0, activity: 0, balance: 0, goalType: 'TB', goalTarget: 100 },
      { id: 'Professional Services', name: 'Professional Services', budgeted: 0, activity: 0, balance: 0, goalType: null, goalTarget: null },
      { id: 'Transport', name: 'Transport', budgeted: 0, activity: 0, balance: 0, goalType: null, goalTarget: null },
    ],
  },
];

// PLANT 12 — balances that pair with fixtures/bills.json to produce one green,
// one yellow, and one red outlook account (reference date 2026-07-05, the
// newest transaction).
const accounts = [
  { id: 'acc-1', name: 'Demo Checking', type: 'checking', onBudget: true, closed: false, balance: 4250, clearedBalance: 4250, unclearedBalance: 0 },
  { id: 'acc-2', name: 'Demo Savings', type: 'savings', onBudget: true, closed: false, balance: 2500, clearedBalance: 2500, unclearedBalance: 0 },
  { id: 'acc-3', name: 'Demo Credit Card', type: 'credit_card', onBudget: true, closed: false, balance: 80, clearedBalance: 80, unclearedBalance: 0 },
];

const fixture = {
  pulledAt: '2026-07-05T12:00:00.000Z', // fixed so the fixture is byte-stable
  provider: 'fixture',
  since: '2026-01-01',
  categories,
  accounts,
  budgetMonths,
  transactions,
};

const path = resolve(dirname(fileURLToPath(import.meta.url)), 'sample.json');
writeFileSync(path, JSON.stringify(fixture, null, 2));
console.log(`Wrote ${transactions.length} transactions to ${path}`);
