import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCategory, findTransaction, isSplitLine, planChange } from '../src/analysis/recategorize.mjs';

const cats = [
  { id: 'c-rent', name: 'Rent', group: 'Fixed' },
  { id: 'c-sub', name: 'Subscriptions', group: 'Everyday' },
  { id: 'c-sub2', name: 'Subscriptions', group: 'Business' }, // ambiguous: same name, diff group
];

const tx = (id, extra = {}) => ({
  id, date: '2026-06-15', amount: -15.99, payee: 'Netflix',
  category: 'Groceries', categoryId: 'c-groc', account: 'Checking',
  provider: 'ynab', ...extra,
});

// ── resolveCategory ───────────────────────────────────────────────────
// The guardrail: recategorize must never write an invented category name. The
// triage skill has the same rule; this enforces it at the command layer too.

test('resolveCategory: returns the match for a valid unique name', () => {
  assert.deepEqual(resolveCategory(cats, 'Rent'), cats[0]);
});

test('resolveCategory: throws on a name that does not exist', () => {
  assert.throws(() => resolveCategory(cats, 'Nonexistent'), /No category named/);
});

test('resolveCategory: throws on an ambiguous name (two groups)', () => {
  assert.throws(() => resolveCategory(cats, 'Subscriptions'), /ambiguous/);
});

test('resolveCategory: is case-sensitive (YNAB names are exact)', () => {
  assert.throws(() => resolveCategory(cats, 'rent'), /No category named/);
});

// ── findTransaction + isSplitLine ─────────────────────────────────────
// YNAB's update endpoint cannot restructure a split, so the command must detect
// split lines and refuse them rather than attempting an unsupported write.

test('findTransaction: returns a plain (non-split) transaction', () => {
  const list = [tx('a'), tx('b')];
  const { txn, isSplit } = findTransaction(list, 'a');
  assert.equal(txn.id, 'a');
  assert.equal(isSplit, false);
});

test('isSplitLine: true when the id carries a colon suffix', () => {
  const list = [tx('p1:0'), tx('p1:1')];
  assert.equal(isSplitLine(list, list[0]), true);
});

test('isSplitLine: true when sibling rows share the parent prefix', () => {
  // Even if one row's id had no colon, siblings with "<id>:n" mark it a split.
  const parent = tx('p1', { category: null });
  const list = [parent, tx('p1:0'), tx('p1:1')];
  assert.equal(isSplitLine(list, parent), true);
});

test('isSplitLine: false for a standalone transaction', () => {
  const list = [tx('plain'), tx('other'), tx('other:0')];
  // 'plain' has no colon and no sibling rows with 'plain:' prefix
  assert.equal(isSplitLine(list, list[0]), false);
});

test('findTransaction: throws on an unknown id', () => {
  assert.throws(() => findTransaction([tx('a')], 'nope'), /not found in the cache/);
});

test('findTransaction: marks a split line as isSplit', () => {
  const list = [tx('p1:0'), tx('p1:1')];
  const { isSplit } = findTransaction(list, 'p1:0');
  assert.equal(isSplit, true);
});

// ── planChange ────────────────────────────────────────────────────────
// The change object is the same shape in dry-run and applied output, so skills
// can present it uniformly regardless of whether the write happened.

test('planChange: builds the from→to change record', () => {
  const txn = tx('a', { category: 'Groceries' });
  const target = { id: 'c-sub', name: 'Subscriptions', group: 'Everyday' };
  const change = planChange(txn, txn.category, target);
  assert.equal(change.txnId, 'a');
  assert.equal(change.from, 'Groceries');
  assert.equal(change.to, 'Subscriptions');
  assert.equal(change.toCategoryId, 'c-sub');
  assert.equal(change.account, 'Checking'); // surfaced for findability
});
