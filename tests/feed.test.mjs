import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isUncategorized } from '../src/analysis/categorization.mjs';
import {
  amountsUnlocked,
  buildFeed,
  clampFeedLimit,
  fundingBand,
  leakHits,
  liabilityInCopy,
  sealFeed,
  sensitiveStrings,
} from '../src/feed/feed.mjs';
import { startFeedServer } from '../src/feed/server.mjs';
import { startServer } from '../src/server.mjs';
import {
  assertFeedHost,
  feedNonLoopbackAllowed,
  isLoopbackHost,
} from '../src/commands/feed-serve.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/sample.json', import.meta.url), 'utf8'));
const BILLS = JSON.parse(readFileSync(new URL('../fixtures/bills.json', import.meta.url), 'utf8'));
const FIXTURE_PATH = resolve(import.meta.dirname, '..', 'fixtures', 'sample.json');
const BILLS_PATH = resolve(import.meta.dirname, '..', 'fixtures', 'bills.json');
const FRESH = new Date('2026-07-05T12:00:00.000Z');

const KINDS = ['cash_outlook', 'uncategorized', 'bill_coverage', 'budget_funding', 'variance_flag'];

test('isUncategorized: null, blank, label, and missing id', () => {
  assert.equal(isUncategorized({ category: null, categoryId: null }), true);
  assert.equal(isUncategorized({ category: '', categoryId: 'x' }), true);
  assert.equal(isUncategorized({ category: '  ', categoryId: 'x' }), true);
  assert.equal(isUncategorized({ category: 'Uncategorized', categoryId: 'u' }), true);
  assert.equal(isUncategorized({ category: ' uncategorized ', categoryId: 'u' }), true);
  assert.equal(isUncategorized({ category: 'Groceries', categoryId: null }), true);
  assert.equal(isUncategorized({ category: 'Groceries', categoryId: '' }), true);
  assert.equal(isUncategorized({ category: 'Groceries', categoryId: 'Groceries' }), false);
  assert.equal(isUncategorized(null), false);
});

test('clampFeedLimit: 1–50, default 10', () => {
  assert.equal(clampFeedLimit(undefined), 10);
  assert.equal(clampFeedLimit(null), 10);
  assert.equal(clampFeedLimit(''), 10);
  assert.equal(clampFeedLimit('nope'), 10);
  assert.equal(clampFeedLimit('0'), 1);
  assert.equal(clampFeedLimit('-3'), 1);
  assert.equal(clampFeedLimit('1'), 1);
  assert.equal(clampFeedLimit('50'), 50);
  assert.equal(clampFeedLimit('51'), 50);
  assert.equal(clampFeedLimit(10.9), 10);
});

test('fundingBand: only hold, partial, funded', () => {
  assert.equal(fundingBand(null), 'hold');
  assert.equal(fundingBand(0), 'hold');
  assert.equal(fundingBand(-1), 'hold');
  assert.equal(fundingBand(1), 'partial');
  assert.equal(fundingBand(99), 'partial');
  assert.equal(fundingBand(100), 'funded');
  assert.equal(fundingBand(140), 'funded');
});

