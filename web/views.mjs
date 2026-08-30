import { h, money, money0, statusChip, showTransactions, copyOnClick } from './util.mjs';
import { profitAndLoss } from '/src/analysis/pl.mjs';
import { cashflow } from '/src/analysis/cashflow.mjs';
import { budgetVariance, defaultMonth } from '/src/analysis/variance.mjs';
import { monthAhead, planMonthFunding } from '/src/analysis/budget.mjs';
import { outlook } from '/src/analysis/outlook.mjs';
import { newestDate, addDays } from '/src/analysis/period.mjs';

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
      h('h3', null, 'Bills with an unknown paying account'),
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

// Rolling windows anchor at the newest transaction date (the data's "now",
// never the wall clock) so a stale cache still shows the days it knows about.
const QUICK_RANGES = [
  { value: 'd7', label: 'last 7 days' },
  { value: 'd14', label: 'last 14 days' },
  { value: 'd30', label: 'last 30 days' },
  { value: 'custom', label: 'custom range…' },
];

export function renderPl({ data }, ui, rerender) {
  const months = monthsIn(data.transactions);
  if (!months.length) return hint('No transactions', 'Pull data or serve the demo fixture.');
  const anchor = newestDate(data.transactions);
  // ui state can outlive a data refresh — fall back when the month is gone
  const month = months.includes(ui.plMonth) ? ui.plMonth : months[0]; // CLI default: newest month
  const period = ui.plPeriod ?? month;

  let label;
  let rows;
  if (period.startsWith('d')) {
    const days = Number(period.slice(1));
    const from = addDays(anchor, -(days - 1));
    label = `${from} → ${anchor}`;
    rows = data.transactions.filter((t) => t.date >= from && t.date <= anchor);
  } else if (period === 'custom') {
    const from = ui.plFrom ?? addDays(anchor, -13);
    const to = ui.plTo ?? anchor;
    if (from > to) {
      return h('div', null,
        plControls(ui, rerender, month, anchor, months),
        hint('Range is empty', `"from" (${from}) must be on or before "to" (${to}).`));
    }
    label = `${from} → ${to}`;
    rows = data.transactions.filter((t) => t.date >= from && t.date <= to);
  } else {
    label = period;
    rows = data.transactions.filter((t) => t.date.startsWith(period));
  }
  const pl = profitAndLoss(rows, data.categories ?? []);

  const drill = (category) =>
    showTransactions(`${label} · ${category}`, rows.filter((t) => (t.category ?? 'Uncategorized') === category));

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
    plControls(ui, rerender, month, anchor, months),
    h('div', { class: 'cards' },
      card('Income', pl.totals.income, 'pos'),
      card('Expenses', pl.totals.expenses, 'neg'),
      card('Net', pl.totals.net, pl.totals.net >= 0 ? 'pos' : 'neg'),
      card('Transactions', rows.length, '')),
    h('div', { class: 'split' },
      side('Income', pl.income, 'pos'),
      side('Expenses', pl.expenses, 'neg')),
    h('p', { class: 'muted' }, 'Click a category to see its transactions. Refunds (positive amounts in spending categories) appear on the income side — sign-based, same as the pl command.'));
}

// The period control: whole months, rolling windows, or a custom from–to pair
// (date inputs appear only in custom mode). "Last N days" is measured from the
// data's newest transaction, shown in the legend.
function plControls(ui, rerender, month, anchor, months) {
  const dateInput = (key, value, min, max) => {
    const input = h('input', { type: 'date', value, min, max });
    input.addEventListener('change', () => { ui[key] = input.value || value; rerender(); });
    return h('label', { class: 'control' }, key === 'plFrom' ? 'from ' : 'to ', input);
  };
  return h('div', { class: 'controls' },
    picker('period ', ui.plPeriod ?? month,
      [...QUICK_RANGES, ...months.map((m) => ({ value: m, label: m }))],
      (v) => { ui.plPeriod = v; rerender(); }),
    (ui.plPeriod === 'custom')
      ? [
        dateInput('plFrom', ui.plFrom ?? addDays(anchor, -13), months.at(-1) + '-01', anchor),
        dateInput('plTo', ui.plTo ?? anchor, months.at(-1) + '-01', anchor),
      ]
      : null);
}

function card(label, value, tone) {
  // Numbers are money; anything else (e.g. "121 days", "—") renders as-is.
  const display = typeof value === 'number' ? money0(value) : value;
  return h('div', { class: 'card' }, h('div', { class: 'muted' }, label), h('div', { class: `card-value ${tone}` }, display));
}

