// Imported-duplicate ("ghost twin") detection. Pure — no node:* imports, so the
// SPA can load it too.
//
// The pattern: a linked bank feed reports one charge twice, a few days apart
// (e.g. once near the authorization date and again near the posting date).
// YNAB derives a linked import's id from amount + date + occurrence
// ("YNAB:<milliunits>:<YYYY-MM-DD>:<n>"), so two dates give two distinct import
// ids and YNAB's own de-dupe never fires; its matcher only pairs an import with
// a manually-entered row, never two imports. Both rows land in the register.
//
// A lead, not a verdict: real repeats (a recurring charge, two short transit
// rides, a pair of identical purchases) look the same. The config-driven
// allowlist suppresses known-real repeat shapes; anything left is for a human
// to check against the issuer's statement/balance.

import { toCents, fromCents } from './money.mjs';

const IMPORT_ID = /^YNAB:(-?\d+):(\d{4}-\d{2}-\d{2}):(\d+)$/;

// Parse a YNAB linked-import id. Returns null for manual/API/file rows.
export function parseImportId(importId) {
  if (typeof importId !== 'string') return null;
  const m = importId.match(IMPORT_ID);
  if (!m) return null;
  return { milliunits: Number(m[1]), date: m[2], occurrence: Number(m[3]) };
}

