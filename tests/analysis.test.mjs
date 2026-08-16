import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { median, mad, robustZ, daysBetween } from '../src/analysis/stats.mjs';
import { findAnomalies } from '../src/analysis/anomalies.mjs';
import { findMismatches } from '../src/analysis/mismatches.mjs';
import { deriveRules } from '../src/analysis/rules.mjs';
import { sampleForSpotCheck } from '../src/analysis/sample.mjs';

// The fixture's planted issues (see fixtures/generate.mjs) are the spec here.
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/sample.json', import.meta.url), 'utf8')
);
const txns = fixture.transactions;
const anomalies = findAnomalies(txns);

test('stats: median and mad', () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(mad([10, 10, 10]), 0);
  assert.equal(mad([1, 2, 9]), 1);
});

test('stats: robustZ handles zero-spread history without exploding', () => {
  assert.equal(robustZ(15.99, [15.99, 15.99, 15.99]), 0);
  const z = robustZ(250, [15.99, 15.99, 15.99]);
  assert.ok(Number.isFinite(z) && z >= 3.5, `expected large finite z, got ${z}`);
  // A small price bump on a flat subscription should NOT flag
  assert.ok(Math.abs(robustZ(16.99, [15.99, 15.99, 15.99])) < 3.5);
});

test('stats: daysBetween is timezone-safe whole days', () => {
  assert.equal(daysBetween('2026-03-21', '2026-07-05'), 106);
  assert.equal(daysBetween('2026-07-02', '2026-07-03'), 1);
});

test('anomalies: reference date is newest transaction, not wall clock', () => {
  assert.equal(anomalies.referenceDate, '2026-07-05');
});

test('anomalies: finds the planted gym duplicate (and only that)', () => {
  assert.equal(anomalies.duplicates.length, 1);
  const d = anomalies.duplicates[0];
  assert.equal(d.first.payee, 'Iron Works Gym');
  assert.equal(d.daysApart, 1);
});

test('anomalies: flags the $250 Starbucks as the top amount outlier', () => {
  const top = anomalies.amountOutliers[0];
  assert.equal(top.txn.payee, 'Starbucks');
  assert.equal(top.txn.amount, -250);
  // steady payees must not appear
  const payees = anomalies.amountOutliers.map((f) => f.txn.payee);
  assert.ok(!payees.includes('Whole Foods Market'));
  assert.ok(!payees.includes('Oakwood Property Mgmt'));
});

test('anomalies: flags the utilities refund as a sign flip', () => {
  const flip = anomalies.signFlips.find((f) => f.payee === 'City Utilities');
  assert.ok(flip, 'City Utilities sign flip not found');
  assert.equal(flip.usualDirection, 'outflow');
  assert.equal(flip.exceptions.length, 1);
  assert.equal(flip.exceptions[0].amount, 85);
});

test('anomalies: notices the stopped biweekly delivery', () => {
  const missing = anomalies.missingRecurring.find(
    (f) => f.payee === 'Blue Bottle Water Delivery'
  );
  assert.ok(missing, 'missing recurring payee not found');
  assert.equal(missing.cadence, 'biweekly');
  // healthy recurrences must not appear
  const payees = anomalies.missingRecurring.map((f) => f.payee);
  assert.ok(!payees.includes('Oakwood Property Mgmt'));
  assert.ok(!payees.includes('Netflix'));
});

test('anomalies: flags the new large payee', () => {
  const payees = anomalies.newLargePayees.map((f) => f.payee);
  assert.ok(payees.includes('Apex Consulting LLC'));
  // Acme is large but not new; checks are relative to the newest txn date
  assert.ok(!payees.includes('Acme Corp'));
});

test('anomalies: counts triage work', () => {
  // 2 from PLANT 7 + 1 uncategorized Staples row from PLANT 8
  assert.equal(anomalies.uncategorizedCount, 3);
  assert.equal(anomalies.unapprovedCount, 1);
});

test('mismatches: catches Netflix drifting into Groceries', () => {
  const flags = findMismatches(txns);
  assert.equal(flags.length, 1);
  const netflix = flags[0];
  assert.equal(netflix.payee, 'Netflix');
  assert.equal(netflix.usualCategory, 'Subscriptions');
  assert.equal(netflix.outliers.length, 1);
  assert.equal(netflix.outliers[0].category, 'Groceries');
});

test('rules: proposes Staples→Office Supplies with its uncategorized row as work', () => {
  const { rules } = deriveRules(txns);
  const staples = rules.find((r) => r.payee === 'Staples');
  assert.ok(staples, 'Staples rule not found');
  assert.equal(staples.category, 'Office Supplies');
  assert.equal(staples.support, 4);
  assert.equal(staples.confidence, 1);
  assert.equal(staples.uncategorized.length, 1);
  assert.equal(staples.uncategorized[0].account, 'Demo Checking');
});

test('rules: Netflix rule agrees with mismatches on the exception', () => {
  const { rules } = deriveRules(txns);
  const netflix = rules.find((r) => r.payee === 'Netflix');
  assert.ok(netflix, 'Netflix rule not found');
  assert.equal(netflix.category, 'Subscriptions');
  assert.equal(netflix.confidence, 0.83);
  assert.equal(netflix.exceptions.length, 1);
  assert.equal(netflix.exceptions[0].category, 'Groceries');
});

test('rules: mixed payees land in ambiguous, not rules', () => {
  const { rules, ambiguous } = deriveRules(txns);
  const costco = ambiguous.find((a) => a.payee === 'Costco Wholesale');
  assert.ok(costco, 'Costco not listed as ambiguous');
  assert.deepEqual(costco.categories, [
    { category: 'Dining Out', count: 3 },
    { category: 'Groceries', count: 3 },
  ]);
  assert.ok(!rules.some((r) => r.payee === 'Costco Wholesale'));
});

test('rules: thin-history payees are skipped and summarized', () => {
  const { rules, summary } = deriveRules(txns);
  // Amazon's single uncategorized row is no basis for a rule
  assert.ok(!rules.some((r) => r.payee === 'Amazon'));
  assert.equal(summary.rules, rules.length);
  assert.equal(summary.ambiguous, 1);
  assert.equal(summary.payeesConsidered, 15);
  assert.equal(summary.belowMinSupport, 3);
  assert.equal(summary.uncategorizedRowsInRules, 1);
});

test('spot-check: deterministic, bounded, always includes largest txn', () => {
  const a = sampleForSpotCheck(txns, { perCategory: 4, seed: 7 });
  const b = sampleForSpotCheck(txns, { perCategory: 4, seed: 7 });
  assert.deepEqual(a, b);
  for (const group of a) {
    assert.ok(group.sample.length <= 4);
    assert.ok(group.sample.length >= 1);
  }
  const dining = a.find((g) => g.category === 'Dining Out');
  assert.ok(dining.sample.some((t) => t.amount === -250), 'largest txn must be sampled');
});
