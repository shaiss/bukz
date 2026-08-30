import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { monthAhead, planAssign, planMonthFunding } from '../src/analysis/budget.mjs';

// PLANT 13 (see fixtures/generate.mjs): July is the lived-in month, August
// the get-ahead month with only Rent funded (1800 of June's 5126).
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/sample.json', import.meta.url), 'utf8')
);
const txns = fixture.transactions;
const months = fixture.budgetMonths;

test('monthAhead: reads the lived-in month and the get-ahead month', () => {
  const ahead = monthAhead(txns, months);
  assert.equal(ahead.focusMonth, '2026-07'); // newest transaction's month
  assert.equal(ahead.ageOfMoney, 41);
  assert.equal(ahead.readyToAssign, 400);
  assert.equal(ahead.next.month, '2026-08');
  assert.equal(ahead.next.cached, true);
  assert.equal(ahead.next.assigned, 1800); // Rent only
  assert.equal(ahead.next.reference, 5126); // June, the last complete budget
  assert.equal(ahead.next.fundedPct, 35);
});

test('monthAhead: an uncached next month reads as zero funded', () => {
  const throughJuly = months.filter((m) => m.month <= '2026-07');
  const ahead = monthAhead(txns, throughJuly);
  assert.equal(ahead.next.month, '2026-08');
  assert.equal(ahead.next.cached, false);
  assert.equal(ahead.next.assigned, 0);
  assert.equal(ahead.next.fundedPct, 0);
});

test('monthAhead: reference falls back to the largest funded month', () => {
  // No June in the cache → July's prior is nothing; the reference becomes the
  // largest monthly assignment in the cache (July itself, 2116).
  const julyOnward = months.filter((m) => m.month >= '2026-07');
  const ahead = monthAhead(txns, julyOnward);
  assert.equal(ahead.next.month, '2026-08');
  assert.equal(ahead.next.reference, 2116);
  assert.equal(ahead.next.assigned, 1800);
  assert.equal(ahead.next.fundedPct, 85);
  // A cache where nothing was ever funded has no reference (fundedPct null)
  const unfunded = julyOnward.map((m) => ({
    ...m,
    categories: m.categories.map((c) => ({ ...c, budgeted: 0 })),
  }));
  const flat = monthAhead(txns, unfunded);
  assert.equal(flat.next.reference, 0);
  assert.equal(flat.next.fundedPct, null);
});

test('planAssign: resolves the category, reads current budgeted, computes delta', () => {
  const plan = planAssign({ month: '2026-07', categoryName: 'Groceries', amount: 350, categories: fixture.categories, budgetMonths: months });
  assert.equal(plan.applied, false);
  assert.equal(plan.category, 'Groceries');
  assert.equal(plan.categoryId, 'Groceries');
  assert.equal(plan.currentBudgeted, 200);
  assert.equal(plan.newBudgeted, 350);
  assert.equal(plan.delta, 150);
  assert.equal(plan.monthCached, true);
  // A future month not yet in the cache is still plannable (current: none)
  const future = planAssign({ month: '2026-09', categoryName: 'Rent', amount: 1800, categories: fixture.categories, budgetMonths: months });
  assert.equal(future.monthCached, false);
  assert.equal(future.currentBudgeted, null);
  assert.equal(future.delta, 1800);
});

test('planAssign: refuses invented categories, bad months, negative amounts', () => {
  assert.throws(
    () => planAssign({ month: '2026-07', categoryName: 'Versace Fund', amount: 5, categories: fixture.categories, budgetMonths: months }),
    /No category named "Versace Fund"/
  );
  assert.throws(
    () => planAssign({ month: '2026-13', categoryName: 'Rent', amount: 5, categories: fixture.categories, budgetMonths: months }),
    /--month must be YYYY-MM/
  );
  assert.throws(
    () => planAssign({ month: '2026-07', categoryName: 'Rent', amount: -50, categories: fixture.categories, budgetMonths: months }),
    /zero or positive/
  );
});

test('planMonthFunding: June → August proposes every changed category, skips matches', () => {
  const plan = planMonthFunding({ fromMonth: '2026-06', toMonth: '2026-08', budgetMonths: months });
  assert.deepEqual(
    plan.assignments.map((r) => r.category),
    ['Dining Out', 'Groceries', 'Health & Fitness', 'Professional Services', 'Software', 'Subscriptions', 'Transport', 'Utilities']
  );
  assert.ok(!plan.assignments.some((r) => r.category === 'Rent')); // already 1800 = June
  assert.equal(plan.alreadyAssigned, 1800);
  assert.equal(plan.readyToAssign, 0);
  assert.equal(plan.planTotal, 3326); // 5126 − 1800 already right
  const groceries = plan.assignments.find((r) => r.category === 'Groceries');
  assert.deepEqual(
    { from: groceries.from, current: groceries.current, proposed: groceries.proposed, delta: groceries.delta },
    { from: 300, current: 0, proposed: 300, delta: 300 }
  );
});

test('planMonthFunding: June → July handles partial funding and reductions', () => {
  const plan = planMonthFunding({ fromMonth: '2026-06', toMonth: '2026-07', budgetMonths: months });
  const groceries = plan.assignments.find((r) => r.category === 'Groceries');
  assert.equal(groceries.delta, 100); // 300 target − 200 already assigned
  const fitness = plan.assignments.find((r) => r.category === 'Health & Fitness');
  assert.equal(fitness.delta, -50); // July over-assigned vs June — pull back
  assert.equal(plan.planTotal, 3010);
});

test('planMonthFunding: an uncached target month plans the whole month', () => {
  const plan = planMonthFunding({ fromMonth: '2026-06', toMonth: '2026-09', budgetMonths: months });
  assert.equal(plan.toMonthCached, false);
  assert.equal(plan.readyToAssign, null);
  assert.equal(plan.planTotal, 5126); // nothing assigned yet — everything is a change
  assert.throws(
    () => planMonthFunding({ fromMonth: '2025-01', toMonth: '2026-09', budgetMonths: months }),
    /--copy-from month 2025-01 is not in the cache/
  );
});
