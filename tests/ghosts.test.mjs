import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

import { parseImportId, findImportedTwins, compileAllowlist, formatTwinsText } from '../src/analysis/ghosts.mjs';
import { balanceDrift, issuerSigned } from '../src/analysis/drift.mjs';
import { resolveAccount, accountRows } from '../src/account-select.mjs';
import { parseDays } from '../src/ghosts-config.mjs';
import { normalize } from '../src/providers/ynab.mjs';

// All data here is synthetic (fixtures/generate-ghosts.mjs); no real books.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fx = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/ghosts.json'), 'utf8'));
const allow = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/ghosts-allowlist.json'), 'utf8'));
const card = fx.transactions.filter((t) => t.account === 'Demo Card');

// ── provider normalize keeps import provenance ───────────────────────────
test('ynab normalize: keeps accountId, importId, importPayeeNameOriginal', () => {
  const api = {
    id: 'syn-1', date: '2026-03-10', amount: -500000, payee_name: 'Renamed', category_name: 'Demo',
    category_id: 'c1', account_name: 'Demo Card', account_id: 'acc-card', memo: null, cleared: 'cleared',
    approved: false, transfer_account_id: null, import_id: 'YNAB:-500000:2026-03-10:1',
    import_payee_name_original: 'Example Theme Park',
  };
  const t = normalize(api);
  assert.equal(t.amount, -500);
  assert.equal(t.accountId, 'acc-card');
  assert.equal(t.importId, 'YNAB:-500000:2026-03-10:1');
  assert.equal(t.importPayeeNameOriginal, 'Example Theme Park');
});

test('ynab normalize: manual rows get null import fields; split lines inherit the parent import id', () => {
  const manual = normalize({ id: 'm', date: '2026-01-01', amount: -1000, cleared: 'cleared', approved: true });
  assert.equal(manual.importId, null);
  assert.equal(manual.importPayeeNameOriginal, null);
  assert.equal(manual.accountId, null);
  const parent = { id: 'p', date: '2026-01-01', amount: -3000, account_id: 'a', import_id: 'YNAB:-3000:2026-01-01:1', cleared: 'cleared', approved: true };
  const line = normalize(parent, { id: 'p:1', amount: -1000, category_name: 'X' });
  assert.equal(line.importId, 'YNAB:-3000:2026-01-01:1');
});

// ── parseImportId ────────────────────────────────────────────────────────
test('parseImportId: linked-import ids parse; anything else is null', () => {
  assert.deepEqual(parseImportId('YNAB:-20000:2026-03-16:3'), { milliunits: -20000, date: '2026-03-16', occurrence: 3 });
  assert.deepEqual(parseImportId('YNAB:110:2026-03-16:1'), { milliunits: 110, date: '2026-03-16', occurrence: 1 });
  for (const v of [null, undefined, '', 'custom-123', 'YNAB:abc:2026-03-16:1', 'YNAB:-1:2026-3-16:1']) {
    assert.equal(parseImportId(v), null);
  }
});

// ── findImportedTwins on the planted fixture ─────────────────────────────
test('ghosts: flags G1 (renamed payee) + G2 (3 one-to-one pairs); allowlists G3', () => {
  const r = findImportedTwins(card, { allowlist: allow });
  assert.deepEqual(r.flagged.map((p) => `${p.original.id}>${p.twin.id}`), [
    'gx-004>gx-005', 'gx-006>gx-009', 'gx-007>gx-010', 'gx-008>gx-011',
  ]);
  assert.equal(r.summary.flaggedTwinTotal, -560);
  assert.deepEqual(r.allowlisted.map((p) => p.twin.id), ['gx-013']);
  assert.equal(r.allowlisted[0].allowlistEntry, 0);
  assert.equal(r.summary.rowsWithoutImportId, 1); // G5 manual row
});

test('ghosts: without the allowlist the short-ride pair is flagged', () => {
  const r = findImportedTwins(card);
  assert.ok(r.flagged.some((p) => p.payee === 'Example Ride'));
});

test('ghosts: monthly (G4), manual+import (G5), 7-day (G6) and transfers (G8) are not flagged', () => {
  const r = findImportedTwins(fx.transactions, { allowlist: allow });
  const payees = new Set(r.flagged.map((p) => p.payee));
  for (const p of ['Example Streaming Service', 'Example Bakery', 'Example Hardware', 'Transfer : Demo Checking']) {
    assert.ok(!payees.has(p), `${p} should not be flagged`);
  }
});

