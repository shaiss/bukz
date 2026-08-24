import { h, money, money0, statusChip, showTransactions } from './util.mjs';
import { profitAndLoss } from '/src/analysis/pl.mjs';
import { cashflow } from '/src/analysis/cashflow.mjs';
import { budgetVariance, defaultMonth } from '/src/analysis/variance.mjs';
import { outlook } from '/src/analysis/outlook.mjs';
import { newestDate } from '/src/analysis/period.mjs';

// Every number on screen is computed by the SAME pure modules the CLI runs —
// imported straight from src/analysis/. If the JSON says it, the chart shows
// it; nothing is re-derived here except layout.

const monthsIn = (txns) => [...new Set(txns.map((t) => t.date.slice(0, 7)))].sort().reverse();

function hint(title, body) {
  return h('div', { class: 'hint' }, h('strong', null, title), h('p', null, body));
}

// A labeled select that calls back with the picked value.
function picker(labelText, selected, options, onPick) {
  const select = h('select', null,
    options.map((o) => h('option', { value: o.value, selected: o.value === selected ? '' : null }, o.label)));
  select.addEventListener('change', () => onPick(select.value));
  return h('label', { class: 'control' }, labelText + ' ', select);
}

/* ---------------- Checkpoint (weekly deliverable view) ---------------- */