/* ---------------- Cashflow ---------------- */

export function renderCashflow({ data }, ui, rerender) {
  const accounts = ['All', ...new Set(data.transactions.map((t) => t.account ?? 'Unknown account'))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b));
  const account = ui.cfAccount ?? 'All';
  const txns = account === 'All' ? data.transactions : data.transactions.filter((t) => (t.account ?? 'Unknown account') === account);
  const cf = cashflow(txns);
  if (!cf.months.length) return hint('No transactions', 'Nothing to chart yet.');

  const drill = (m) =>
    showTransactions(`${m.month}${account === 'All' ? '' : ' · ' + account}`, txns.filter((t) => t.date.startsWith(m.month)));
  const tip = (m) => `${m.month}\nin ${money(m.inflow)} · out ${money(m.outflow)} · net ${money(m.net)}`;

  const mode = ui.cfMode ?? 'net';
  let chart;
  if (mode === 'net') chart = netBars(cf, drill, tip);
  else if (mode === 'in-out') chart = inOutRows(cf, drill, tip);
  else chart = cumulativeLine(cf);

  const legends = {
    net: 'one bar per month: above the line = cash built (green), below = cash drained (red) · hover for in/out · click a month to drill in',
    'in-out': 'money in (green) vs money out (red) per month, scaled to the biggest month · click a month to drill in',
    cumulative: 'running cash movement since the first cached month — the shape of your cash position · click a month in the table to drill in',
  };

  return h('div', null,
    h('div', { class: 'controls' },
      picker('account ', account, accounts.map((a) => ({ value: a, label: a })), (v) => { ui.cfAccount = v; rerender(); }),
      picker('view ', mode, [
        { value: 'net', label: 'net per month' },
        { value: 'in-out', label: 'in vs out' },
        { value: 'cumulative', label: 'cumulative' },
      ], (v) => { ui.cfMode = v; rerender(); })),
    h('div', { class: 'legend' }, `transfers included (cash movement) · ${legends[mode]}`),
    chart,
    h('table', { class: 'grid clickable' },
      h('thead', null, h('tr', null, ['Month', 'In', 'Out', 'Net'].map((x) => h('th', null, x)))),
      h('tbody', null, cf.months.map((m) => h('tr', { class: 'clickable', onclick: () => drill(m), title: tip(m) },
        h('td', null, m.month),
        h('td', { class: 'num pos' }, money(m.inflow)),
        h('td', { class: 'num neg' }, money(m.outflow)),
        h('td', { class: `num ${m.net >= 0 ? 'pos' : 'neg'}` }, money(m.net)))))));
}

// Mode 1 — one signed bar per month around a zero line. The question this
// answers: which months built cash, which drained it.
function netBars(cf, drill, tip) {
  const max = Math.max(...cf.months.map((m) => Math.abs(m.net)), 1);
  return h('div', { class: 'net-chart' }, cf.months.map((m) =>
    h('div', {
      class: 'net-month clickable',
      title: tip(m),
      onclick: () => drill(m),
    },
      h('div', { class: 'net-col' },
        h('div', { class: 'net-half up' }, m.net > 0 ? h('div', { class: 'bar pos', style: `height:${(m.net / max) * 96}%` }) : null),
        h('div', { class: 'net-half down' }, m.net < 0 ? h('div', { class: 'bar neg', style: `height:${(-m.net / max) * 96}%` }) : null)),
      h('div', { class: `cf-net ${m.net >= 0 ? 'pos' : 'neg'}` }, money0(m.net)),
      h('div', { class: 'cf-label' }, m.month.slice(2)),
    )));
}

// Mode 2 — ledger rows: each month's in and out as horizontal bars scaled to
// the biggest month. The question this answers: how big was the flow, and did
// in cover out.
function inOutRows(cf, drill, tip) {
  const max = Math.max(...cf.months.flatMap((m) => [m.inflow, m.outflow]), 1);
  return h('div', { class: 'io-rows' }, cf.months.map((m) =>
    h('div', { class: 'io-row clickable', title: tip(m), onclick: () => drill(m) },
      h('div', { class: 'io-month' }, m.month.slice(2)),
      h('div', { class: 'io-bars' },
        h('div', { class: 'bar pos', style: `width:${(m.inflow / max) * 100}%` }),
        h('div', { class: 'bar neg', style: `width:${(m.outflow / max) * 100}%` })),
      h('div', { class: 'io-nums' },
        h('span', { class: 'pos' }, '+' + money0(m.inflow)),
        h('span', { class: 'neg' }, '−' + money0(m.outflow)),
        h('span', { class: `net ${m.net >= 0 ? 'pos' : 'neg'}` }, (m.net >= 0 ? '+' : '−') + money0(Math.abs(m.net)))),
    )));
}