test('buildFeed: synthetic cache produces all five kinds without deny-list leaks', () => {
  const cache = {
    pulledAt: '2026-09-19T12:00:00.000Z',
    transactions: [
      { id: 'txn-secret-1', date: '2026-09-10', amount: -40, payee: 'Hidden Merchant', category: null, categoryId: null, account: 'Hidden Bank', transfer: false },
      { id: 'txn-secret-2', date: '2026-09-10', amount: -80, payee: 'Hidden Merchant', category: 'Food', categoryId: 'cat-food', account: 'Hidden Bank', transfer: false },
      { id: 'txn-secret-3', date: '2026-09-10', amount: -5, payee: 'Hidden Merchant', category: 'Rentcat', categoryId: 'cat-rent', account: 'Hidden Bank', transfer: false },
      { id: 'txn-secret-4', date: '2026-09-01', amount: -1, payee: 'Other Merchant', category: '', categoryId: 'cat-blank', account: 'Hidden Bank', transfer: false },
      { id: 'txn-secret-5', date: '2026-09-02', amount: -1, payee: 'Other Merchant', category: 'Uncategorized', categoryId: 'cat-label', account: 'Hidden Bank', transfer: false },
      { id: 'txn-secret-6', date: '2026-09-03', amount: -1, payee: 'Other Merchant', category: 'Named', categoryId: null, account: 'Hidden Bank', transfer: false },
      { id: 'txn-secret-xfer', date: '2026-09-04', amount: -9, payee: 'Hidden Merchant', category: null, categoryId: null, account: 'Hidden Bank', transfer: true },
    ],
    categories: [
      { id: 'cat-food', name: 'Food', group: 'Living' },
      { id: 'cat-rent', name: 'Rentcat', group: 'Shelter' },
    ],
    accounts: [{ id: 'acct-hidden', name: 'Hidden Bank', closed: false, balance: 10, type: 'checking' }],
    budgetMonths: [
      {
        month: '2026-08',
        categories: [
          { id: 'cat-food', name: 'Food', budgeted: 50 },
          { id: 'cat-rent', name: 'Rentcat', budgeted: 50 },
        ],
      },
      {
        month: '2026-09',
        categories: [
          { id: 'cat-food', name: 'Food', budgeted: 10 },
          { id: 'cat-rent', name: 'Rentcat', budgeted: 20 },
        ],
      },
      {
        month: '2026-10',
        categories: [
          { id: 'cat-food', name: 'Food', budgeted: 20 },
          { id: 'cat-rent', name: 'Rentcat', budgeted: 20 },
        ],
      },
    ],
  };
  const bills = [{
    name: 'Hidden Bill',
    amount: 100,
    cadence: 'monthly',
    dayOfMonth: 15,
    paidFrom: 'Hidden Bank',
    autopay: 'yes',
    active: true,
  }];
  const now = new Date('2026-09-19T12:00:00.000Z');
  const { items, fetchedAt } = buildFeed({ cache, bills, now, limit: 50 });

  assert.equal(fetchedAt, now.toISOString());
  const kinds = new Set(items.map((item) => item.meta.kind));
  for (const kind of KINDS) assert.ok(kinds.has(kind), kind);

  const cash = items.find((item) => item.meta.kind === 'cash_outlook');
  assert.equal(items.filter((item) => item.meta.kind === 'cash_outlook').length, 1);
  assert.equal(cash.title, 'Cash outlook');
  assert.match(cash.summary, /Overall light is red/);
  assert.equal(cash.meta.liabilityWatch, 'true');
  assert.equal(cash.meta.status, undefined);
  assert.equal(cash.status, 'ok');
  assert.equal(cash.meta.cacheAge, '0');

  const inbox = items.find((item) => item.meta.kind === 'uncategorized');
  assert.equal(inbox.meta.count, '4');
  assert.equal(inbox.meta.month, '2026-09');

  const billsItem = items.find((item) => item.meta.kind === 'bill_coverage');
  assert.equal(billsItem.meta.coverage, 'short');
  assert.equal(billsItem.meta.windowDays, '14');

  const funding = items.find((item) => item.meta.kind === 'budget_funding');
  assert.equal(funding.meta.band, 'partial');
  assert.equal(funding.id, 'bukz:budget_funding:2026-10');

  const flags = items.filter((item) => item.meta.kind === 'variance_flag');
  assert.deepEqual(
    flags.map((item) => [item.meta.group, item.meta.direction]),
    [['Living', 'over'], ['Shelter', 'under']]
  );
  assert.equal(flags[0].title, 'Living is over');
  assert.match(flags[0].id, /^bukz:variance_flag:2026-09:living$/);

  assertClean(items, cache, bills);
});

