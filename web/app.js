import { h, ago } from './util.mjs';
import { renderCheckpoint, renderPl, renderCashflow, renderBudget } from './views.mjs';

const VIEWS = [
  { id: 'checkpoint', label: 'Checkpoint', render: renderCheckpoint },
  { id: 'pl', label: 'P&L', render: renderPl },
  { id: 'cashflow', label: 'Cashflow', render: renderCashflow },
  { id: 'budget', label: 'Budget', render: renderBudget },
];

// Old route names keep working.
const ROUTE_ALIASES = { variance: 'budget' };

const state = { data: null, bills: null, dataError: null, billsError: null };
const ui = {}; // per-view control state (selected month/account/days), survives re-renders

async function load() {
  state.dataError = state.billsError = null;
  const dataRes = await fetch('/api/data');
  if (dataRes.ok) state.data = await dataRes.json();
  else { state.data = null; state.dataError = (await dataRes.json()).error; }
  const billsRes = await fetch('/api/bills');
  if (billsRes.ok) state.bills = await billsRes.json();
  else { state.bills = null; state.billsError = (await billsRes.json()).error; }
}

function activeView() {
  const raw = (location.hash || '#/checkpoint').replace(/^#\//, '');
  const id = ROUTE_ALIASES[raw] ?? raw;
  return VIEWS.find((v) => v.id === id) ?? VIEWS[0];
}

function render() {
  const tabs = document.getElementById('tabs');
  const active = activeView();
  tabs.replaceChildren(...VIEWS.map((v) =>
    h('a', { href: `#/${v.id}`, class: v.id === active.id ? 'active' : '' }, v.label)));

  const meta = document.getElementById('meta');
  const app = document.getElementById('app');
  if (!state.data) {
    meta.replaceChildren(h('span', { class: 'muted' }, 'no data'));
    app.replaceChildren(
      h('div', { class: 'hint' },
        h('strong', null, 'No data served'),
        h('p', null, state.dataError ?? 'Unknown error'),
        h('p', { class: 'muted' }, 'Fix it on the CLI side, then hit refresh.')));
    return;
  }

  const demo = state.data.provider === 'fixture';
  meta.replaceChildren(...[
    demo ? h('span', { class: 'tag' }, 'DEMO') : null,
    h('span', null, state.data.provider),
    h('span', null, `pulled ${ago(state.data.pulledAt)}`),
    h('span', null, `${state.data.transactions.length} txns`),
    state.billsError ? h('span', { title: state.billsError }, 'no bills registry') : null,
  ].filter(Boolean));

  app.replaceChildren(active.render(state, ui, render));
}

document.getElementById('refresh').addEventListener('click', async () => {
  await load();
  render();
});

// Theme toggle — Modernist ships light + derived dark; the choice persists.
document.getElementById('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const current = root.dataset.theme
    ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('bukz-theme', next);
});

window.addEventListener('hashchange', render);
await load();
render();
