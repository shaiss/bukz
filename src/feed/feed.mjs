// Famdash feed mappers. Pure: no I/O, no provider calls, no node:* imports.
// The HTTP layer (src/feed/server.mjs) owns auth and cache reads.
//
// v0 emits five locked kinds. Titles, summaries, and meta never carry payees,
// account names, dollar amounts, or other deny-list material — only enums,
// counts, dates, and category-group labels.

import { outlook } from '../analysis/outlook.mjs';
import { budgetVariance, defaultMonth } from '../analysis/variance.mjs';
import { monthAhead } from '../analysis/budget.mjs';
import { toCents } from '../analysis/money.mjs';
import { newestDate } from '../analysis/period.mjs';
import { isUncategorized } from '../analysis/categorization.mjs';

export { isUncategorized };

export const FEED_SOURCE = 'bukz';
export const FEED_DEFAULT_LIMIT = 10;
export const FEED_MIN_LIMIT = 1;
export const FEED_MAX_LIMIT = 50;
export const FEED_WINDOW_DAYS = 14;
export const FEED_FRESH_MS = 6 * 60 * 60 * 1000;

const CASH_TITLE = 'Cash outlook';

const BILL_TITLE = {
  covered: 'Scheduled bills look covered',
  watch: 'Bill coverage needs a look',
  short: 'Bill coverage is tight',
};

const BAND_TITLE = {
  hold: 'Month-ahead funding is on hold',
  partial: 'Month-ahead funding is partial',
  funded: 'Month-ahead funding is in place',
};

const LIABILITY =
  /\b(liabilit(?:y|ies)|liable|debts?|owe[ds]?|overdrafts?|collections|shortfalls?|bankrupt(?:cy)?)\b/i;

/** True only for the explicit `amounts=1` unlock. Anything else stays amount-free. */
export function amountsUnlocked(raw) {
  return raw === 1 || raw === '1';
}

/** Liability wording in title/summary. `meta.liabilityWatch` is not copy. */
export function liabilityInCopy(items) {
  for (const item of items ?? []) {
    if (LIABILITY.test(`${item?.title ?? ''}\n${item?.summary ?? ''}`)) return true;
  }
  return false;
}

/** Clamp `limit` to 1–50; default 10. Non-numeric → default. Matches FamPoll. */
export function clampFeedLimit(raw) {
  if (raw == null || raw === '') return FEED_DEFAULT_LIMIT;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return FEED_DEFAULT_LIMIT;
  return Math.min(FEED_MAX_LIMIT, Math.max(FEED_MIN_LIMIT, Math.trunc(n)));
}

/**
 * monthAhead fundedPct → locked band. Not a new threshold:
 *   funded  — at least the reference month's assignment
 *   partial — some assignment, short of that reference
 *   hold    — nothing assigned, or no reference month
 */
export function fundingBand(fundedPct) {
  if (fundedPct == null || fundedPct <= 0) return 'hold';
  if (fundedPct >= 100) return 'funded';
  return 'partial';
}

export function cacheFreshness(pulledAt, now = new Date()) {
  const pulled = pulledAt ? Date.parse(pulledAt) : NaN;
  if (!Number.isFinite(pulled)) return { fresh: false, cacheAge: null };
  const ageMs = now.getTime() - pulled;
  if (ageMs < 0) return { fresh: true, cacheAge: '0' };
  return {
    fresh: ageMs <= FEED_FRESH_MS,
    cacheAge: String(Math.floor(ageMs / 1000)),
  };
}

