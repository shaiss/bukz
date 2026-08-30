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

function planId() {
  // "last-used" is a YNAB-supported alias for the most recently opened plan.
  // (YNAB renamed budgets → plans in API v1.79.0; YNAB_BUDGET_ID stays the env
  // var name for backward compatibility.)
  return process.env.YNAB_BUDGET_ID || 'last-used';
}

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  return unwrap(res, path, 'GET');
}

// Shared response handler for every method. YNAB wraps success bodies in
// { data: ... } and errors in { error: { id, name, detail } } (a single object,
// not an array). The detail string carries the validation message inline.
async function unwrap(res, path, method) {
  if (!res.ok) {
    let hint = '';
    if (res.status === 401) hint = ' — check YNAB_ACCESS_TOKEN';
    if (res.status === 403) hint = ' — token lacks permission for this operation';
    if (res.status === 404) hint = ' — check YNAB_BUDGET_ID (list with: node bin/bukz.mjs budgets)';
    if (res.status === 429) hint = ' — YNAB rate limit is 200 requests/hour; wait and retry';
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.detail ? `: ${body.error.detail}` : '';
    } catch {
      /* non-JSON error body — status text is enough */
    }
    throw new Error(`YNAB API ${res.status} ${res.statusText} (${method} ${path})${hint}${detail}`);
  }
  return (await res.json()).data;
}

// Write helper: JSON body + the same auth/envelope handling as get().
async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return unwrap(res, path, method);
}

export async function listSources() {
  const data = await get('/plans');
  // The response field was `budgets` pre-rename and `plans` after; accept either
  // so the client works regardless of which YNAB API version is live.
  const list = data.plans ?? data.budgets ?? [];
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    lastModified: p.last_modified_on,
  }));
}

export async function checkAuth() {
  const plans = await listSources();
  return { ok: true, budgets: plans.length, budgetId: planId() };
}

export async function fetchCategories() {
  const data = await get(`/plans/${planId()}/categories`);
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

// Optional provider capability (Xero does not implement these yet): account
// balances for the balance sheet / cash look-ahead. Closed accounts are kept
// and flagged — they carry history; commands decide whether to use them.
export async function fetchAccounts() {
  const data = await get(`/plans/${planId()}/accounts`);
  return data.accounts
    .filter((a) => !a.deleted)
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      onBudget: Boolean(a.on_budget),
      closed: Boolean(a.closed),
      balance: a.balance / 1000,
      clearedBalance: a.cleared_balance / 1000,
      unclearedBalance: a.uncleared_balance / 1000,
    }));
}

// Optional provider capability: per-month budget snapshots (budgeted amounts
// per category) for budget-vs-actual, plus the month-ahead signals — Age of
// Money and each category's goal target. Month labels normalize to YYYY-MM.
// Goal fields are captured defensively (?? null): they appear when the budget
// uses YNAB targets, and are simply absent otherwise.
//
// The /months list returns summaries WITHOUT category detail (categories were
// silently absent, which read downstream as "nothing budgeted"), so each
// month's detail endpoint is fetched too — one extra request per cached month
// against the 200/hour rate limit, well within a pull's budget.
export async function fetchBudgetMonths() {
  const list = await get(`/plans/${planId()}/months`);
  const summaries = list.months.filter((m) => !m.deleted);
  const details = await Promise.all(
    summaries.map((m) => get(`/plans/${planId()}/months/${m.month}`))
  );
  return details
    .map((d) => d.month)
    .filter((m) => !m.deleted)
    .map((m) => ({
      month: m.month.slice(0, 7),
      budgeted: m.budgeted / 1000,
      activity: m.activity / 1000,
      toBeBudgeted: m.to_be_budgeted / 1000,
      ageOfMoney: m.age_of_money ?? null,
      categories: (m.categories ?? [])
        .filter((c) => !c.deleted && !c.hidden)
        .map((c) => ({
          id: c.id,
          name: c.name,
          budgeted: c.budgeted / 1000,
          activity: c.activity / 1000,
          balance: c.balance / 1000,
          goalType: c.goal_type ?? null,
          goalTarget: c.goal_target != null ? c.goal_target / 1000 : null,
        })),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// Optional provider capability (the budget write): assign dollars to one
// category in one month. `month` is YYYY-MM (normalized to the YYYY-MM-01 the
// API wants); `amount` is the new budgeted total for that category, in
// currency units. Returns the updated month-category snapshot. The command
// layer owns the dry-run → confirm → --yes flow, same as recategorize.
export async function assignBudget({ month, categoryId, amount }) {
  const data = await request(
    'PATCH',
    `/plans/${planId()}/months/${month}-01/categories/${categoryId}`,
    { category: { budgeted: Math.round(amount * 1000) } }
  );
  const c = data.category;
  return {
    category: {
      id: c.id,
      name: c.name,
      budgeted: c.budgeted / 1000,
      activity: c.activity / 1000,
      balance: c.balance / 1000,
    },
    serverKnowledge: data.server_knowledge ?? null,
  };
}

export async function fetchTransactions({ since, knowledge } = {}) {
  // Delta sync: pass the last server_knowledge to receive only changed
  // transactions since then (plus a new knowledge value to persist). Without a
  // cursor we do a full fetch — the two paths share the same normalization.
  const params = new URLSearchParams();
  if (since) params.set('since_date', since);
  if (knowledge !== undefined) params.set('last_knowledge_of_server', knowledge);
  const query = params.toString() ? `?${params}` : '';
  const data = await get(`/plans/${planId()}/transactions${query}`);
  const out = [];
  const deletedParentIds = new Set();
  for (const t of data.transactions) {
    // A delta stream includes deletions: record the parent id so the merge can
    // evict any cached rows (parent + its split lines) before re-adding survivors.
    if (t.deleted) {
      deletedParentIds.add(t.id);
      continue;
    }
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
  return {
    transactions: out,
    deleted: deletedParentIds,
    knowledge: data.server_knowledge ?? null,
  };
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

// Change a single (non-split) transaction's category. YNAB's spec forbids
// restructuring a split's lines via update, so the command layer must refuse
// split ids before calling this. Returns the updated transaction and the new
// server_knowledge (to refresh the incremental-pull cursor).
export async function recategorize({ id, categoryId }) {
  const data = await request(
    'PUT',
    `/plans/${planId()}/transactions/${id}`,
    { transaction: { category_id: categoryId } }
  );
  return {
    transaction: normalizeTxn(data.transaction),
    serverKnowledge: data.server_knowledge ?? null,
  };
}

// YNAB write responses return the full TransactionDetail (with subtransactions,
// account_name, etc.) — normalize it to the shared shape like fetchTransactions.
function normalizeTxn(t) {
  if (t.subtransactions?.length) {
    return t.subtransactions
      .filter((s) => !s.deleted)
      .map((s) => normalize(t, s));
  }
  return normalize(t);
}
