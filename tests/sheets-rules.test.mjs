import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseBillsGrid, parseRulesGrid } from '../src/sheets/parse.mjs';
import { loadHubFixture } from '../src/sheets/client.mjs';
import { resolveSheetsCredentials, sheetsConfigured } from '../src/sheets/auth.mjs';
import { checkCuratedRules } from '../src/analysis/curated-rules.mjs';
import { saveConfig, loadConfig, configPath } from '../src/config.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const fixture = JSON.parse(readFileSync(join(ROOT, 'fixtures/sample.json'), 'utf8'));
const curatedRules = JSON.parse(readFileSync(join(ROOT, 'fixtures/rules.json'), 'utf8'));
const sheetsHub = JSON.parse(readFileSync(join(ROOT, 'fixtures/sheets-hub.json'), 'utf8'));

// ── sheet grid parsers ────────────────────────────────────────────────

test('parseBillsGrid: maps hub columns to bills.json shape', () => {
  const bills = parseBillsGrid(sheetsHub.bills.values);
  assert.equal(bills.length, 7);
  const rent = bills.find((b) => b.name === 'Maple Property Management');
  assert.equal(rent.amount, 1800);
  assert.equal(rent.cadence, 'monthly');
  assert.equal(rent.dayOfMonth, 1);
  assert.equal(rent.autopay, 'yes');
  assert.equal(rent.active, true);
  const water = bills.find((b) => b.name === 'Riverside Water & Sewer');
  assert.equal(water.month, 2);
  assert.equal(water.cadence, 'quarterly');
  const cleaner = bills.find((b) => b.name === 'Lakeside Cleaner');
  assert.equal(cleaner.anchor, '2026-01-05');
  assert.equal(cleaner.cadence, 'biweekly');
  const insurance = bills.find((b) => b.name === 'Hometown Insurance');
  assert.equal(insurance.amount, null);
  const retired = bills.find((b) => b.name === 'Retired Gym');
  assert.equal(retired.active, false);
});

test('parseRulesGrid: maps hub columns; skips empty payee; respects active', () => {
  const rules = parseRulesGrid(sheetsHub.rules.values);
  assert.equal(rules.length, 4); // empty-payee row skipped
  const netflix = rules.find((r) => r.payee === 'Netflix');
  assert.equal(netflix.category, 'Subscriptions');
  assert.equal(netflix.active, true);
  const retired = rules.find((r) => r.payee === 'Retired Example Payee');
  assert.equal(retired.active, false);
  assert.ok(!rules.some((r) => r.category === 'ShouldSkip'));
});

test('parseRulesGrid: accepts payeePattern header alias', () => {
  const rules = parseRulesGrid([
    ['payeePattern', 'category', 'active'],
    ['Acme', 'Income', 'yes'],
  ]);
  assert.equal(rules[0].payee, 'Acme');
});

test('parseBillsGrid: missing name header throws', () => {
  assert.throws(() => parseBillsGrid([['amount', 'cadence'], ['1', 'monthly']]), /name/);
});

test('loadHubFixture: same parsers as live path', () => {
  const hub = loadHubFixture(sheetsHub);
  assert.equal(hub.source.kind, 'fixture');
  assert.equal(hub.bills.length, 7);
  assert.equal(hub.rules.length, 4);
});

// ── curated rule-check (plants reuse Netflix / Staples from sample.json) ─

test('rule-check: flags Netflix Groceries as a violation (PLANT 1)', () => {
  const { violations, summary } = checkCuratedRules(fixture.transactions, curatedRules);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].payee, 'Netflix');
  assert.equal(violations[0].category, 'Groceries');
  assert.equal(violations[0].expectedCategory, 'Subscriptions');
  assert.equal(violations[0].account, 'Demo Checking');
  assert.equal(summary.violations, 1);
});

test('rule-check: Staples uncategorized row is a lead, not a violation', () => {
  const { uncategorized, violations } = checkCuratedRules(fixture.transactions, curatedRules);
  assert.equal(uncategorized.length, 1);
  assert.equal(uncategorized[0].payee, 'Staples');
  assert.equal(uncategorized[0].category, null);
  assert.equal(uncategorized[0].expectedCategory, 'Office Supplies');
  assert.equal(uncategorized[0].account, 'Demo Checking');
  assert.ok(!violations.some((v) => v.payee === 'Staples'));
});

test('rule-check: inactive Starbucks rule does not invent violations', () => {
  const { violations } = checkCuratedRules(fixture.transactions, curatedRules);
  assert.ok(!violations.some((v) => v.payee === 'Starbucks'));
});

test('rule-check: ghost payee with no transactions yields no findings', () => {
  const { violations, uncategorized, matches } = checkCuratedRules(
    fixture.transactions,
    curatedRules
  );
  assert.ok(!violations.some((v) => v.payee === 'Ghost Payee Never Seen'));
  assert.ok(!uncategorized.some((v) => v.payee === 'Ghost Payee Never Seen'));
  assert.ok(!matches.some((v) => v.payee === 'Ghost Payee Never Seen'));
});