test('ghosts: --days widens the window to catch G6', () => {
  const r = findImportedTwins(card, { minDays: 1, maxDays: 7, allowlist: allow });
  assert.ok(r.flagged.some((p) => p.payee === 'Example Hardware' && p.gapDays === 7));
});

test('ghosts: never pairs across accounts (G7)', () => {
  const r = findImportedTwins(fx.transactions, { allowlist: allow });
  for (const p of r.flagged) assert.equal(p.original.account, p.twin.account);
  assert.equal(r.flagged.filter((p) => p.payee === 'Example Theme Park').length, 2); // one per account
});

test('ghosts: same import date (split lines / same-day repeats) is not this pattern', () => {
  const rows = [
    { id: 'a', date: '2026-01-01', amount: -5, payee: 'P', account: 'A', importId: 'YNAB:-5000:2026-01-01:1' },
    { id: 'b', date: '2026-01-02', amount: -5, payee: 'P', account: 'A', importId: 'YNAB:-5000:2026-01-01:2' },
  ];
  assert.equal(findImportedTwins(rows).flagged.length, 0);
});

test('ghosts: bad window throws', () => {
  assert.throws(() => findImportedTwins([], { minDays: 0, maxDays: 5 }), /Day window/);
  assert.throws(() => findImportedTwins([], { minDays: 4, maxDays: 2 }), /Day window/);
});

// ── allowlist semantics ──────────────────────────────────────────────────
test('allowlist: every set field must match; empty entry matches nothing; bad regex throws', () => {
  const t = { amount: -9.99, payee: 'x', importPayeeNameOriginal: 'Example Streaming Service', account: 'Example Card' };
  const [full, wrongAmt, empty, ci] = compileAllowlist([
    { payee: 'Example Streaming Service', amount: -9.99, account: 'Example Card' },
    { payee: 'Example Streaming Service', amount: -10 },
    {},
    { payee: '  example   streaming service ' },
  ]);
  assert.equal(full.test(t), true);
  assert.equal(wrongAmt.test(t), false);
  assert.equal(empty.test(t), false);
  assert.equal(ci.test(t), true);
  assert.throws(() => compileAllowlist([{ payeePattern: '(' }]), /bad payeePattern/);
  assert.throws(() => compileAllowlist({}), /must be a JSON array/);
});

test('config/ghosts.example.json is valid and generic', () => {
  const ex = JSON.parse(readFileSync(resolve(ROOT, 'config/ghosts.example.json'), 'utf8'));
  assert.ok(compileAllowlist(ex).length >= 1);
  for (const e of ex) {
    const name = String(e.payee ?? e.payeePattern ?? '');
    assert.match(name, /example/i, 'example allowlist entries must use placeholder names');
  }
});

// ── days parsing / account selection ─────────────────────────────────────
test('parseDays: N, MIN-MAX, default, and errors', () => {
  assert.deepEqual(parseDays(undefined), { minDays: 1, maxDays: 5 });
  assert.deepEqual(parseDays('3'), { minDays: 1, maxDays: 3 });
  assert.deepEqual(parseDays('2-4'), { minDays: 2, maxDays: 4 });
  for (const bad of ['0', '0-3', '5-2', 'x', '']) assert.throws(() => parseDays(bad), /--days/);
});

test('resolveAccount: id, exact name, fragment; ambiguity and misses fail', () => {
  assert.equal(resolveAccount(fx, 'acc-card').name, 'Demo Card');
  assert.equal(resolveAccount(fx, 'demo card').id, 'acc-card');
  assert.equal(resolveAccount(fx, 'card').id, 'acc-card');
  assert.throws(() => resolveAccount(fx, 'demo'), /ambiguous/);
  assert.throws(() => resolveAccount(fx, 'nope'), /No account matches/);
  assert.throws(() => resolveAccount(fx, ''), /--account is required/);
  const noSnap = { transactions: fx.transactions };
  const r = resolveAccount(noSnap, 'checking');
  assert.equal(r.name, 'Demo Checking');
  assert.ok(accountRows(fx.transactions, r).every((t) => t.account === 'Demo Checking'));
});

