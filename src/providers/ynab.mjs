// YNAB API v1 — read-only client using a Personal Access Token.
// Docs: https://api.ynab.com/v1  (amounts arrive in milliunits: 1000 = $1)

const BASE = 'https://api.ynab.com/v1';

function token() {
  const t = process.env.YNAB_ACCESS_TOKEN;
  if (!t) {
    throw new Error(
      'YNAB_ACCESS_TOKEN is not set. Copy .env.example to .env and add your token ' +
      '(app.ynab.com → Account Settings → Developer Settings).'
    );
  }
  return t;
}

function budgetId() {
  // "last-used" is a YNAB-supported alias for the most recently opened budget.
  return process.env.YNAB_BUDGET_ID || 'last-used';
}

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    let hint = '';
    if (res.status === 401) hint = ' — check YNAB_ACCESS_TOKEN';
    if (res.status === 404) hint = ' — check YNAB_BUDGET_ID (list with: node bin/bukz.mjs budgets)';
    if (res.status === 429) hint = ' — YNAB rate limit is 200 requests/hour; wait and retry';
    throw new Error(`YNAB API ${res.status} ${res.statusText} for ${path}${hint}`);
  }
  return (await res.json()).data;
}

export async function listSources() {
  const data = await get('/budgets');
  return data.budgets.map((b) => ({
    id: b.id,
    name: b.name,
    lastModified: b.last_modified_on,
  }));
}

export async function checkAuth() {
  const budgets = await listSources();
  return { ok: true, budgets: budgets.length, budgetId: budgetId() };
}

export async function fetchCategories() {
  const data = await get(`/budgets/${budgetId()}/categories`);
  const categories = [];
  for (const group of data.category_groups) {
    if (group.deleted) continue;
    for (const c of group.categories) {
      if (c.deleted || c.hidden) continue;
      categories.push({ id: c.id, name: c.name, group: group.name });
    }
  }
  return categories;
}

export async function fetchTransactions({ since } = {}) {
  const query = since ? `?since_date=${since}` : '';
  const data = await get(`/budgets/${budgetId()}/transactions${query}`);
  const out = [];
  for (const t of data.transactions) {
    if (t.deleted) continue;
    if (t.subtransactions?.length) {
      // Split transactions: analyze each line, not the opaque parent total.
      for (const s of t.subtransactions) {
        if (s.deleted) continue;
        out.push(normalize(t, s));
      }
    } else {
      out.push(normalize(t));
    }
  }
  return out;
}

function normalize(t, sub) {
  const src = sub ?? t;
  return {
    id: src.id,
    date: t.date,
    amount: src.amount / 1000,
    payee: (sub?.payee_name ?? t.payee_name) || null,
    category: (sub ? sub.category_name : t.category_name) || null,
    categoryId: src.category_id || null,
    account: t.account_name ?? null,
    memo: (sub?.memo ?? t.memo) || '',
    status: t.cleared,
    approved: t.approved,
    transfer: Boolean(sub?.transfer_account_id ?? t.transfer_account_id),
    provider: 'ynab',
  };
}