test('buildFeed: fixture cache matches outlook, inbox, and funding enums', () => {
  const { items } = buildFeed({ cache: FIXTURE, bills: BILLS, now: FRESH, limit: 50 });
  const cash = items.find((item) => item.meta.kind === 'cash_outlook');
  const inbox = items.find((item) => item.meta.kind === 'uncategorized');
  const coverage = items.find((item) => item.meta.kind === 'bill_coverage');
  const funding = items.find((item) => item.meta.kind === 'budget_funding');
  const flags = items.filter((item) => item.meta.kind === 'variance_flag');

  assert.equal(cash.title, 'Cash outlook');
  assert.match(cash.summary, /Overall light is red/);
  assert.equal(cash.meta.liabilityWatch, 'true');
  assert.equal(cash.meta.status, undefined);
  assert.equal(inbox.meta.count, '1');
  assert.equal(inbox.meta.month, '2026-07');
  assert.equal(coverage.meta.coverage, 'short');
  assert.equal(coverage.meta.windowDays, '14');
  assert.equal(funding.meta.band, 'partial');
  assert.equal(funding.meta.fundedPct, undefined);
  assert.ok(flags.length >= 1);
  for (const flag of flags) {
    assert.ok(flag.meta.direction === 'over' || flag.meta.direction === 'under');
    assert.match(flag.title, new RegExp(flag.meta.group));
  }
  assertClean(items, FIXTURE, BILLS);
});

test('buildFeed: cache older than 6h is stub but still the last cache', () => {
  const now = new Date('2026-07-05T19:00:00.000Z');
  const { items } = buildFeed({ cache: FIXTURE, bills: BILLS, now, limit: 10 });
  assert.ok(items.every((item) => item.status === 'stub'));
  assert.match(items[0].summary, /Overall light is red/);
  assert.equal(items[0].meta.liabilityWatch, 'true');
  assert.equal(items[0].meta.cacheAge, String(7 * 60 * 60));
});

test('buildFeed: exactly 6h is still ok', () => {
  const now = new Date('2026-07-05T18:00:00.000Z');
  const { items } = buildFeed({ cache: FIXTURE, bills: BILLS, now, limit: 1 });
  assert.equal(items[0].status, 'ok');
  assert.equal(items[0].meta.cacheAge, String(6 * 60 * 60));
});

test('buildFeed: no cache returns five placeholder kinds', () => {
  const now = new Date('2026-09-19T15:00:00.000Z');
  const { items } = buildFeed({ cache: null, now, limit: 50 });
  assert.equal(items.length, 5);
  assert.deepEqual(items.map((item) => item.meta.kind), KINDS);
  assert.ok(items.every((item) => item.status === 'stub'));
  assert.match(items[0].summary, /Overall light is yellow/);
  assert.equal(items[0].meta.liabilityWatch, 'false');
  assertProductLock(items);
});

test('buildFeed: clear books map to green, covered, and funded', () => {
  const cache = {
    pulledAt: '2026-09-19T12:00:00.000Z',
    transactions: [
      {
        id: 'row-1',
        date: '2026-09-10',
        amount: -5,
        payee: 'Quiet Merchant',
        category: 'Food',
        categoryId: 'cat-food',
        account: 'Quiet Bank',
        transfer: false,
      },
    ],
    categories: [{ id: 'cat-food', name: 'Food', group: 'Living' }],
    accounts: [{ id: 'acct-quiet', name: 'Quiet Bank', closed: false, balance: 5000, type: 'checking' }],
    budgetMonths: [
      { month: '2026-08', categories: [{ id: 'cat-food', name: 'Food', budgeted: 20 }] },
      { month: '2026-09', categories: [{ id: 'cat-food', name: 'Food', budgeted: 20 }] },
      { month: '2026-10', categories: [{ id: 'cat-food', name: 'Food', budgeted: 20 }] },
    ],
  };
  const now = new Date('2026-09-19T12:00:00.000Z');
  const { items } = buildFeed({ cache, bills: [], now, limit: 50 });
  const cash = items.find((item) => item.meta.kind === 'cash_outlook');
  assert.match(cash.summary, /Overall light is green/);
  assert.equal(cash.meta.liabilityWatch, 'false');
  assert.equal(items.find((item) => item.meta.kind === 'bill_coverage').meta.coverage, 'covered');
  assert.equal(items.find((item) => item.meta.kind === 'bill_coverage').meta.windowDays, '14');
  assert.equal(items.find((item) => item.meta.kind === 'budget_funding').meta.band, 'funded');
  assert.equal(items.find((item) => item.meta.kind === 'variance_flag').meta.direction, 'under');
  assert.equal(JSON.stringify(items).includes('5000'), false);
  assertClean(items, cache, []);

  const blind = buildFeed({ cache: { ...cache, accounts: [] }, bills: [], now, limit: 50 });
  const blindCash = blind.items.find((item) => item.meta.kind === 'cash_outlook');
  assert.match(blindCash.summary, /Overall light is yellow/);
  assert.equal(blindCash.meta.liabilityWatch, 'false');
  assert.equal(blind.items.find((item) => item.meta.kind === 'bill_coverage').meta.coverage, 'watch');
});