export function buildFeed({
  cache = null,
  bills = [],
  now = new Date(),
  limit = FEED_DEFAULT_LIMIT,
  windowDays = FEED_WINDOW_DAYS,
  amounts = false,
} = {}) {
  const cap = clampFeedLimit(limit);
  const allowAmounts = amounts === true || amountsUnlocked(amounts);
  const fetchedAt = now.toISOString();
  const usable = cache && Array.isArray(cache.transactions);
  const fresh = cacheFreshness(usable ? cache.pulledAt : null, now);
  const status = usable && fresh.fresh ? 'ok' : 'stub';

  let items;
  try {
    items = usable
      ? itemsFromCache({ cache, bills: Array.isArray(bills) ? bills : [], now, status, fresh, windowDays })
      : placeholderItems(now, 'stub');
  } catch {
    items = placeholderItems(now, 'error');
  }

  const sealed = sealFeed(
    { items, fetchedAt },
    sensitiveStrings(usable ? cache : null, bills),
    now,
    { amounts: allowAmounts }
  );
  return { items: sealed.items.slice(0, cap), fetchedAt };
}

/** Replace the payload when it would leak deny-list material. Never echoes the hit. */
export function sealFeed(payload, forbidden, now = new Date(), { amounts = false } = {}) {
  const hits = leakHits(payload.items, forbidden, { amounts });
  if (!hits.length && !liabilityInCopy(payload.items)) return payload;
  return { ...payload, items: placeholderItems(now, 'error') };
}

export function leakHits(value, forbidden = [], { amounts = false } = {}) {
  const blob = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const hits = [];
  // Dollar figures stay off the wire unless `amounts=1`. fundedPct never ships.
  if (!amounts && blob.includes('$')) hits.push('$');
  if (!amounts && /(?<!\d)\d+\.\d{2}(?!\d)/.test(blob)) hits.push('decimal-amount');
  if (hasKey(value, 'fundedPct')) hits.push('fundedPct');
  if (/ready to assign|\bRTA\b/i.test(blob)) hits.push('rta');
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(blob)) hits.push('email');
  if (/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(blob)) hits.push('phone');
  if (/\.env\b|Bearer\s|YNAB_|XERO_|api[_-]?key|BEGIN [A-Z ]*PRIVATE KEY/i.test(blob)) {
    hits.push('secret-marker');
  }
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(blob)) {
    hits.push('uuid');
  }
  const lower = blob.toLowerCase();
  for (const raw of forbidden) {
    const s = String(raw ?? '').trim();
    if (s.length < 4 || /^\d+(\.\d+)?$/.test(s)) continue;
    if (lower.includes(s.toLowerCase())) hits.push(s);
  }
  return hits;
}

export function sensitiveStrings(cache, bills) {
  const groups = new Set(
    (cache?.categories ?? [])
      .map((c) => (typeof c?.group === 'string' ? c.group.trim() : ''))
      .filter(Boolean)
  );
  const out = new Set();
  const add = (value) => {
    if (value == null) return;
    const s = String(value).trim();
    if (s.length < 4 || /^\d+(\.\d+)?$/.test(s)) return;
    if (groups.has(s)) return;
    out.add(s);
  };
  for (const t of cache?.transactions ?? []) {
    add(t.payee);
    add(t.account);
    add(t.memo);
    add(t.id);
    // The kind id uses the word "uncategorized"; that label is not a payee.
    if (typeof t.category === 'string' && t.category.trim().toLowerCase() !== 'uncategorized') {
      add(t.category);
    }
  }
  for (const a of cache?.accounts ?? []) {
    add(a.name);
    add(a.id);
  }
  for (const c of cache?.categories ?? []) {
    add(c.name);
    if (c.id !== c.name) add(c.id);
  }
  for (const b of Array.isArray(bills) ? bills : []) {
    add(b?.name);
    add(b?.paidFrom);
    add(b?.notes);
  }
  add('Ready to Assign');
  return [...out];
}

function hasKey(value, key) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => hasKey(entry, key));
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((entry) => hasKey(entry, key));
}