export function renderCheckpoint({ data, bills }, ui, rerender) {
  if (!data.accounts?.length) {
    return hint('No account balances in the cache',
      'Balances come with a YNAB pull — run node bin/bukz.mjs pull, refresh, and this view lights up.');
  }
  if (!bills) {
    return hint('No bills registry',
      'The outlook needs config/bills.json. Copy config/bills.example.json, edit it, restart serve (or pass --bills fixtures/bills.json for the demo).');
  }
  const days = ui.checkpointDays ?? 14;
  const o = outlook(data.transactions, data.accounts, bills, { days });
  const reference = newestDate(data.transactions);

  const dayPicker = picker('look-ahead ', String(days), [
    { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' },
  ], (v) => { ui.checkpointDays = Number(v); rerender(); });

  const banner = h('div', { class: `banner ${o.status}` },
    statusChip(o.status),
    h('span', null,
      o.status === 'green' ? 'All accounts covered' :
      `${o.accounts.filter((a) => a.status !== 'green').length} account(s) need attention`,
    ),
    h('span', { class: 'muted' }, `as of ${reference} · through ${o.window.to}`),
  );

  const accountRows = o.accounts.map((a) =>
    h('tr', { class: 'clickable', onclick: () => drillAccount(data, a.account, reference), title: 'Click for this account\u2019s recent transactions' },
      h('td', null, h('strong', null, a.account), h('div', { class: 'muted' }, a.type ?? '')),
      h('td', { class: 'num' }, money(a.balance)),
      h('td', { class: 'num' }, a.billsDue.length ? `${a.billsDue.length} due · ${money(a.projectedOutflows)}` : '—'),
      h('td', { class: 'num' }, money(a.projectedBalance)),
      h('td', null, statusChip(a.status)),
    ));

  const dueDetail = o.accounts
    .filter((a) => a.billsDue.length)
    .flatMap((a) => a.billsDue.map((b) =>
      h('tr', null,
        h('td', null, b.date),
        h('td', null, b.name),
        h('td', null, a.account),
        h('td', { class: 'num neg' }, money(-b.amount)),
      )));

  return h('div', null,
    h('div', { class: 'controls' }, dayPicker),
    banner,
    h('table', { class: 'grid' },
      h('thead', null, h('tr', null, ['Account', 'Balance', `Next ${days}d`, 'Projected', ''].map((x) => h('th', null, x)))),
      h('tbody', null, accountRows)),
    o.manualWatch.length ? h('section', null,
      h('h3', null, 'Manual payments due soon'),
      h('table', { class: 'grid' },
        h('tbody', null, o.manualWatch.map((b) => h('tr', null,
          h('td', null, b.date),
          h('td', null, b.name),
          h('td', null, b.paidFrom ?? '—'),
          h('td', { class: 'num neg' }, b.amount == null ? 'amount varies' : money(-b.amount)),
        ))))) : null,
    o.unmatchedBills.length ? h('section', null,
      h('h3', null, '⚠ Bills with an unknown paying account'),
      h('p', { class: 'muted' }, 'These bills name an account that is not in the cache — fix the name in config/bills.json so they project.'),
      h('ul', null, o.unmatchedBills.map((b) => h('li', null, `${b.name} → ${b.paidFrom}`)))) : null,
    dueDetail.length ? h('section', null, h('h3', null, 'Bills in the window'), h('table', { class: 'grid' }, h('tbody', null, dueDetail))) : null,
  );
}

function drillAccount(data, account, reference) {
  const cutoff = reference.slice(0, 8) + '01'; // month of the reference date
  const rows = data.transactions.filter((t) => t.account === account && t.date >= cutoff);
  showTransactions(`${account} — since ${cutoff}`, rows);
}

/* ---------------- P&L ---------------- */

export function renderPl({ data }, ui, rerender) {
  const months = monthsIn(data.transactions);
  if (!months.length) return hint('No transactions', 'Pull data or serve the demo fixture.');
  // ui state can outlive a data refresh — fall back when the month is gone
  const month = months.includes(ui.plMonth) ? ui.plMonth : months[0]; // CLI default: newest month
  const rows = data.transactions.filter((t) => t.date.startsWith(month));
  const pl = profitAndLoss(rows, data.categories ?? []);

  const drill = (category) =>
    showTransactions(`${month} · ${category}`, rows.filter((t) => (t.category ?? 'Uncategorized') === category));

  const side = (title, list, tone) => {
    const max = Math.max(...list.map((r) => r.total), 1);
    return h('section', { class: 'half' },
      h('h3', null, `${title} · ${money(pl.totals[title === 'Income' ? 'income' : 'expenses'])}`),
      list.length ? h('table', { class: 'grid bars' }, h('tbody', null, list.map((r) =>
        h('tr', { class: 'clickable', onclick: () => drill(r.category) },
          h('td', null, h('strong', null, r.category), r.group ? h('div', { class: 'muted' }, r.group) : null),
          h('td', { class: 'bar-cell' }, h('div', { class: `bar ${tone}`, style: `width:${(r.total / max) * 100}%` })),
          h('td', { class: 'num' }, h('span', null, money(r.total)), h('div', { class: 'muted' }, `${r.count} txn`)),
        )))) : h('p', { class: 'muted' }, 'none'));
  };

  return h('div', null,
    h('div', { class: 'controls' }, picker('month ', month, months.map((m) => ({ value: m, label: m })), (v) => { ui.plMonth = v; rerender(); })),
    h('div', { class: 'cards' },
      card('Income', pl.totals.income, 'pos'),
      card('Expenses', pl.totals.expenses, 'neg'),
      card('Net', pl.totals.net, pl.totals.net >= 0 ? 'pos' : 'neg')),
    h('div', { class: 'split' },
      side('Income', pl.income, 'pos'),
      side('Expenses', pl.expenses, 'neg')),
    h('p', { class: 'muted' }, 'Click a category to see its transactions. Refunds (positive amounts in spending categories) appear on the income side — sign-based, same as the pl command.'));
}

function card(label, value, tone) {
  return h('div', { class: 'card' }, h('div', { class: 'muted' }, label), h('div', { class: `card-value ${tone}` }, money0(value)));
}

/* ---------------- Cashflow ---------------- */

export function renderCashflow({ data }, ui, rerender) {
  const accounts = ['All', ...new Set(data.transactions.map((t) => t.account ?? 'Unknown account'))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b));
  const account = ui.cfAccount ?? 'All';
  const txns = account === 'All' ? data.transactions : data.transactions.filter((t) => (t.account ?? 'Unknown account') === account);
  const cf = cashflow(txns);
  if (!cf.months.length) return hint('No transactions', 'Nothing to chart yet.');

  const max = Math.max(...cf.months.flatMap((m) => [m.inflow, m.outflow]), 1);
  const chart = h('div', { class: 'cf-chart' }, cf.months.map((m) =>
    h('div', {
      class: 'cf-month clickable',
      title: `${m.month}\nin ${money(m.inflow)} · out ${money(m.outflow)} · net ${money(m.net)}`,
      onclick: () => showTransactions(`${m.month}${account === 'All' ? '' : ' · ' + account}`, txns.filter((t) => t.date.startsWith(m.month))),
    },
      h('div', { class: 'cf-bars' },
        h('div', { class: 'cf-col up' }, h('div', { class: 'bar pos', style: `height:${(m.inflow / max) * 100}%` })),
        h('div', { class: 'cf-col down' }, h('div', { class: 'bar neg', style: `height:${(m.outflow / max) * 100}%` }))),
      h('div', { class: `cf-net ${m.net >= 0 ? 'pos' : 'neg'}` }, money0(m.net)),
      h('div', { class: 'cf-label' }, m.month.slice(2)), // 26-07 style, compact
    )));

  return h('div', null,
    h('div', { class: 'controls' }, picker('account ', account, accounts.map((a) => ({ value: a, label: a })), (v) => { ui.cfAccount = v; rerender(); })),
    h('div', { class: 'legend muted' }, '▉ in　▉ out　· net under each month · transfers included (cash movement) · click a month to drill in'),
    chart,
    h('table', { class: 'grid' },
      h('thead', null, h('tr', null, ['Month', 'In', 'Out', 'Net'].map((x) => h('th', null, x)))),
      h('tbody', null, cf.months.map((m) => h('tr', null,
        h('td', null, m.month),
        h('td', { class: 'num pos' }, money(m.inflow)),
        h('td', { class: 'num neg' }, money(m.outflow)),
        h('td', { class: `num ${m.net >= 0 ? 'pos' : 'neg'}` }, money(m.net)))))));
}