// ── drift ────────────────────────────────────────────────────────────────
test('drift: owed convention negates; gap equals flagged copies; residual 0', () => {
  const issuer = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/ghosts-issuer.json'), 'utf8'));
  const acct = fx.accounts.find((a) => a.id === 'acc-card');
  const d = balanceDrift({
    ledgerCleared: acct.clearedBalance, issuerBalance: issuer.balance, convention: issuer.convention,
    threshold: 1, twinTotal: findImportedTwins(card, { allowlist: allow }).summary.flaggedTwinTotal,
  });
  assert.equal(d.gap, -560);
  assert.equal(d.alert, true);
  assert.equal(d.explained.residualAfterTwins, 0);
  assert.equal(d.explained.residualAlert, false);
});

test('drift: threshold is inclusive-safe and conventions validate', () => {
  assert.equal(balanceDrift({ ledgerCleared: -100, issuerBalance: 99, convention: 'owed', threshold: 1 }).alert, false);
  assert.equal(balanceDrift({ ledgerCleared: -100, issuerBalance: 98.99, convention: 'owed', threshold: 1 }).alert, true);
  assert.equal(issuerSigned(5, 'signed'), 5);
  assert.throws(() => issuerSigned(5, 'weird'), /convention/);
  assert.throws(() => issuerSigned(NaN), /finite/);
  assert.throws(() => balanceDrift({ ledgerCleared: undefined, issuerBalance: 1 }), /cleared balance is missing/);
});

// ── CLI end-to-end (offline, synthetic fixture) ──────────────────────────
const cli = (...args) => spawnSync(process.execPath, [resolve(ROOT, 'bin/bukz.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });

test('cli ghosts: JSON by default, --text human-readable', () => {
  const base = ['ghosts', '--in', 'fixtures/ghosts.json', '--account', 'Demo Card', '--allowlist', 'fixtures/ghosts-allowlist.json'];
  const j = cli(...base);
  assert.equal(j.status, 0, j.stderr);
  const body = JSON.parse(j.stdout);
  assert.equal(body.summary.flaggedPairs, 4);
  assert.equal(body.query.account, 'Demo Card');
  const t = cli(...base, '--text');
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /4 possible twin pair\(s\)/);
  assert.match(t.stdout, /Leads, not verdicts/);
});

test('cli drift: --fail-on-alert exits 2; needs exactly one issuer source', () => {
  const r = cli('drift', '--in', 'fixtures/ghosts.json', '--account', 'card', '--issuer-file', 'fixtures/ghosts-issuer.json', '--allowlist', 'fixtures/ghosts-allowlist.json', '--fail-on-alert');
  assert.equal(r.status, 2, r.stderr);
  assert.equal(JSON.parse(r.stdout).drift.explained.residualAfterTwins, 0);
  const none = cli('drift', '--in', 'fixtures/ghosts.json', '--account', 'card');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /exactly one of --issuer-balance/);
  const ok = cli('drift', '--in', 'fixtures/ghosts.json', '--account', 'card', '--issuer-balance=1128.97', '--convention', 'owed', '--fail-on-alert');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).drift.alert, false);
});

// ── read-only guard ──────────────────────────────────────────────────────
test('ghosts/drift never touch a provider (read-only by construction)', () => {
  for (const f of ['src/commands/ghosts.mjs', 'src/commands/drift.mjs', 'src/analysis/ghosts.mjs', 'src/analysis/drift.mjs', 'src/account-select.mjs', 'src/ghosts-config.mjs']) {
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /providers\/|fetch\(|saveCache|saveConfig/, `${f} must stay read-only`);
  }
});