// Mode 3 — cumulative net as a stepped line: the running cash movement since
// the first cached month. The question this answers: what happened to my cash
// position over time. Hand-rolled SVG — no chart library.
function cumulativeLine(cf) {
  const W = 900;
  const H = 240;
  const PAD = { l: 8, r: 8, t: 18, b: 24 };
  let running = 0;
  const points = cf.months.map((m) => ({ month: m.month, value: (running += m.net) }));
  const maxV = Math.max(...points.map((p) => p.value), 0);
  const minV = Math.min(...points.map((p) => p.value), 0);
  const span = maxV - minV || 1;
  const x = (i) => PAD.l + (i / Math.max(points.length - 1, 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - minV) / span) * (H - PAD.t - PAD.b);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ticks = points.filter((_, i) => i % Math.ceil(points.length / 8) === 0 || i === points.length - 1);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'cum-svg');
  const zero = y(0);
  for (const [attrs, text] of [
    [{ x1: PAD.l, x2: W - PAD.r, y1: zero, y2: zero, class: 'zero' }, null],
    ...ticks.map((p) => {
      const i = points.indexOf(p);
      return [{ x1: x(i), x2: x(i), y1: H - PAD.b + 2, y2: H - PAD.b + 7, class: 'tick' }, null];
    }),
  ]) {
    const line = document.createElementNS(svgNS, 'line');
    for (const [k, v] of Object.entries(attrs)) line.setAttribute(k, v);
    svg.append(line);
  }
  const pathEl = document.createElementNS(svgNS, 'path');
  pathEl.setAttribute('d', path);
  pathEl.setAttribute('class', 'cum-line');
  svg.append(pathEl);
  for (const [i, p] of points.entries()) {
    const dot = document.createElementNS(svgNS, 'rect');
    dot.setAttribute('x', x(i) - 3);
    dot.setAttribute('y', y(p.value) - 3);
    dot.setAttribute('width', 6);
    dot.setAttribute('height', 6);
    dot.setAttribute('class', `cum-dot ${p.value >= 0 ? 'pos' : 'neg'}`);
    const title = document.createElementNS(svgNS, 'title');
    title.textContent = `${p.month} · cumulative ${money(p.value)}`;
    dot.append(title);
    svg.append(dot);
  }
  for (const p of ticks) {
    const i = points.indexOf(p);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', x(i));
    label.setAttribute('y', H - 8);
    label.setAttribute('text-anchor', i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle');
    label.setAttribute('class', 'cum-label');
    label.textContent = p.month.slice(2);
    svg.append(label);
  }
  const first = points[0];
  const last = points.at(-1);
  const summary = h('div', { class: 'cards' },
    card('First month', first.value, first.value >= 0 ? 'pos' : 'neg'),
    card('Latest cumulative', last.value, last.value >= 0 ? 'pos' : 'neg'),
    card('Best month', Math.max(...cf.months.map((m) => m.net)), 'pos'),
    card('Worst month', Math.min(...cf.months.map((m) => m.net)), 'neg'));
  return h('div', null, summary, svg);
}

/* ---------------- Budget (variance + month-ahead, read-only) ---------------- */