test('rule-check: healthy AWS rows land in matches; transfers excluded', () => {
  const { matches, summary } = checkCuratedRules(fixture.transactions, curatedRules);
  const aws = matches.filter((m) => m.payee === 'Amazon Web Services');
  assert.ok(aws.length >= 1);
  assert.ok(aws.every((m) => m.category === 'Software' && m.account));
  // Transfers exist in the fixture (PLANT 10) but must not appear.
  assert.ok(!matches.some((m) => m.payee && String(m.payee).startsWith('Transfer')));
  assert.ok(summary.matches >= aws.length);
});

test('rule-check: includeMatches false omits matches list but keeps summary count', () => {
  const result = checkCuratedRules(fixture.transactions, curatedRules, {
    includeMatches: false,
  });
  assert.equal(result.matches, undefined);
  assert.equal(result.violations.length, 1);
  assert.ok(result.summary.matches > 0);
});

test('rule-check: output is deterministic regardless of txn order', () => {
  const a = checkCuratedRules(fixture.transactions, curatedRules);
  const b = checkCuratedRules([...fixture.transactions].reverse(), curatedRules);
  assert.deepEqual(a.violations, b.violations);
  assert.deepEqual(a.uncategorized, b.uncategorized);
  assert.deepEqual(
    a.matches.map((m) => m.id),
    b.matches.map((m) => m.id)
  );
});

// ── config atomic write ───────────────────────────────────────────────

test('saveConfig: round-trips and leaves no .tmp behind', () => {
  // saveConfig always writes under ROOT/config — use a unique filename so we
  // don't clobber a developer's real bills.json, then clean up.
  const file = `_test_rules_${Date.now()}.json`;
  const path = configPath(file);
  try {
    saveConfig(file, [{ payee: 'X', category: 'Y', active: true }]);
    assert.deepEqual(loadConfig(file), [{ payee: 'X', category: 'Y', active: true }]);
    assert.equal(existsSync(path + '.tmp'), false);
  } finally {
    rmSync(path, { force: true });
    rmSync(path + '.tmp', { force: true });
  }
});

// ── CLI demo paths (no live Google credentials) ───────────────────────

function runBukz(args, env = {}) {
  return spawnSync(process.execPath, [join(ROOT, 'bin/bukz.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('CLI sync-config --from writes bills.json + rules.json via fixture', () => {
  // Isolate writes: copy ROOT is heavy; instead write into real config/ with
  // known names and restore afterward if pre-existing files existed.
  const billsPath = configPath('bills.json');
  const rulesPath = configPath('rules.json');
  const backupDir = mkdtempSync(join(tmpdir(), 'bukz-cfg-'));
  const hadBills = existsSync(billsPath);
  const hadRules = existsSync(rulesPath);
  try {
    if (hadBills) cpSync(billsPath, join(backupDir, 'bills.json'));
    if (hadRules) cpSync(rulesPath, join(backupDir, 'rules.json'));

    const res = runBukz(['sync-config', '--from', 'fixtures/sheets-hub.json']);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.meta.source.kind, 'fixture');
    assert.equal(out.written.bills.count, 7);
    assert.equal(out.written.rules.count, 4);
    assert.ok(existsSync(billsPath));
    assert.ok(existsSync(rulesPath));
    const rules = JSON.parse(readFileSync(rulesPath, 'utf8'));
    assert.equal(rules.find((r) => r.payee === 'Netflix').category, 'Subscriptions');
  } finally {
    if (hadBills) cpSync(join(backupDir, 'bills.json'), billsPath);
    else rmSync(billsPath, { force: true });
    if (hadRules) cpSync(join(backupDir, 'rules.json'), rulesPath);
    else rmSync(rulesPath, { force: true });
    rmSync(backupDir, { recursive: true, force: true });
  }
});

test('CLI rule-check demo path flags Netflix + Staples with account', () => {
  const res = runBukz([
    'rule-check',
    '--in',
    'fixtures/sample.json',
    '--rules',
    'fixtures/rules.json',
    '--violations-only',
  ]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.summary.violations, 1);
  assert.equal(out.violations[0].payee, 'Netflix');
  assert.equal(out.violations[0].account, 'Demo Checking');
  assert.equal(out.uncategorized[0].payee, 'Staples');
  assert.equal(out.matches, undefined);
  assert.ok(out.meta.provider);
});

test('CLI check reports Sheets env booleans without secrets', () => {
  const res = runBukz(['check'], {
    GOOGLE_SERVICE_ACCOUNT_FILE: '',
    GOOGLE_SHEETS_SPREADSHEET_ID: '',
  });
  // check may exit 0 even when provider auth fails — it prints the report.
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(typeof out.env.GOOGLE_SERVICE_ACCOUNT_FILE, 'boolean');
  assert.equal(typeof out.env.GOOGLE_SHEETS_SPREADSHEET_ID, 'boolean');
  assert.equal(typeof out.env.BUKZ_API_KEY, 'boolean');
  assert.equal(out.sheets.configured, false);
  assert.equal(out.sheets.ok, false);
  // Never leak a path/token string into env block values that aren't the
  // YNAB_BUDGET_ID sentinel.
  assert.ok(!JSON.stringify(out.env).includes('BEGIN PRIVATE KEY'));
});

test('CLI check never prints BUKZ_API_KEY', () => {
  const marker = 'test-feed-key-not-real';
  const res = runBukz(['check'], { BUKZ_API_KEY: marker });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.env.BUKZ_API_KEY, true);
  assert.equal(res.stdout.includes(marker), false);
  assert.equal(res.stderr.includes(marker), false);
});

