// Tiny DOM + formatting helpers. No framework, no build step — plain ES
// modules all the way down, matching the CLI's zero-dependency rule.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const money = (n) => usd.format(n);
export const money0 = (n) => usd0.format(n);

// Minimal element builder: h('tr', { class: 'row', onclick: fn }, ...children)
// Strings/numbers become text nodes; `onclick`-style keys attach as event
// listeners; everything else string-valued becomes an attribute.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(child));
  }
}

// Sort helper: transactions newest-first for drill-down tables.
export const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);

// "3 days ago" for the meta bar — computed from the page load, not per render.
export function ago(iso) {
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function statusChip(status) {
  return h('span', { class: `chip ${status}`, title: status }, status === 'green' ? '🟢' : status === 'yellow' ? '🟡' : '🔴');
}

// A read-only drill-down: transactions matching whatever the caller filtered,
// in a modal. Visualization only — fixes happen in YNAB/Xero or via the CLI.
export function showTransactions(title, rows) {
  const close = () => {
    root.hidden = true;
    root.replaceChildren();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const table = h(
    'table',
    { class: 'txns' },
    h('thead', null,
      h('tr', null, ['Date', 'Payee', 'Account', 'Category', 'Memo', 'Amount'].map((x) => h('th', null, x)))),
    h('tbody', null,
      [...rows].sort(byDateDesc).map((t) =>
        h('tr', { class: t.transfer ? 'transfer' : '' },
          h('td', null, t.date),
          h('td', null, t.payee ?? '—'),
          h('td', null, t.account ?? '—'),
          h('td', null, t.category ?? 'Uncategorized'),
          h('td', { class: 'memo' }, t.memo || ''),
          h('td', { class: `amount ${t.amount >= 0 ? 'pos' : 'neg'}` }, money(t.amount)),
        ))),
  );
  const root = document.getElementById('modal-root');
  root.replaceChildren(
    h('div', { class: 'backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
      h('div', { class: 'modal' },
        h('div', { class: 'modal-head' },
          h('strong', null, title),
          h('span', { class: 'muted' }, `${rows.length} transactions`),
          h('button', { onclick: close }, '✕ close')),
        table)),
  );
  root.hidden = false;
  document.addEventListener('keydown', onKey);
}