export function renderBudget({ data }, ui, rerender) {
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
  // Sum the computed rows in cents so the headline can't drift from them
  const spent = Math.round(v.categories.reduce((n, r) => n + r.actual * 100, 0)) / 100;
  const assigned = Math.round(v.categories.reduce((n, r) => n + r.budgeted * 100, 0)) / 100;
  const left = Math.round((assigned - spent) * 100) / 100;
  const scale = Math.max(...v.categories.map((r) => Math.max(r.budgeted, r.actual)), 1);
  const ahead = monthAhead(data.transactions, data.budgetMonths);
  const hasGoals = v.categories.some((r) => r.target != null);
  const rta = v.snapshot.toBeBudgeted;

  // ---- the month-ahead panel (always visible; honest when unfunded) ----
  const meterRow = ahead.next.fundedPct != null
    ? h('div', { class: 'meter-row' },
        h('span', { class: 'meter-label' }, `${ahead.next.month} funded (of ${money0(ahead.next.reference)})`),
        h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${Math.min(ahead.next.fundedPct, 100)}%` })),
        h('span', { class: `meter-pct ${ahead.next.fundedPct >= 100 ? 'pos' : ''}` }, `${ahead.next.fundedPct}%`))
    : h('div', { class: 'meter-row' },
        h('span', { class: 'meter-label muted' }, `${ahead.next.month}: ${money0(ahead.next.assigned)} assigned — no reference budget to measure against (no month was ever funded at category level)`),
        h('div', { class: 'meter' }),
        h('span', { class: 'meter-pct muted' }, '—'));

  const monthAheadPanel = h('section', { class: 'ahead-panel' },
    h('h3', null, `Month ahead — living in ${ahead.focusMonth}`),
    h('div', { class: 'cards' },
      card('Age of money', ahead.ageOfMoney == null ? '—' : `${ahead.ageOfMoney} days`, ahead.ageOfMoney >= 30 ? 'pos' : ahead.ageOfMoney == null ? '' : 'neg'),
      card('Ready to assign', rta, rta >= 0 ? 'pos' : 'neg'),
      card(`${ahead.next.month} assigned`, ahead.next.assigned, ahead.next.fundedPct >= 100 ? 'pos' : '')),
    meterRow,
    ageOfMoneyTrend(data.budgetMonths),
  );

  return h('div', null,
    monthAheadPanel,
    h('section', null,
      h('h3', null, 'This month vs budget'),
      h('div', { class: 'controls' }, picker('month ', month, months.map((m) => ({ value: m, label: m })), (x) => { ui.varMonth = x; rerender(); })),
      h('div', { class: 'cards' },
        card('Assigned for month', assigned, ''),
        card('Spent (recomputed)', spent, 'neg'),
        card('Left to spend', left, left >= 0 ? 'pos' : 'neg')),
      h('table', { class: 'grid bars' },
        h('thead', null, h('tr', null,
          ['Category', 'Budget → Actual', ...(hasGoals ? ['Target'] : []), 'Actual', 'Remaining'].map((x) => h('th', null, x)))),
        h('tbody', null, v.categories.map((r) =>
          h('tr', {
            class: 'clickable',
            onclick: () => showTransactions(`${month} · ${r.category}`, rows.filter((t) => (t.category ?? 'Uncategorized') === r.category)),
          },
            h('td', null,
              h('strong', null, r.category),
              r.budgeted === 0 ? h('div', { class: 'muted' }, 'not budgeted') : null,
              r.target != null && r.budgeted < r.target ? h('span', { class: 'tag' }, 'under goal') : null),
            h('td', { class: 'bar-cell' },
              h('div', { class: 'bar track', style: `width:${(r.budgeted / scale) * 100}%` }, null),
              h('div', { class: `bar fill ${r.actual > r.budgeted ? 'over' : 'under'}`, style: `width:${(r.actual / scale) * 100}%` }, null)),
            ...(hasGoals ? [h('td', { class: 'num muted' }, r.target == null ? '—' : money0(r.target))] : []),
            h('td', { class: 'num' }, money(r.actual)),
            h('td', { class: `num ${r.remaining >= 0 ? 'pos' : 'neg'}` }, money(r.remaining)),
          )))),
      h('p', { class: 'muted' }, 'Budgeted and target come from the YNAB month snapshot (per-category assignments and goals); actual is recomputed from cached transactions, so refunds net against spend. YNAB is the source of truth for budgets — assigning dollars is CLI-only (read-only dashboard): node bin/bukz.mjs assign')),
    fundingPanel(data, ui, rerender, month, months));
}

// "Fund this month" — repeat a prior month's YNAB budget onto the viewed
// month. Every line is a dry-run-first CLI command the user copies and runs
// themselves; the SPA never writes. Click a line (or row) to copy it.
function fundingPanel({ budgetMonths }, ui, rerender, month, months) {
  const others = months.filter((m) => m !== month);
  if (!others.length) return null;
  const hasAssigned = (m) =>
    (budgetMonths.find((b) => b.month === m)?.categories ?? []).some((c) => c.budgeted > 0);
  const fallback = others.find(hasAssigned) ?? others[0];
  const source = others.includes(ui.budgetCopyFrom) ? ui.budgetCopyFrom : fallback;
  const plan = planMonthFunding({ fromMonth: source, toMonth: month, budgetMonths });

  const whole = `node bin/bukz.mjs assign --month ${month} --copy-from ${source}`;
  const oneCmd = (r) =>
    `node bin/bukz.mjs assign --month ${month} --category "${r.category}" --amount ${r.proposed}`;

  const planRows = plan.assignments.map((r) =>
    h('tr', {
      class: 'clickable',
      title: `click to copy: ${oneCmd(r)}`,
      onclick: copyOnClick(oneCmd(r)),
    },
      h('td', null, h('strong', null, r.category)),
      h('td', { class: 'num' }, money(r.from)),
      h('td', { class: 'num muted' }, r.current == null ? '—' : money(r.current)),
      h('td', { class: 'num' }, money(r.proposed)),
      h('td', { class: `num ${r.delta >= 0 ? 'pos' : 'neg'}` }, (r.delta >= 0 ? '+' : '−') + money(Math.abs(r.delta))),
    ));

  return h('section', null,
    h('h3', null, `Fund ${month} — repeat a prior month's budget`),
    h('div', { class: 'controls' },
      picker('copy from ', source, others.map((m) => ({ value: m, label: m })), (v) => { ui.budgetCopyFrom = v; rerender(); })),
    plan.assignments.length
      ? [
        h('div', {
          class: 'cmd-line clickable',
          title: 'click to copy — runs as a dry-run first; add --yes after reviewing',
          onclick: copyOnClick(whole),
        }, whole),
        h('p', { class: 'muted' },
          `${plan.assignments.length} categories change · shifts ${money(plan.planTotal)} into ${month}` +
          (plan.readyToAssign != null ? ` · Ready to assign was ${money(plan.readyToAssign)} at last pull` : '') +
          ' · every command dry-runs first; add --yes only after reviewing its plan. Or click a row to copy that one category.'),
        h('table', { class: 'grid' },
          h('thead', null, h('tr', null, ['Category', `${source} budget`, 'Current', 'Proposed', 'Δ'].map((x) => h('th', null, x)))),
          h('tbody', null, planRows)),
      ]
      : h('p', { class: 'muted' }, `${month} already matches ${source}'s budget — nothing to change.`));
}