const DAY_MS = 86400000;
function dayDiff(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// The payee the bank sent, before YNAB renaming rules; falls back to payee.
export function originalPayee(t) {
  return t.importPayeeNameOriginal || t.payee || '';
}

// Allowlist entry shape (all fields optional; an entry matches when EVERY
// field it sets matches; an entry that sets no matcher matches nothing):
//   { payee: "Example Transit",        // case-insensitive exact original payee
//     payeePattern: "^example ride",   // case-insensitive regex on original payee
//     amount: -12.34,                  // exact signed amount
//     maxAbsAmount: 3,                 // |amount| <= this
//     account: "Example Card",         // account name (case-insensitive exact)
//     note: "why this repeat is real" }
export function compileAllowlist(entries = []) {
  if (!Array.isArray(entries)) throw new Error('Ghost allowlist must be a JSON array');
  return entries.map((e, i) => {
    if (!e || typeof e !== 'object') throw new Error(`Allowlist entry ${i} must be an object`);
    for (const k of ['amount', 'maxAbsAmount']) {
      if (e[k] != null && !(typeof e[k] === 'number' && Number.isFinite(e[k]))) {
        throw new Error(`Allowlist entry ${i}: ${k} must be a finite number`);
      }
    }
    for (const k of ['payee', 'payeePattern', 'account']) {
      if (e[k] != null && typeof e[k] !== 'string') {
        throw new Error(`Allowlist entry ${i}: ${k} must be a string`);
      }
    }
    let re = null;
    if (e.payeePattern != null) {
      try {
        re = new RegExp(e.payeePattern, 'i');
      } catch (err) {
        throw new Error(`Allowlist entry ${i}: bad payeePattern (${err.message})`);
      }
    }
    const hasMatcher =
      e.payee != null || re || e.amount != null || e.maxAbsAmount != null || e.account != null;
    return {
      index: i,
      note: e.note ?? null,
      test(t) {
        if (!hasMatcher) return false;
        const p = originalPayee(t);
        if (e.payee != null && norm(e.payee) !== norm(p)) return false;
        if (re && !re.test(p)) return false;
        if (e.amount != null && toCents(e.amount) !== toCents(t.amount)) return false;
        if (e.maxAbsAmount != null && Math.abs(toCents(t.amount)) > toCents(e.maxAbsAmount)) return false;
        if (e.account != null && norm(e.account) !== norm(t.account)) return false;
        return true;
      },
    };
  });
}

const view = (t) => ({
  id: t.id,
  date: t.date,
  amount: t.amount,
  payee: t.payee ?? null,
  importPayeeNameOriginal: t.importPayeeNameOriginal ?? null,
  importId: t.importId ?? null,
  account: t.account ?? null,
  status: t.status ?? null,
  approved: t.approved ?? null,
});

// Find later-dated imported copies of earlier imported rows.
//   minDays/maxDays: inclusive date-gap window (default 1–5).
//   allowlist: raw allowlist entries (see compileAllowlist).
// Pairing is greedy and one-to-one per (account, amount, original payee)
// group: each later row pairs with the earliest still-unpaired earlier row in
// the window, so three identical charges + three copies yield three pairs, not
// nine. Transfers and rows without a YNAB linked-import id are skipped.
export function findImportedTwins(transactions, { minDays = 1, maxDays = 5, allowlist = [] } = {}) {
  if (!(Number.isInteger(minDays) && Number.isInteger(maxDays) && minDays >= 1 && maxDays >= minDays)) {
    throw new Error(`Day window must be integers with 1 <= min <= max (got ${minDays}-${maxDays})`);
  }
  const allow = compileAllowlist(allowlist);
  let skippedNoImportId = 0;
  let missingImportField = 0;
  const groups = new Map();
  for (const t of transactions) {
    if (t.transfer) continue;
    // A YNAB row with NO importId field predates import-id capture (needs a
    // `pull --full`); importId: null is a real manual/file row. Other
    // providers (Xero) never carry import ids, so they are not counted.
    if (t.provider === 'ynab' && t.importId === undefined) missingImportField++;
    const parsed = parseImportId(t.importId);
    if (!parsed) {
      skippedNoImportId++;
      continue;
    }
    // Bucket by account name (falling back to id) so rows cached before
    // accountId existed can still meet newly pulled rows; the pairing loop
    // then keeps accounts apart whenever BOTH rows carry an accountId.
    const key = [t.account || t.accountId || '', toCents(t.amount), norm(originalPayee(t))].join('\u0000');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ t, parsed });
  }

  const flagged = [];
  const allowlisted = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.t.date.localeCompare(b.t.date) || String(a.t.id).localeCompare(String(b.t.id)));
    const used = new Set();
    for (let j = 0; j < rows.length; j++) {
      if (used.has(j)) continue;
      for (let i = 0; i < j; i++) {
        if (used.has(i)) continue;
        const a = rows[i];
        const b = rows[j];
        const gap = dayDiff(a.t.date, b.t.date);
        if (gap < minDays || gap > maxDays) continue;
        if (a.parsed.date === b.parsed.date) continue; // same import date = not this pattern
        if (a.t.accountId && b.t.accountId && a.t.accountId !== b.t.accountId) continue; // same name, different accounts
        used.add(i);
        used.add(j);
        const hit = allow.find((e) => e.test(a.t) && e.test(b.t));
        const pair = {
          gapDays: gap,
          amount: b.t.amount,
          payee: originalPayee(b.t),
          account: b.t.account ?? null,
          original: view(a.t),
          twin: view(b.t),
        };
        if (hit) allowlisted.push({ ...pair, allowlistEntry: hit.index, allowlistNote: hit.note });
        else flagged.push(pair);
        break;
      }
    }
  }
  const byDate = (x, y) =>
    x.twin.date.localeCompare(y.twin.date) || String(x.twin.id).localeCompare(String(y.twin.id));
  flagged.sort(byDate);
  allowlisted.sort(byDate);
  const twinTotal = fromCents(flagged.reduce((s, p) => s + toCents(p.twin.amount), 0));
  // drift compares CLEARED balances. A copy only double-counts there when BOTH
  // rows are explicitly cleared/reconciled; an uncleared original (e.g. an
  // authorization still pending) plus a cleared copy counts once, so it is
  // not gap explained by ghosts. Missing/unknown status never counts.
  const isCleared = (t) => t.status === 'cleared' || t.status === 'reconciled';
  const clearedTwinTotal = fromCents(
    flagged.filter((p) => isCleared(p.original) && isCleared(p.twin)).reduce((s, p) => s + toCents(p.twin.amount), 0)
  );
  return {
    window: { minDays, maxDays },
    flagged,
    allowlisted,
    summary: {
      flaggedPairs: flagged.length,
      flaggedTwinTotal: twinTotal,
      flaggedClearedTwinTotal: clearedTwinTotal,
      allowlistedPairs: allowlisted.length,
      rowsWithoutImportId: skippedNoImportId,
      rowsMissingImportField: missingImportField,
    },
  };
}

// Human-readable lines for routing to a reviewer (e.g. a triage queue).
export function formatTwinsText(result, { account } = {}) {
  const lines = [];
  const s = result.summary;
  lines.push(
    `Imported-duplicate check${account ? ` — ${account}` : ''} (window ${result.window.minDays}–${result.window.maxDays} days)`
  );
  lines.push(
    `${s.flaggedPairs} possible twin pair(s), later copies total ${s.flaggedTwinTotal.toFixed(2)}; ` +
      `${s.allowlistedPairs} allowlisted; ${s.rowsWithoutImportId} row(s) without a linked import id skipped`
  );
  for (const p of result.flagged) {
    lines.push(
      `  ${p.twin.date} ${p.amount.toFixed(2)} ${p.payee} — twin ${p.twin.id} (${p.twin.importId}) ` +
        `of ${p.original.id} on ${p.original.date} (${p.original.importId}), +${p.gapDays}d`
    );
  }
  if (result.flagged.length) {
    lines.push('Leads, not verdicts: confirm against the issuer statement/balance before deleting anything.');
  }
  return lines.join('\n');
}
