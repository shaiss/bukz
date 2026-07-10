import test from 'node:test';
import assert from 'node:assert/strict';

import { num, assertDate } from '../src/cli.mjs';

// ── num ────────────────────────────────────────────────────────────────
// The motivating bug: Number("") === 0 (not NaN), so a bare NaN check let an
// empty --z '' through as z=0 and flagged every transaction as an outlier.

test('num: empty string throws, does not silently coerce to 0', () => {
  assert.throws(() => num('', 42), /Expected a number/);
});

test('num: whitespace-only string throws', () => {
  assert.throws(() => num('   ', 42), /Expected a number/);
  assert.throws(() => num('\t', 42), /Expected a number/);
});

test('num: undefined falls back', () => {
  assert.equal(num(undefined, 7), 7);
});

test('num: valid numbers pass through', () => {
  assert.equal(num('3.5', 0), 3.5);
  assert.equal(num('0', 5), 0);
  assert.equal(num('-3', 5), -3);
});

test('num: non-numeric strings throw', () => {
  assert.throws(() => num('abc', 1), /Expected a number/);
  assert.throws(() => num('3.5abc', 1), /Expected a number/);
});

// ── assertDate ─────────────────────────────────────────────────────────
// The motivating bug: "2026-02-31" passes a YYYY-MM-DD format check but JS
// rolls it to 2026-03-03, so `match --date 2026-02-31` matched the wrong rows.

test('assertDate: accepts a real calendar date', () => {
  assert.equal(assertDate('--date', '2026-07-05'), '2026-07-05');
  assert.equal(assertDate('--date', '2024-02-29'), '2024-02-29'); // leap day
});

test('assertDate: rejects impossible calendar dates', () => {
  assert.throws(() => assertDate('--date', '2026-02-31'), /not a valid calendar date/);
  assert.throws(() => assertDate('--date', '2026-04-31'), /not a valid calendar date/); // April has 30
  assert.throws(() => assertDate('--date', '2023-02-29'), /not a valid calendar date/); // not a leap year
  assert.throws(() => assertDate('--date', '2026-13-01'), /not a valid calendar date/); // bad month
});

test('assertDate: rejects malformed formats', () => {
  assert.throws(() => assertDate('--date', '2026-7-5'), /must be YYYY-MM-DD/);
  assert.throws(() => assertDate('--date', '20260705'), /must be YYYY-MM-DD/);
  assert.throws(() => assertDate('--date', '2026/07/05'), /must be YYYY-MM-DD/);
});
