import { toCents, fromCents } from './money.mjs';

// Cash movement by month and account. Unlike every other analysis, transfers
// are INCLUDED here: moving money between accounts is exactly what cash
// movement means, and the coverage question ("will this account's cash cover
// the next two weeks?") is about cash, not P&L. P&L keeps excluding them.
export function cashflow(transactions) {
  const cells = new Map(); // `${month}|${account}` -> { inCents, outCents }
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    const account = t.account ?? 'Unknown account';
    const key = `${month}|${account}`;
    const cell = cells.get(key) ?? { inCents: 0, outCents: 0 };
    const cents = toCents(t.amount);
    if (cents >= 0) cell.inCents += cents;
    else cell.outCents += -cents;
    cells.set(key, cell);
  }

  const rows = [];
  const byMonth = new Map();
  const byAccount = new Map();
  const add = (map, key, cell) => {
    const agg = map.get(key) ?? { inCents: 0, outCents: 0 };
    agg.inCents += cell.inCents;
    agg.outCents += cell.outCents;
    map.set(key, agg);
  };

  for (const [key, cell] of cells) {
    const [month, account] = key.split('|');
    rows.push({
      month,
      account,
      inflow: fromCents(cell.inCents),
      outflow: fromCents(cell.outCents),
      net: fromCents(cell.inCents - cell.outCents),
    });
    add(byMonth, month, cell);
    add(byAccount, account, cell);
  }

  const shape = (entries, key) =>
    [...entries]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, c]) => ({ [key]: k, inflow: fromCents(c.inCents), outflow: fromCents(c.outCents), net: fromCents(c.inCents - c.outCents) }));

  return {
    months: shape(byMonth, 'month'),
    accounts: shape(byAccount, 'account'),
    rows: rows.sort((a, b) => a.month.localeCompare(b.month) || a.account.localeCompare(b.account)),
  };
}