test('buildFeed: amounts=1 does not unlock fundedPct or dollar figures in v0 kinds', () => {
  assert.equal(amountsUnlocked(undefined), false);
  assert.equal(amountsUnlocked('0'), false);
  assert.equal(amountsUnlocked('1'), true);
  assert.equal(amountsUnlocked(1), true);
  for (const amounts of [false, true, '1']) {
    const body = buildFeed({ cache: FIXTURE, bills: BILLS, now: FRESH, limit: 50, amounts });
    assert.equal(JSON.stringify(body).includes('$'), false);
    assert.equal(hasKey(body, 'fundedPct'), false);
    assertProductLock(body.items);
  }
});

test('sealFeed: liability wording in the title is dropped, and the flag stays in meta', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  const sealed = sealFeed(
    {
      items: [{
        id: 'bukz:cash_outlook:2026-09-01',
        source: 'bukz',
        title: 'Cash outlook',
        summary: 'A liability is due.',
        occurredAt: now.toISOString(),
        status: 'ok',
        meta: { kind: 'cash_outlook', liabilityWatch: 'true', fundedPct: '35' },
      }],
      fetchedAt: now.toISOString(),
    },
    [],
    now
  );
  assert.equal(liabilityInCopy(sealed.items), false);
  assert.equal(hasKey(sealed, 'fundedPct'), false);
  assert.equal(JSON.stringify(sealed).includes('$'), false);
  const cash = sealed.items.find((item) => item.meta.kind === 'cash_outlook');
  assert.equal(cash.meta.liabilityWatch, 'false');
  assert.equal(`${cash.title} ${cash.summary}`.toLowerCase().includes('liability'), false);
});

test('buildFeed: limit keeps the cash outlook first', () => {
  const { items } = buildFeed({ cache: FIXTURE, bills: BILLS, now: FRESH, limit: 1 });
  assert.equal(items.length, 1);
  assert.equal(items[0].meta.kind, 'cash_outlook');
});

test('sealFeed: a leaked payload becomes generic error items', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  const sealed = sealFeed(
    {
      items: [{
        id: 'bukz:cash_outlook:2026-09-01',
        source: 'bukz',
        title: 'Paid Hidden Merchant $12.50',
        occurredAt: now.toISOString(),
        status: 'ok',
        meta: { kind: 'cash_outlook', status: 'red' },
      }],
      fetchedAt: now.toISOString(),
    },
    ['Hidden Merchant'],
    now
  );
  const blob = JSON.stringify(sealed);
  assert.equal(blob.includes('Hidden'), false);
  assert.equal(blob.includes('$'), false);
  assert.equal(blob.includes('12.50'), false);
  assert.ok(sealed.items.every((item) => item.status === 'error'));
  assert.equal(sealed.items.length, 5);
});

