import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { saveCache, mergeTransactions } from '../src/data.mjs';

// ── mergeTransactions ────────────────────────────────────────────────
// This is the heart of incremental pull: applying a delta to the cache. A bug
// here means silently wrong books, so it gets the most coverage.

const tx = (id, date, amount, extra = {}) => ({
  id, date, amount, payee: 'X', category: 'C', account: 'A',
  provider: 'test', ...extra,
});

test('merge: inserts new transactions, keeps existing', () => {
  const cache = [tx('1', '2026-01-01', -10)];
  const merged = mergeTransactions(cache, [tx('2', '2026-01-02', -20)]);
  assert.deepEqual(merged.map((t) => t.id), ['1', '2']);
});

test('merge: updates a changed row in place (same id)', () => {
  const cache = [tx('1', '2026-01-01', -10)];
  const merged = mergeTransactions(cache, [tx('1', '2026-01-01', -99)]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].amount, -99);
});

test('merge: evicts a deleted parent id', () => {
  const cache = [tx('1', '2026-01-01', -10), tx('2', '2026-01-02', -20)];
  const merged = mergeTransactions(cache, [], new Set(['1']));
  assert.deepEqual(merged.map((t) => t.id), ['2']);
});

test('merge: evicts ALL split lines when the parent is deleted/restructured', () => {
  // A YNAB split transaction normalizes to ids "<parentId>:<n>". When the
  // parent changes, stale lines must all go — not linger as orphans.
  const cache = [
    tx('p1:0', '2026-01-01', -10),
    tx('p1:1', '2026-01-01', -20),
    tx('p1:2', '2026-01-01', -30),
    tx('other', '2026-01-02', -5),
  ];
  const merged = mergeTransactions(cache, [], new Set(['p1']));
  assert.deepEqual(merged.map((t) => t.id), ['other']);
});

test('merge: re-adds replacement split lines after parent eviction', () => {
  // The real sequence: parent p1 had 3 lines; delta says p1 changed + provides
  // 2 new lines. Old 3 must be gone, new 2 present.
  const cache = [tx('p1:0', '2026-01-01', -10), tx('p1:1', '2026-01-01', -20)];
  const changes = [tx('p1:0', '2026-01-01', -15), tx('p1:1', '2026-01-01', -25)];
  const merged = mergeTransactions(cache, changes, new Set(['p1']));
  assert.deepEqual(merged.map((t) => t.id), ['p1:0', 'p1:1']);
  assert.deepEqual(merged.map((t) => t.amount), [-15, -25]);
});

test('merge: output is sorted by date then id (deterministic)', () => {
  const cache = [tx('b', '2026-01-02', -1), tx('a', '2026-01-02', -1), tx('c', '2026-01-01', -1)];
  const merged = mergeTransactions(cache, []);
  // same date → id order; earlier date first
  assert.deepEqual(merged.map((t) => t.id), ['c', 'a', 'b']);
});

test('merge: empty changes + empty deletes returns sorted copy of cache', () => {
  const cache = [tx('2', '2026-01-02', -1), tx('1', '2026-01-01', -1)];
  const merged = mergeTransactions(cache, []);
  assert.deepEqual(merged.map((t) => t.id), ['1', '2']);
  assert.notEqual(merged, cache); // it's a new array, not the input ref
});

// ── atomic saveCache ─────────────────────────────────────────────────
// The motivating bug: writeFileSync truncates the target before writing, so a
// crash mid-write corrupts the whole cache. The fix stages to .tmp then renames.
// We verify the happy path here (round-trip + no .tmp left behind); the
// crash-mid-write guarantee is a property of rename(2), exercised by the OS.

test('saveCache: round-trips data and leaves no .tmp file behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bukz-cache-'));
  try {
    const target = join(dir, 'transactions.json');
    const data = {
      pulledAt: '2026-07-09T00:00:00.000Z',
      provider: 'test',
      transactions: [tx('1', '2026-01-01', -10)],
    };
    saveCache(data, target);
    // Target written and parses back identically.
    const roundTrip = JSON.parse(readFileSync(target, 'utf8'));
    assert.deepEqual(roundTrip, data);
    // No staging file left behind on success.
    assert.throws(() => readFileSync(target + '.tmp', 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveCache: overwriting an existing cache does not corrupt it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bukz-cache-'));
  try {
    const target = join(dir, 'transactions.json');
    saveCache({ provider: 'test', transactions: [tx('1', '2026-01-01', -10)] }, target);
    saveCache({ provider: 'test', transactions: [tx('2', '2026-01-02', -20)] }, target);
    const after = JSON.parse(readFileSync(target, 'utf8'));
    assert.equal(after.transactions[0].id, '2'); // second write wins
    assert.throws(() => readFileSync(target + '.tmp', 'utf8')); // no leak
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