// Age of Money across all cached months, with the 30-day "month ahead"
// threshold marked. Flat ink line, square markers — same chart grammar as the
// cumulative cashflow line.
function ageOfMoneyTrend(budgetMonths) {
  const points = budgetMonths.filter((m) => m.ageOfMoney != null);
  if (points.length < 2) return null;
  const W = 900;
  const H = 140;
  const PAD = { l: 8, r: 8, t: 14, b: 20 };
  const maxV = Math.max(...points.map((p) => p.ageOfMoney), 30);
  const x = (i) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / maxV) * (H - PAD.t - PAD.b);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'cum-svg');
  const guide = document.createElementNS(svgNS, 'line');
  guide.setAttribute('x1', PAD.l);
  guide.setAttribute('x2', W - PAD.r);
  guide.setAttribute('y1', y(30));
  guide.setAttribute('y2', y(30));
  guide.setAttribute('class', 'aom-guide');
  svg.append(guide);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.ageOfMoney).toFixed(1)}`).join(' ');
  const pathEl = document.createElementNS(svgNS, 'path');
  pathEl.setAttribute('d', path);
  pathEl.setAttribute('class', 'cum-line');
  svg.append(pathEl);
  for (const [i, p] of points.entries()) {
    const dot = document.createElementNS(svgNS, 'rect');
    dot.setAttribute('x', x(i) - 3);
    dot.setAttribute('y', y(p.ageOfMoney) - 3);
    dot.setAttribute('width', 6);
    dot.setAttribute('height', 6);
    dot.setAttribute('class', `cum-dot ${p.ageOfMoney >= 30 ? 'pos' : 'neg'}`);
    const title = document.createElementNS(svgNS, 'title');
    title.textContent = `${p.month} · ${p.ageOfMoney} days`;
    dot.append(title);
    svg.append(dot);
    if (i === 0 || i === points.length - 1) {
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', x(i));
      label.setAttribute('y', H - 6);
      label.setAttribute('text-anchor', i === 0 ? 'start' : 'end');
      label.setAttribute('class', 'cum-label');
      label.textContent = `${p.month.slice(2)} · ${p.ageOfMoney}d`;
      svg.append(label);
    }
  }
  const guideLabel = document.createElementNS(svgNS, 'text');
  guideLabel.setAttribute('x', W - PAD.r);
  guideLabel.setAttribute('y', y(30) - 4);
  guideLabel.setAttribute('text-anchor', 'end');
  guideLabel.setAttribute('class', 'cum-label');
  guideLabel.textContent = '30 days = a month ahead';
  svg.append(guideLabel);
  return svg;
}