function itemsFromCache({ cache, bills, now, status, fresh, windowDays }) {
  const txns = cache.transactions ?? [];
  const ref = referenceDay(txns);
  if (!ref) return placeholderItems(now, 'stub');
  const occurredAt = `${ref}T00:00:00.000Z`;
  const month = ref.slice(0, 7);
  const age = fresh.cacheAge;

  const items = [
    cashItem({ cache, bills, windowDays, ref, occurredAt, status, age }),
    uncategorizedItem({ txns, month, occurredAt, status, age }),
    billItem({ cache, bills, windowDays, ref, occurredAt, status, age }),
    fundingItem({ cache, occurredAt, status, age }),
    ...varianceItems({ cache, month, occurredAt, status, age }),
  ];
  return items.filter(Boolean);
}

function cashItem({ cache, bills, windowDays, ref, occurredAt, status, age }) {
  const light = cashLight(cache, bills, windowDays);
  return feedItem({
    id: `bukz:cash_outlook:${ref}`,
    title: CASH_TITLE,
    summary: `Overall light is ${light}.`,
    occurredAt,
    status,
    meta: {
      kind: 'cash_outlook',
      // Engineering flag only. Copy must not say "liability".
      liabilityWatch: light === 'red' ? 'true' : 'false',
      cacheAge: age,
    },
  });
}

function uncategorizedItem({ txns, month, occurredAt, status, age }) {
  const count = txns.filter(
    (t) => !t.transfer && typeof t.date === 'string' && t.date.startsWith(month) && isUncategorized(t)
  ).length;
  return feedItem({
    id: `bukz:uncategorized:${month}`,
    title: 'Transactions are missing a category',
    summary: 'Rows in the focus month with no category.',
    occurredAt,
    status,
    meta: {
      kind: 'uncategorized',
      count: String(count),
      month,
      cacheAge: age,
    },
  });
}

function billItem({ cache, bills, windowDays, ref, occurredAt, status, age }) {
  const coverage = coverageBand(cache, bills, windowDays);
  return feedItem({
    id: `bukz:bill_coverage:${ref}`,
    title: BILL_TITLE[coverage],
    summary: 'Scheduled-bill coverage for the window.',
    occurredAt,
    status,
    meta: { kind: 'bill_coverage', coverage, windowDays: String(windowDays), cacheAge: age },
  });
}

function fundingItem({ cache, occurredAt, status, age }) {
  let band = 'hold';
  let month = null;
  try {
    const ahead = monthAhead(cache.transactions ?? [], cache.budgetMonths ?? []);
    band = fundingBand(ahead.next?.fundedPct);
    month = ahead.next?.month ?? null;
  } catch {
    band = 'hold';
  }
  return feedItem({
    id: month ? `bukz:budget_funding:${month}` : 'bukz:budget_funding:none',
    title: BAND_TITLE[band],
    summary: 'Month-ahead funding band.',
    occurredAt,
    status,
    meta: { kind: 'budget_funding', band, cacheAge: age },
  });
}

function varianceItems({ cache, month, occurredAt, status, age }) {
  const flags = groupVariance(cache, month);
  return flags.map((flag) =>
    feedItem({
      id: `bukz:variance_flag:${month}:${slug(flag.group)}`,
      title: `${flag.group} is ${flag.direction}`,
      summary: 'Category group compared with its plan.',
      occurredAt,
      status,
      meta: {
        kind: 'variance_flag',
        direction: flag.direction,
        group: flag.group,
        cacheAge: age,
      },
    })
  );
}

function cashLight(cache, bills, windowDays) {
  const accounts = openAccounts(cache);
  if (!accounts.length) return 'yellow';
  try {
    const report = outlook(cache.transactions ?? [], cache.accounts ?? [], bills, { days: windowDays });
    if (report.status === 'red' || report.status === 'yellow' || report.status === 'green') {
      return report.status;
    }
  } catch {
    return 'yellow';
  }
  return 'yellow';
}