test('feed http: missing or wrong bearer is 401; good bearer is 200', async (t) => {
  const server = await startFeedServer({
    port: 0,
    dataPath: FIXTURE_PATH,
    billsPath: BILLS_PATH,
    apiKey: 'test-feed-key',
    now: () => FRESH,
  });
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const missing = await fetch(base + '/api/feed/recent');
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: 'unauthorized' });

  const wrong = await fetch(base + '/api/feed/recent', {
    headers: { Authorization: 'Bearer wrong-key' },
  });
  assert.equal(wrong.status, 401);

  const queryKey = await fetch(base + '/api/feed/recent?api_key=test-feed-key');
  assert.equal(queryKey.status, 401);

  const ok = await fetch(base + '/api/feed/recent?limit=10', {
    headers: { Authorization: 'bearer test-feed-key' },
  });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /application\/json/);
  const body = await ok.json();
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.length >= 1);
  assert.equal(body.items[0].source, 'bukz');
  assert.equal(body.fetchedAt, FRESH.toISOString());
  assert.equal(JSON.stringify(body).includes('$'), false);
  assert.equal(JSON.stringify(body).includes('test-feed-key'), false);

  const one = await fetch(base + '/api/feed/recent?limit=1', {
    headers: { Authorization: 'Bearer test-feed-key' },
  });
  const oneBody = await one.json();
  assert.equal(oneBody.items.length, 1);

  const unlocked = await fetch(base + '/api/feed/recent?amounts=1', {
    headers: { Authorization: 'Bearer test-feed-key' },
  });
  const unlockedBody = await unlocked.json();
  assert.equal(unlocked.status, 200);
  assert.equal(JSON.stringify(unlockedBody).includes('$'), false);
  assert.equal(JSON.stringify(unlockedBody).includes('fundedPct'), false);
  assertProductLock(unlockedBody.items);

  const post = await fetch(base + '/api/feed/recent', { method: 'POST' });
  assert.equal(post.status, 405);
  const other = await fetch(base + '/api/data', {
    headers: { Authorization: 'Bearer test-feed-key' },
  });
  assert.equal(other.status, 404);
});

test('feed http: unset key rejects even a blank bearer', async (t) => {
  const server = await startFeedServer({
    port: 0,
    dataPath: FIXTURE_PATH,
    billsPath: BILLS_PATH,
    apiKey: '',
  });
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(base + '/api/feed/recent', {
    headers: { Authorization: 'Bearer ' },
  });
  assert.equal(res.status, 401);
});

