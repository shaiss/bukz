// Xero Accounting API — read-only client using a Custom Connection
// (OAuth2 client_credentials, machine-to-machine; the token is bound to one org).
// MVP scope: BankTransactions only. Invoices/bills (ACCPAY/ACCREC) are on the roadmap.

const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';
const API = 'https://api.xero.com/api.xro/2.0';
const SCOPES = 'accounting.transactions.read accounting.settings.read accounting.contacts.read';
const PAGE_SIZE = 100; // Xero's fixed page size for paged endpoints

let tokenCache = null;

function credentials() {
  const id = process.env.XERO_CLIENT_ID;
  const secret = process.env.XERO_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      'XERO_CLIENT_ID / XERO_CLIENT_SECRET are not set. See .env.example ' +
      '(developer.xero.com → My Apps → Custom Connection).'
    );
  }
  return { id, secret };
}

async function accessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const { id, secret } = credentials();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPES }),
  });
  if (!res.ok) {
    throw new Error(
      `Xero token request failed (${res.status} ${res.statusText}) — check the client id/secret ` +
      'and that the app is a Custom Connection with the read scopes granted'
    );
  }
  const body = await res.json();
  tokenCache = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return tokenCache.token;
}

async function connections() {
  const token = await accessToken();
  const res = await fetch(CONNECTIONS_URL, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Xero connections request failed (${res.status} ${res.statusText})`);
  return res.json();
}

async function tenantId() {
  if (process.env.XERO_TENANT_ID) return process.env.XERO_TENANT_ID;
  const conns = await connections();
  if (!conns.length) throw new Error('No Xero organisation is connected to this app.');
  return conns[0].tenantId;
}

async function get(path) {
  const [token, tid] = [await accessToken(), await tenantId()];
  const res = await fetch(API + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      'xero-tenant-id': tid,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Xero API ${res.status} ${res.statusText} for ${path}`);
  return res.json();
}

// Xero JSON serializes dates as "/Date(1518685950940+0000)/"; DateString is ISO when present.
function toIsoDate(value) {
  if (!value) return null;
  const ms = /\/Date\((\d+)/.exec(value);
  const d = ms ? new Date(Number(ms[1])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function listSources() {
  return (await connections()).map((c) => ({
    id: c.tenantId,
    name: c.tenantName,
    type: c.tenantType,
  }));
}

export async function checkAuth() {
  const sources = await listSources();
  return { ok: true, organisations: sources.length };
}

// The chart of accounts plays the role YNAB categories play.
export async function fetchCategories() {
  const body = await get('/Accounts');
  return (body.Accounts ?? []).map((a) => ({
    id: a.AccountID,
    name: a.Name,
    group: a.Type,
    code: a.Code ?? null,
  }));
}

export async function fetchTransactions({ since } = {}) {
  const accountsByCode = new Map(
    (await fetchCategories()).filter((a) => a.code).map((a) => [a.code, a.name])
  );
  const where = since ? '&where=' + encodeURIComponent(sinceClause(since)) : '';
  const out = [];
  for (let page = 1; ; page++) {
    const body = await get(`/BankTransactions?page=${page}${where}`);
    const txns = body.BankTransactions ?? [];
    for (const t of txns) {
      if (t.Status === 'DELETED') continue;
      out.push(...normalize(t, accountsByCode));
    }
    if (txns.length < PAGE_SIZE) break;
  }
  return out;
}

function sinceClause(since) {
  const [y, m, d] = since.split('-').map(Number);
  return `Date >= DateTime(${y}, ${m}, ${d})`;
}

function normalize(t, accountsByCode) {
  // SPEND / SPEND-OVERPAYMENT / SPEND-PREPAYMENT are money out.
  const sign = t.Type?.startsWith('SPEND') ? -1 : 1;
  const base = {
    date: toIsoDate(t.DateString ?? t.Date),
    payee: t.Contact?.Name ?? null,
    account: t.BankAccount?.Name ?? null,
    memo: t.Reference ?? '',
    status: t.IsReconciled ? 'reconciled' : 'cleared',
    approved: t.Status === 'AUTHORISED',
    transfer: false, // bank transfers live on a separate Xero endpoint
    provider: 'xero',
  };
  const lines = t.LineItems ?? [];
  if (lines.length <= 1) {
    const line = lines[0];
    return [{
      ...base,
      id: t.BankTransactionID,
      // Total is tax-inclusive — the number that matches the bank statement.
      amount: sign * (t.Total ?? 0),
      category: line ? accountsByCode.get(line.AccountCode) ?? line.AccountCode ?? null : null,
      categoryId: line?.AccountCode ?? null,
    }];
  }
  // Multi-line: one normalized row per line so category analysis sees each split.
  // Note: LineAmount may exclude tax depending on the org's LineAmountTypes.
  return lines.map((line, i) => ({
    ...base,
    id: `${t.BankTransactionID}:${i}`,
    amount: sign * (line.LineAmount ?? 0),
    category: accountsByCode.get(line.AccountCode) ?? line.AccountCode ?? null,
    categoryId: line.AccountCode ?? null,
  }));
}