test('fixture generator is byte-stable (writes to a temp dir, never the repo)', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(resolve(tmpdir(), 'bukz-ghosts-gen-'));
  const files = ['ghosts.json', 'ghosts-issuer.json', 'ghosts-allowlist.json'];
  const repoFile = (f) => resolve(ROOT, 'fixtures', f);
  const snapshot = Object.fromEntries(files.map((f) => [f, statSync(repoFile(f)).mtimeMs]));
  try {
    execFileSync(process.execPath, [resolve(ROOT, 'fixtures/generate-ghosts.mjs'), dir], { cwd: ROOT });
    for (const f of files) {
      assert.equal(readFileSync(resolve(dir, f), 'utf8'), readFileSync(repoFile(f), 'utf8'), f);
      assert.equal(statSync(repoFile(f)).mtimeMs, snapshot[f], `${f} in the repo must not be rewritten`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatTwinsText: no-flag output omits the verdict caveat', () => {
  const txt = formatTwinsText(findImportedTwins([]), { account: 'X' });
  assert.match(txt, /0 possible twin pair/);
  assert.doesNotMatch(txt, /Leads, not verdicts/);
});

// ── review follow-ups ────────────────────────────────────────────────────
test('ghosts: a legacy row (name only) pairs with a new row (name + accountId)', () => {
  const rows = [
    { id: 'old', date: '2026-01-01', amount: -40, payee: 'Example Shop', account: 'Demo Card', importId: 'YNAB:-40000:2026-01-01:1' },
    { id: 'new', date: '2026-01-03', amount: -40, payee: 'Example Shop', account: 'Demo Card', accountId: 'acc-card', importId: 'YNAB:-40000:2026-01-03:1' },
  ];
  assert.deepEqual(findImportedTwins(rows).flagged.map((p) => p.twin.id), ['new']);
});

test('drift: non-finite threshold is rejected', () => {
  for (const threshold of [Infinity, -Infinity, NaN, -1]) {
    assert.throws(() => balanceDrift({ ledgerCleared: -1, issuerBalance: 1, threshold }), /finite number >= 0/);
  }
  const r = cli('drift', '--in', 'fixtures/ghosts.json', '--account', 'card', '--issuer-balance=1', '--threshold', '1e309');
  assert.equal(r.status, 1);
});

test('cli drift: issuer file source is echoed; file path reported separately', () => {
  const r = cli('drift', '--in', 'fixtures/ghosts.json', '--account', 'card', '--issuer-file', 'fixtures/ghosts-issuer.json', '--allowlist', 'fixtures/ghosts-allowlist.json');
  const q = JSON.parse(r.stdout).query;
  assert.equal(q.issuerSource, 'synthetic demo');
  assert.equal(q.issuerInput, 'fixtures/ghosts-issuer.json');
});

test('cli ghosts: backfill hint ignores transfers and fires only when every eligible row lacks an import id', () => {
  const r = cli('ghosts', '--in', 'fixtures/ghosts.json', '--account', 'card', '--allowlist', 'fixtures/ghosts-allowlist.json');
  assert.equal(JSON.parse(r.stdout).hint, null);
});

test('cli ghosts: backfill hint fires for a pre-import-id cache that also holds transfers', async () => {
  const { mkdtempSync, writeFileSync: wf, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(resolve(tmpdir(), 'bukz-ghosts-'));
  try {
    const path = resolve(dir, 'legacy.json');
    wf(path, JSON.stringify({
      pulledAt: '2026-01-05T00:00:00.000Z', provider: 'fixture',
      transactions: [
        { id: 'l1', date: '2026-01-01', amount: -5, payee: 'Example Shop', account: 'Demo Card', transfer: false, provider: 'ynab' },
        { id: 'l2', date: '2026-01-02', amount: 50, payee: 'Transfer : Demo Checking', account: 'Demo Card', transfer: true },
      ],
    }));
    const r = cli('ghosts', '--in', path, '--account', 'Demo Card', '--allowlist', 'fixtures/ghosts-allowlist.json');
    assert.equal(r.status, 0, r.stderr);
    assert.match(JSON.parse(r.stdout).hint, /pull --full/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('allowlist: non-numeric amount fields and non-string payee fields are rejected', () => {
  assert.throws(() => compileAllowlist([{ maxAbsAmount: 'three' }]), /maxAbsAmount must be a finite number/);
  assert.throws(() => compileAllowlist([{ amount: Infinity }]), /amount must be a finite number/);
  assert.throws(() => compileAllowlist([{ payee: 5 }]), /payee must be a string/);
});

test('ghosts: uncleared copies are excluded from the cleared total drift uses', () => {
  const rows = [
    { id: 'a', date: '2026-01-01', amount: -40, payee: 'Example Shop', account: 'A', status: 'cleared', importId: 'YNAB:-40000:2026-01-01:1' },
    { id: 'b', date: '2026-01-03', amount: -40, payee: 'Example Shop', account: 'A', status: 'uncleared', importId: 'YNAB:-40000:2026-01-03:1' },
  ];
  const s = findImportedTwins(rows).summary;
  assert.equal(s.flaggedTwinTotal, -40);
  assert.equal(s.flaggedClearedTwinTotal, 0);
  const noStatus = rows.map((r) => ({ ...r, status: undefined }));
  assert.equal(findImportedTwins(noStatus).summary.flaggedClearedTwinTotal, 0);
  const rec = rows.map((r) => ({ ...r, status: 'reconciled' }));
  assert.equal(findImportedTwins(rec).summary.flaggedClearedTwinTotal, -40);
});

// ── owner follow-ups: account identity + backfill hint ───────────────────
const row = (id, date, extra = {}) => ({
  id, date, amount: -40, payee: 'Example Shop', account: 'Shared Name', status: 'cleared',
  importId: `YNAB:-40000:${date}:1`, importPayeeNameOriginal: 'Example Shop', ...extra,
});

test('ghosts: same-name accounts with different ids never pair', () => {
  const rows = [row('x1', '2026-02-01', { accountId: 'acc-x' }), row('y1', '2026-02-03', { accountId: 'acc-y' })];
  assert.equal(findImportedTwins(rows).flagged.length, 0);
});

test('ghosts: same-name, different-id accounts still pair within each account', () => {
  const rows = [
    row('x1', '2026-02-01', { accountId: 'acc-x' }), row('y1', '2026-02-02', { accountId: 'acc-y' }),
    row('x2', '2026-02-03', { accountId: 'acc-x' }), row('y2', '2026-02-04', { accountId: 'acc-y' }),
  ];
  const pairs = findImportedTwins(rows).flagged.map((p) => `${p.original.id}>${p.twin.id}`).sort();
  assert.deepEqual(pairs, ['x1>x2', 'y1>y2']);
});

test('ghosts: an old row without accountId pairs with a new row on the same account name', () => {
  const rows = [row('old', '2026-02-01'), row('new', '2026-02-03', { accountId: 'acc-x' })];
  assert.deepEqual(findImportedTwins(rows).flagged.map((p) => `${p.original.id}>${p.twin.id}`), ['old>new']);
});

const ghostsOn = async (transactions) => {
  const { mkdtempSync, writeFileSync: wf, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(resolve(tmpdir(), 'bukz-ghosts-hint-'));
  try {
    const path = resolve(dir, 'cache.json');
    wf(path, JSON.stringify({ pulledAt: '2026-02-05T00:00:00.000Z', provider: 'fixture', transactions }));
    const r = cli('ghosts', '--in', path, '--account', 'Demo Card', '--allowlist', 'fixtures/ghosts-allowlist.json');
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('cli ghosts: no backfill hint for a manual-only account (importId: null)', async () => {
  const body = await ghostsOn([
    { id: 'm1', date: '2026-02-01', amount: -5, payee: 'Example Shop', account: 'Demo Card', importId: null, transfer: false },
    { id: 'm2', date: '2026-02-02', amount: -6, payee: 'Example Shop', account: 'Demo Card', importId: null, transfer: false },
  ]);
  assert.equal(body.hint, null);
  assert.equal(body.summary.rowsMissingImportField, 0);
  assert.equal(body.summary.rowsWithoutImportId, 2);
});

test('cli ghosts: backfill hint counts only rows cached without the importId field', async () => {
  const body = await ghostsOn([
    { id: 'l1', date: '2026-02-01', amount: -5, payee: 'Example Shop', account: 'Demo Card', transfer: false, provider: 'ynab' },
    { id: 'm1', date: '2026-02-02', amount: -6, payee: 'Example Shop', account: 'Demo Card', importId: null, transfer: false },
    { id: 'i1', date: '2026-02-03', amount: -7, payee: 'Example Shop', account: 'Demo Card', importId: 'YNAB:-7000:2026-02-03:1', transfer: false },
    { id: 't1', date: '2026-02-04', amount: 50, payee: 'Transfer', account: 'Demo Card', transfer: true },
  ]);
  assert.equal(body.summary.rowsMissingImportField, 1);
  assert.match(body.hint, /^1 row\(s\) were cached before import ids were kept.*pull --full/);
});

test('ghosts: cleared twin total needs BOTH rows cleared (uncleared original + cleared copy counts once)', () => {
  const rows = [
    row('o', '2026-02-01', { status: 'uncleared' }),
    row('c', '2026-02-03', { status: 'cleared' }),
  ];
  const s = findImportedTwins(rows).summary;
  assert.equal(s.flaggedPairs, 1);
  assert.equal(s.flaggedClearedTwinTotal, 0);
});

test('cli ghosts: no backfill hint for a provider that never has import ids (Xero)', async () => {
  const body = await ghostsOn([
    { id: 'x1', date: '2026-02-01', amount: -5, payee: 'Example Shop', account: 'Demo Card', transfer: false, provider: 'xero' },
  ]);
  assert.equal(body.hint, null);
  assert.equal(body.summary.rowsMissingImportField, 0);
});