test('feed http: missing cache is stubs, not a 500', async (t) => {
  const server = await startFeedServer({
    port: 0,
    dataPath: resolve(import.meta.dirname, 'no-such-cache.json'),
    billsPath: resolve(import.meta.dirname, 'no-such-bills.json'),
    apiKey: 'test-feed-key',
  });
  t.after(() => new Promise((done) => server.close(done)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/feed/recent`, {
    headers: { Authorization: 'Bearer test-feed-key' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 5);
  assert.ok(body.items.every((item) => item.status === 'stub'));
  assert.equal(JSON.stringify(body).includes('$'), false);
});

test('feed http: omitted apiKey uses BUKZ_API_KEY from the environment', async (t) => {
  const prev = process.env.BUKZ_API_KEY;
  process.env.BUKZ_API_KEY = 'env-feed-key';
  t.after(() => {
    if (prev === undefined) delete process.env.BUKZ_API_KEY;
    else process.env.BUKZ_API_KEY = prev;
  });
  const server = await startFeedServer({
    port: 0,
    dataPath: FIXTURE_PATH,
    billsPath: BILLS_PATH,
  });
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}/api/feed/recent`;
  const missing = await fetch(base);
  assert.equal(missing.status, 401);
  const ok = await fetch(base, { headers: { Authorization: 'Bearer env-feed-key' } });
  assert.equal(ok.status, 200);
  assert.equal(JSON.stringify(await ok.json()).includes('env-feed-key'), false);
});

test('dashboard serve does not expose the feed', async (t) => {
  const server = await startServer({ port: 0, dataPath: FIXTURE_PATH, billsPath: BILLS_PATH });
  t.after(() => new Promise((done) => server.close(done)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/feed/recent`);
  assert.notEqual(res.status, 200);
});

function assertProductLock(items) {
  const blob = JSON.stringify(items);
  assert.equal(blob.includes('$'), false);
  assert.equal(hasKey(items, 'fundedPct'), false);
  assert.equal(liabilityInCopy(items), false);
  const cash = items.filter((item) => item.meta?.kind === 'cash_outlook');
  if (items.length) assert.ok(cash.length <= 1);
  for (const item of items) {
    const copy = `${item.title ?? ''}\n${item.summary ?? ''}`;
    assert.equal(copy.toLowerCase().includes('liability'), false);
    if (Object.prototype.hasOwnProperty.call(item.meta ?? {}, 'liabilityWatch')) {
      assert.equal(item.meta.kind, 'cash_outlook');
      assert.ok(item.meta.liabilityWatch === 'true' || item.meta.liabilityWatch === 'false');
    }
    const { meta, ...rest } = item;
    assert.equal(JSON.stringify(rest).toLowerCase().includes('liability'), false);
    assert.equal(meta.fundedPct, undefined);
  }
}

function hasKey(value, key) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => hasKey(entry, key));
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((entry) => hasKey(entry, key));
}

function assertClean(items, cache, bills) {
  const blob = JSON.stringify(items);
  assert.equal(blob.includes('$'), false);
  assert.doesNotMatch(blob, /(?<!\d)\d+\.\d{2}(?!\d)/);
  assert.doesNotMatch(blob, /ready to assign/i);
  assertProductLock(items);
  const hits = leakHits(items, sensitiveStrings(cache, bills));
  assert.deepEqual(hits, []);
  for (const item of items) {
    assert.equal(item.source, 'bukz');
    assert.equal('href' in item, false);
    assert.match(item.id, /^bukz:[a-z0-9_:-]+$/);
    assert.ok(!item.id.includes('txn-'));
    assert.ok(!item.id.includes('fx-'));
    assert.match(item.occurredAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(item.status === 'ok' || item.status === 'stub' || item.status === 'error');
    for (const value of Object.values(item.meta)) assert.equal(typeof value, 'string');
  }
}

const BIN = resolve(import.meta.dirname, '..', 'bin', 'bukz.mjs');
const ROOT = resolve(import.meta.dirname, '..');

function feedEnv(extra = {}) {
  const env = {
    ...process.env,
    // Present keys win over .env, so a local opt-in cannot flip these tests.
    BUKZ_FEED_PORT: '7801',
    BUKZ_FEED_ALLOW_NON_LOOPBACK: '',
  };
  delete env.BUKZ_FEED_HOST;
  return { ...env, ...extra };
}

function runFeed(args, env = {}) {
  return spawnSync(process.execPath, [BIN, 'feed-serve', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: feedEnv(env),
    timeout: 5000,
  });
}

test('feed bind: loopback hosts need no opt-in', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1']) {
    assert.equal(isLoopbackHost(host), true);
    assert.equal(assertFeedHost(host), host);
    assert.equal(assertFeedHost(host, { allowNonLoopback: false }), host);
  }
  assert.equal(assertFeedHost('127.0.0.1', { allowNonLoopback: true }), '127.0.0.1');
});

test('feed bind: non-loopback is refused unless the flag or env is set', () => {
  for (const host of ['0.0.0.0', '10.1.2.3', 'example.com', 'LOCALHOST']) {
    assert.equal(isLoopbackHost(host), false);
    assert.throws(() => assertFeedHost(host), /Cipher must CLEAR/);
    assert.throws(() => assertFeedHost(host, { allowNonLoopback: false }), /public/);
    assert.equal(assertFeedHost(host, { allowNonLoopback: true }), host);
  }
  assert.equal(feedNonLoopbackAllowed(false, '1'), true);
  assert.equal(feedNonLoopbackAllowed(false, ' 1 '), true);
  assert.equal(feedNonLoopbackAllowed(true, undefined), true);
  assert.equal(feedNonLoopbackAllowed(true, '0'), true);
  for (const value of [undefined, '', '0', 'true', 'yes', 'TRUE']) {
    assert.equal(feedNonLoopbackAllowed(false, value), false);
  }
  assert.equal(assertFeedHost('0.0.0.0', { allowNonLoopback: feedNonLoopbackAllowed(false, '1') }), '0.0.0.0');
  assert.throws(
    () => assertFeedHost('0.0.0.0', { allowNonLoopback: feedNonLoopbackAllowed(false, '0') }),
    /--allow-non-loopback/,
  );
});

test('feed bind: refusal names the flag and does not mention secrets or .env', () => {
  assert.throws(
    () => assertFeedHost('0.0.0.0'),
    (err) => {
      assert.match(err.message, /BUKZ_FEED_ALLOW_NON_LOOPBACK=1/);
      assert.match(err.message, /Cipher must CLEAR/);
      assert.match(err.message, /public/);
      assert.equal(err.message.includes('.env'), false);
      assert.equal(err.message.includes('Bearer'), false);
      assert.equal(err.message.includes('BUKZ_API_KEY'), false);
      return true;
    },
  );
  assert.throws(
    () => assertFeedHost('not a host'),
    (err) => {
      assert.equal(err.message.includes('not a host'), false);
      assert.equal(err.message.includes('.env'), false);
      return true;
    },
  );
});

test('CLI feed-serve exits on a non-loopback host and prints no secrets', () => {
  const secret = 'planted-feed-token-not-a-host';
  const res = runFeed(['--host', '0.0.0.0'], { BUKZ_API_KEY: secret });
  assert.equal(res.status, 1, res.stderr);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /non-loopback/);
  assert.match(res.stderr, /Cipher must CLEAR/);
  assert.match(res.stderr, /public/);
  assert.match(res.stderr, /--allow-non-loopback/);
  assert.match(res.stderr, /BUKZ_FEED_ALLOW_NON_LOOPBACK/);
  assert.equal(res.stderr.includes(secret), false);
  assert.equal(res.stderr.includes('.env'), false);
});

test('CLI feed-serve exits when BUKZ_FEED_HOST is not loopback', () => {
  const res = runFeed([], { BUKZ_FEED_HOST: '10.9.8.7' });
  assert.equal(res.status, 1, res.stderr);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /10\.9\.8\.7/);
  assert.match(res.stderr, /Cipher must CLEAR/);
});

test('CLI feed-serve allows a non-loopback host only with explicit intent, and does not listen', () => {
  const flagged = runFeed(['--host', '0.0.0.0', '--allow-non-loopback', '--port', '0']);
  assert.equal(flagged.status, 1, flagged.stderr);
  assert.equal(flagged.stdout, '');
  assert.match(flagged.stderr, /--port must be 1/);
  assert.doesNotMatch(flagged.stderr, /Refusing to bind/);

  const fromEnv = runFeed(['--host', '10.1.2.3', '--port', '70000'], {
    BUKZ_FEED_ALLOW_NON_LOOPBACK: '1',
  });
  assert.equal(fromEnv.status, 1, fromEnv.stderr);
  assert.match(fromEnv.stderr, /--port must be 1/);
  assert.doesNotMatch(fromEnv.stderr, /Refusing to bind/);

  const typo = runFeed(['--host', '0.0.0.0', '--port', '0'], {
    BUKZ_FEED_ALLOW_NON_LOOPBACK: 'true',
  });
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /Refusing to bind/);
  assert.match(typo.stderr, /Cipher must CLEAR/);
});

test('CLI feed-serve does not refuse loopback hosts', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1']) {
    const res = runFeed(['--host', host, '--port', '0']);
    assert.equal(res.status, 1, res.stderr);
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /--port must be 1/);
    assert.doesNotMatch(res.stderr, /Refusing to bind/);
  }
});

test('help text documents the non-loopback opt-in', () => {
  const res = spawnSync(process.execPath, [BIN, 'help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /--allow-non-loopback/);
  assert.match(res.stdout, /BUKZ_FEED_ALLOW_NON_LOOPBACK=1/);
  assert.match(res.stdout, /Cipher must CLEAR/);
  assert.match(res.stdout, /does not include secrets/);
});
