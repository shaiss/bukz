import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { toCents, fromCents } from '../src/analysis/money.mjs';
import { addDays, monthBounds, newestDate } from '../src/analysis/period.mjs';
import { profitAndLoss } from '../src/analysis/pl.mjs';
import { cashflow } from '../src/analysis/cashflow.mjs';
import { budgetVariance, defaultMonth } from '../src/analysis/variance.mjs';
import { outlook } from '../src/analysis/outlook.mjs';

// The fixture's planted issues (see fixtures/generate.mjs, PLANTs 10–12) are
// the spec here, same lockstep as tests/analysis.test.mjs.
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/sample.json', import.meta.url), 'utf8')
);
const bills = JSON.parse(
  readFileSync(new URL('../fixtures/bills.json', import.meta.url), 'utf8')
);
const txns = fixture.transactions;

test('money: cents math does not drift', () => {
  assert.equal(fromCents(toCents(0.1) + toCents(0.2)), 0.3);
  assert.equal(fromCents(toCents(-99.99) + toCents(49.995)), -49.99);
  assert.equal(fromCents(toCents(0.07) * 3), 0.21);
});

test('period: monthBounds handles short and leap months', () => {
  assert.deepEqual(monthBounds('2026-02'), { since: '2026-02-01', until: '2026-02-28' });
  assert.deepEqual(monthBounds('2024-02'), { since: '2024-02-01', until: '2024-02-29' });
  assert.deepEqual(monthBounds('2026-07'), { since: '2026-07-01', until: '2026-07-31' });
});