/* ---------------- Variance (budget vs actual) ---------------- */

export function renderVariance({ data }, ui, rerender) {
  if (!data.budgetMonths?.length) {
    return hint('No budget months in the cache',
      'Budget snapshots come with a YNAB pull (the /months endpoint). Pull, refresh, and this view fills in.');
  }
  const months = data.budgetMonths.map((m) => m.month).sort().reverse();
  const month = months.includes(ui.varMonth)
    ? ui.varMonth
    : defaultMonth(data.transactions, data.budgetMonths);
  const v = budgetVariance(data.transactions, data.budgetMonths, month);
  const rows = data.transactions.filter((t) => t.date.startsWith(month));
  const scale = Math.max(...v.categories.map((r) => Math.max(r.budgeted, r.actual)), 1);
  // Sum the computed rows in cents so the headline can't drift from them
  const spent = Math.round(v.categories.reduce((n, r) => n + r.actual * 100, 0)) / 100;

  return h('div', null,
    h('div', { class: 'controls' }, picker('month ', month, months.map((m) => ({ value: m, label: m })), (x) => { ui.varMonth = x; rerender(); })),
    h('div', { class: 'cards' },
      card('Budgeted', v.snapshot.budgeted, ''),
      card('Spent (recomputed)', spent, 'neg'),
      card('Ready to assign', v.snapshot.toBeBudgeted, v.snapshot.toBeBudgeted >= 0 ? 'pos' : 'neg')),
    h('table', { class: 'grid bars' },
      h('thead', null, h('tr', null, ['Category', 'Budget → Actual', 'Actual', 'Remaining'].map((x) => h('th', null, x)))),
      h('tbody', null, v.categories.map((r) =>
        h('tr', {
          class: 'clickable',
          onclick: () => showTransactions(`${month} · ${r.category}`, rows.filter((t) => (t.category ?? 'Uncategorized') === r.category)),
        },
          h('td', null, h('strong', null, r.category), r.budgeted === 0 ? h('div', { class: 'muted' }, 'not budgeted') : null),
          h('td', { class: 'bar-cell' },
            h('div', { class: 'bar track', style: `width:${(r.budgeted / scale) * 100}%` }, null),
            h('div', { class: `bar fill ${r.actual > r.budgeted ? 'over' : 'under'}`, style: `width:${(r.actual / scale) * 100}%` }, null)),
          h('td', { class: 'num' }, money(r.actual)),
          h('td', { class: `num ${r.remaining >= 0 ? 'pos' : 'neg'}` }, money(r.remaining)),
        )))),
    h('p', { class: 'muted' }, 'Budgeted comes from the YNAB month snapshot; actual is recomputed from cached transactions (refunds net against spend). Uncategorized spend shows as unbudgeted overshoot.'));
}