// ── PM acceptance: flags > .env; local config preferred; fixtures untouched ─

test('resolveSheetsCredentials: CLI flags win over env (no .env file needed)', () => {
  const prevFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  const prevId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  try {
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE = '/env/sa.json';
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'env-sheet-id';
    const creds = resolveSheetsCredentials({
      serviceAccountFile: '/flag/sa.json',
      spreadsheetId: 'flag-sheet-id',
      billsTab: 'HubBills',
      rulesTab: 'HubRules',
    });
    assert.equal(creds.serviceAccountFile, '/flag/sa.json');
    assert.equal(creds.spreadsheetId, 'flag-sheet-id');
    assert.equal(creds.billsTab, 'HubBills');
    assert.equal(creds.rulesTab, 'HubRules');
    assert.equal(sheetsConfigured({
      serviceAccountFile: '/flag/sa.json',
      spreadsheetId: 'flag-sheet-id',
    }), true);
  } finally {
    if (prevFile === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    else process.env.GOOGLE_SERVICE_ACCOUNT_FILE = prevFile;
    if (prevId === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = prevId;
  }
});

test('CLI sync-config without flags/env errors with flag guidance (not .env edit)', () => {
  const res = runBukz(['sync-config'], {
    GOOGLE_SERVICE_ACCOUNT_FILE: '',
    GOOGLE_SHEETS_SPREADSHEET_ID: '',
  });
  assert.notEqual(res.status, 0);
  const msg = `${res.stderr}${res.stdout}`;
  assert.match(msg, /--service-account|--spreadsheet-id|fixtures\/sheets-hub/);
  assert.doesNotMatch(msg, /edit \.env|set the path in \.env|rewrite \.env/i);
});

test('CLI sync-config --from reports localConfigPreferred (hydrate, not live dep)', () => {
  const billsPath = configPath('bills.json');
  const rulesPath = configPath('rules.json');
  const backupDir = mkdtempSync(join(tmpdir(), 'bukz-cfg2-'));
  const hadBills = existsSync(billsPath);
  const hadRules = existsSync(rulesPath);
  try {
    if (hadBills) cpSync(billsPath, join(backupDir, 'bills.json'));
    if (hadRules) cpSync(rulesPath, join(backupDir, 'rules.json'));
    const res = runBukz(['sync-config', '--from', 'fixtures/sheets-hub.json'], {
      GOOGLE_SERVICE_ACCOUNT_FILE: '',
      GOOGLE_SHEETS_SPREADSHEET_ID: '',
    });
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.meta.localConfigPreferred, true);
    // Hydrated files are what loadConfig would read next.
    assert.ok(existsSync(billsPath));
    assert.ok(existsSync(rulesPath));
    assert.equal(loadConfig('rules.json').find((r) => r.payee === 'Netflix').category, 'Subscriptions');
  } finally {
    if (hadBills) cpSync(join(backupDir, 'bills.json'), billsPath);
    else rmSync(billsPath, { force: true });
    if (hadRules) cpSync(join(backupDir, 'rules.json'), rulesPath);
    else rmSync(rulesPath, { force: true });
    rmSync(backupDir, { recursive: true, force: true });
  }
});

test('demo fixtures sample.json + bills.json are unchanged planted contents', () => {
  // Acceptance: this PR must not alter planted demo fixtures — only add
  // separate curated-rules / sheets-hub fixtures.
  const sample = JSON.parse(readFileSync(join(ROOT, 'fixtures/sample.json'), 'utf8'));
  const bills = JSON.parse(readFileSync(join(ROOT, 'fixtures/bills.json'), 'utf8'));
  assert.equal(sample.transactions.length, 85);
  assert.ok(
    sample.transactions.some((t) => t.payee === 'Netflix' && t.category === 'Groceries')
  );
  // fixtures/bills.json planted names (do not rewrite this file in this PR)
  const names = bills.map((b) => b.name);
  assert.ok(names.includes('Gym Membership'));
  assert.ok(names.includes('Property Tax'));
  assert.equal(bills.length, 6);
  assert.ok(existsSync(join(ROOT, 'fixtures/rules.json')));
  assert.ok(existsSync(join(ROOT, 'fixtures/sheets-hub.json')));
});