test('period: addDays rolls over months and years exactly', () => {
  assert.equal(addDays('2026-07-05', 14), '2026-07-19');
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('period: newestDate is the newest transaction, and errors on empty input', () => {
  assert.equal(newestDate(txns), '2026-07-05');
  assert.throws(() => newestDate([]));
});

test('pl: July (default month) totals match the planted rows', () => {
  const july = txns.filter((t) => t.date.startsWith('2026-07'));
  const pl = profitAndLoss(july, fixture.categories);
  assert.equal(pl.totals.income, 5000);
  assert.equal(pl.totals.expenses, 2355.77);
  assert.equal(pl.totals.net, 2644.23);
  // Largest expense first; uncategorized spend is visible, not hidden
  assert.equal(pl.expenses[0].category, 'Rent');
  assert.equal(pl.expenses[0].total, 1800);
  const uncategorized = pl.expenses.find((r) => r.category === 'Uncategorized');
  assert.equal(uncategorized.total, 63.12);
  assert.equal(uncategorized.group, null);
  // Income row carries its group from the cached category list
  assert.equal(pl.income[0].category, 'Inflow: Ready to Assign');
  assert.equal(pl.income[0].group, 'Income');
  // PLANT 10: transfers are excluded from P&L
  assert.ok(!pl.expenses.some((r) => r.total === 1000));
});

test('pl: full-range net cross-checks against cashflow', () => {
  const pl = profitAndLoss(txns, fixture.categories);
  // 3×5000 client income plus the $85 utilities refund (PLANT 4): sign-based
  // P&L counts any positive amount as income, whatever its category — the
  // refund shows as an income row labeled "Utilities". (variance nets it
  // against spend instead, matching YNAB activity.)
  assert.equal(pl.totals.income, 15085);
  const refund = pl.income.find((r) => r.category === 'Utilities');
  assert.equal(refund.total, 85);
  assert.equal(pl.totals.expenses, 19621.79);
  assert.equal(pl.totals.net, -4536.79);
  const cf = cashflow(txns);
  const allOutflow = cf.accounts.reduce((n, a) => n + toCents(a.outflow), 0);
  // cashflow counts the $1000 transfer pair; P&L does not
  assert.equal(fromCents(allOutflow - toCents(pl.totals.expenses)), 1000);
});

test('cashflow: monthly buckets include transfers, the deliberate exception', () => {
  const cf = cashflow(txns);
  assert.equal(cf.months.length, 7); // 2026-01 .. 2026-07
  assert.equal(cf.months.at(-1).month, '2026-07');
  const checkingJuly = cf.rows.find((r) => r.month === '2026-07' && r.account === 'Demo Checking');
  assert.equal(checkingJuly.inflow, 5000);
  assert.equal(checkingJuly.outflow, 3355.77); // includes the 1000 transfer out
  assert.equal(checkingJuly.net, 1644.23);
  // Demo Savings exists ONLY via the transfer pair — proves transfers count
  const savings = cf.accounts.find((a) => a.account === 'Demo Savings');
  assert.equal(savings.inflow, 1000);
  assert.equal(savings.net, 1000);
});

test('variance: June snapshot exposes the planted leaks', () => {
  const v = budgetVariance(txns, fixture.budgetMonths, '2026-06');
  assert.equal(v.month, '2026-06');
  assert.equal(v.snapshot.budgeted, 5126);
  // Worst overshoots first: uncategorized spend has no budget line at all
  assert.equal(v.categories[0].category, 'Uncategorized');
  assert.equal(v.categories[0].budgeted, 0);
  assert.equal(v.categories[0].actual, 476.4); // Check #204 + Staples
  // Dining Out is blown by the $250 Starbucks (PLANT 2)
  assert.equal(v.categories[1].category, 'Dining Out');
  assert.equal(v.categories[1].remaining, -257.55);
  const groceries = v.categories.find((r) => r.category === 'Groceries');
  assert.equal(groceries.actual, 121.19); // includes the miscategorized Netflix
  assert.equal(groceries.remaining, 178.81);
  // Subscriptions shows budgeted-but-unspent: June's Netflix landed elsewhere
  const subs = v.categories.find((r) => r.category === 'Subscriptions');
  assert.equal(subs.actual, 0);
  assert.equal(subs.remaining, 16);
  // The utilities refund nets against spend (PLANT 4)
  const utilities = v.categories.find((r) => r.category === 'Utilities');
  assert.equal(utilities.actual, 19.6);
  // Income is not unbudgeted spend — no phantom "Inflow" row
  assert.ok(!v.categories.some((r) => r.category === 'Inflow: Ready to Assign'));
});

test('variance: unknown month names the cached months', () => {
  assert.throws(
    () => budgetVariance(txns, fixture.budgetMonths, '2026-05'),
    /No budget data for 2026-05 \(cached months: 2026-06\)/
  );
});

test('variance: default month falls back to the newest budgeted month', () => {
  // Newest txn is July 2026, but only June is budgeted → June it is
  assert.equal(defaultMonth(txns, fixture.budgetMonths), '2026-06');
  // When the newest txn's month IS budgeted, it wins
  const withJuly = [...fixture.budgetMonths, { ...fixture.budgetMonths[0], month: '2026-07' }];
  assert.equal(defaultMonth(txns, withJuly), '2026-07');
  // No budget months at all → newest txn month (budgetVariance gives the error)
  assert.equal(defaultMonth(txns, []), '2026-07');
});

test('outlook: one green, one yellow, one red — rollup is red', () => {
  const o = outlook(txns, fixture.accounts, bills, { days: 14 });
  assert.equal(o.referenceDate, '2026-07-05');
  assert.equal(o.window.to, '2026-07-19');
  const byName = Object.fromEntries(o.accounts.map((a) => [a.account, a]));
  // Checking: 4250 − 55 due (gym + streaming) = comfortable green
  assert.equal(byName['Demo Checking'].status, 'green');
  assert.equal(byName['Demo Checking'].projectedBalance, 4195);
  // Credit card: 80 − 60 water bill = 20, under the $250 cushion → yellow
  assert.equal(byName['Demo Credit Card'].status, 'yellow');
  assert.equal(byName['Demo Credit Card'].projectedBalance, 20);
  // Savings: 2500 − 3000 property tax = −500 → red
  assert.equal(byName['Demo Savings'].status, 'red');
  assert.equal(byName['Demo Savings'].projectedBalance, -500);
  assert.deepEqual(
    byName['Demo Savings'].billsDue,
    [{ name: 'Property Tax', amount: 3000, date: '2026-07-15' }]
  );
  assert.equal(o.status, 'red');
});

test('outlook: manual watch lists non-autopay bills due within 30 days', () => {
  const o = outlook(txns, fixture.accounts, bills, { days: 14 });
  assert.deepEqual(
    o.manualWatch.map((b) => b.name),
    ['Property Tax'] // RV Insurance (due 8/20) is outside the 30-day watch
  );
  assert.equal(o.manualWatch[0].date, '2026-07-15');
  assert.equal(o.manualWatch[0].autopay, 'no');
});

test('outlook: bills paid from unknown accounts surface as unmatched', () => {
  const o = outlook(txns, fixture.accounts, bills, { days: 14 });
  assert.deepEqual(o.unmatchedBills, [
    { name: 'Legacy Hosting', paidFrom: 'First National (closed)' },
  ]);
});

test('outlook: closed accounts and inactive bills are skipped', () => {
  const accounts = [...fixture.accounts, { ...fixture.accounts[0], id: 'acc-9', name: 'Demo Old', closed: true }];
  const withInactive = [...bills, { name: 'Dead Bill', amount: 999, cadence: 'monthly', dayOfMonth: 10, paidFrom: 'Demo Checking', autopay: 'yes', active: false }];
  const o = outlook(txns, accounts, withInactive, { days: 14 });
  assert.ok(!o.accounts.some((a) => a.account === 'Demo Old'));
  const checking = o.accounts.find((a) => a.account === 'Demo Checking');
  assert.equal(checking.projectedOutflows, 55); // Dead Bill contributed nothing
});

test('outlook: deterministic for the same inputs', () => {
  const a = outlook(txns, fixture.accounts, bills, { days: 14 });
  const b = outlook([...txns].reverse(), [...fixture.accounts].reverse(), [...bills].reverse(), { days: 14 });
  assert.deepEqual(a, b);
});

test('outlook: anchored cadences and month-length clamping', () => {
  // Biweekly from a known past occurrence: anchor 6/21 → falls on 7/5 (the
  // reference date — already in the balance, excluded) and 7/19 (the window's
  // last day — included).
  const biweekly = { name: 'Biweekly Cleaner', amount: 60, cadence: 'biweekly', anchor: '2026-06-21', paidFrom: 'Demo Checking', autopay: 'yes', active: true };
  const o = outlook(txns, fixture.accounts, [...bills, biweekly], { days: 14 });
  const checking = o.accounts.find((a) => a.account === 'Demo Checking');
  assert.deepEqual(
    checking.billsDue.filter((b) => b.name === 'Biweekly Cleaner').map((b) => b.date),
    ['2026-07-19']
  );
  // 55 from the fixture bills + 60 cleaner
  assert.equal(checking.projectedOutflows, 115);
  // A dayOfMonth of 31 clamps to February's length inside a window crossing it
  const clamp = { name: 'End-of-Month Club', amount: 10, cadence: 'monthly', dayOfMonth: 31, paidFrom: 'Demo Checking', autopay: 'yes', active: true };
  const long = outlook(['2026-01-31', '2026-02-01'].map((date, i) => ({ ...txns[0], id: `t${i}`, date })), fixture.accounts, [clamp], { days: 30 });
  const dates = long.accounts.find((a) => a.account === 'Demo Checking').billsDue.map((b) => b.date);
  assert.deepEqual(dates, ['2026-02-28']);
});