function coverageBand(cache, bills, windowDays) {
  const accounts = openAccounts(cache);
  if (!accounts.length) return 'watch';
  try {
    const report = outlook(cache.transactions ?? [], cache.accounts ?? [], bills, { days: windowDays });
    if (report.status === 'red') return 'short';
    if (report.status === 'yellow') return 'watch';
    if ((report.unmatchedBills ?? []).length || (report.manualWatch ?? []).length) return 'watch';
    return 'covered';
  } catch {
    return 'watch';
  }
}

function groupVariance(cache, fallbackMonth) {
  const months = cache.budgetMonths ?? [];
  const txns = cache.transactions ?? [];
  if (!months.length || !txns.length) return [];
  let month = fallbackMonth;
  try {
    month = defaultMonth(txns, months);
  } catch {
    return [];
  }
  let report;
  try {
    report = budgetVariance(txns, months, month);
  } catch {
    return [];
  }
  const groupByName = new Map(
    (cache.categories ?? []).map((c) => [c.name, typeof c.group === 'string' ? c.group.trim() : ''])
  );
  const cents = new Map();
  for (const row of report.categories) {
    const group = safeGroup(groupByName.get(row.category));
    if (!group) continue;
    cents.set(group, (cents.get(group) ?? 0) + toCents(row.remaining));
  }
  const flags = [];
  for (const [group, c] of cents) {
    if (c === 0) continue;
    flags.push({ group, direction: c < 0 ? 'over' : 'under' });
  }
  flags.sort(
    (a, b) =>
      (a.direction === b.direction ? 0 : a.direction === 'over' ? -1 : 1) ||
      a.group.localeCompare(b.group)
  );
  return flags;
}

function safeGroup(group) {
  if (!group) return null;
  if (LIABILITY.test(group) || /\$|\d+\.\d{2}|@/.test(group)) return null;
  if (/ready to assign|\brta\b/i.test(group)) return null;
  return group;
}

function openAccounts(cache) {
  return (cache.accounts ?? []).filter((a) => a && !a.closed && a.name);
}

function referenceDay(transactions) {
  try {
    return newestDate(transactions.filter((t) => t && t.date));
  } catch {
    return null;
  }
}

function placeholderItems(now, status) {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const occurredAt = now.toISOString();
  return [
    feedItem({
      id: 'bukz:cash_outlook:stub',
      title: CASH_TITLE,
      summary: 'Overall light is yellow.',
      occurredAt,
      status,
      meta: { kind: 'cash_outlook', liabilityWatch: 'false' },
    }),
    feedItem({
      id: `bukz:uncategorized:${month}`,
      title: 'Category inbox is not available yet',
      summary: 'No fresh cache to read.',
      occurredAt,
      status,
      meta: { kind: 'uncategorized', count: '0', month },
    }),
    feedItem({
      id: 'bukz:bill_coverage:stub',
      title: 'Bill coverage is not available yet',
      summary: 'No fresh cache to read.',
      occurredAt,
      status,
      meta: { kind: 'bill_coverage', coverage: 'watch', windowDays: String(FEED_WINDOW_DAYS) },
    }),
    feedItem({
      id: 'bukz:budget_funding:stub',
      title: 'Month-ahead funding is not available yet',
      summary: 'No fresh cache to read.',
      occurredAt,
      status,
      meta: { kind: 'budget_funding', band: 'hold' },
    }),
    feedItem({
      id: 'bukz:variance_flag:stub',
      title: 'Category-group variance is not available yet',
      summary: 'Placeholder, not a spending signal.',
      occurredAt,
      status,
      meta: { kind: 'variance_flag', direction: 'under', group: 'None' },
    }),
  ];
}

function feedItem({ id, title, summary, occurredAt, status, meta }) {
  const item = {
    id,
    source: FEED_SOURCE,
    title,
    occurredAt,
    status,
    meta: stringifyMeta(meta),
  };
  if (summary) item.summary = summary;
  return item;
}

function stringifyMeta(meta) {
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value == null || value === '') continue;
    out[key] = String(value);
  }
  return out;
}

function slug(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'group'
  );
}
