// Pure parsers: Google Sheets `values` grids (array-of-arrays, first row =
// headers) → the same JSON shapes `config/bills.json` and `config/rules.json`
// use. Column headers are matched case-insensitively; unknown columns are
// ignored. Keep these free of `node:*` so they stay easy to unit-test.

function normHeader(h) {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function headerIndex(headerRow) {
  const idx = new Map();
  headerRow.forEach((h, i) => {
    const key = normHeader(h);
    if (key && !idx.has(key)) idx.set(key, i);
  });
  return idx;
}

function cell(row, idx, name) {
  const i = idx.get(normHeader(name));
  if (i === undefined) return undefined;
  const v = row[i];
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function parseBool(raw, fallback = true) {
  if (raw === undefined || raw === '') return fallback;
  const s = String(raw).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return fallback;
}

function parseNumberOrNull(raw) {
  if (raw === undefined || raw === '') return null;
  const n = Number(String(raw).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(raw) {
  const n = parseNumberOrNull(raw);
  if (n === null) return null;
  return Number.isInteger(n) ? n : Math.trunc(n);
}

// Bills sheet columns (see docs/sheets-config.md / config/bills.example.json):
// name | amount | cadence | dayOfMonth | month | anchor | paidFrom | autopay | active | notes
export function parseBillsGrid(values) {
  if (!values?.length) return [];
  const [header, ...rows] = values;
  const idx = headerIndex(header);
  if (!idx.has('name')) {
    throw new Error(
      'Bills sheet is missing a "name" header column. Expected: name, amount, cadence, ' +
        'dayOfMonth, month, anchor, paidFrom, autopay, active, notes'
    );
  }
  const out = [];
  for (const row of rows) {
    if (!row || row.every((c) => String(c ?? '').trim() === '')) continue;
    const name = cell(row, idx, 'name');
    if (!name) continue;
    const bill = {
      name,
      amount: parseNumberOrNull(cell(row, idx, 'amount')),
      cadence: cell(row, idx, 'cadence') || 'monthly',
      dayOfMonth: parseIntOrNull(cell(row, idx, 'dayofmonth')),
      month: parseIntOrNull(cell(row, idx, 'month')),
      anchor: cell(row, idx, 'anchor') || null,
      paidFrom: cell(row, idx, 'paidfrom') || null,
      autopay: cell(row, idx, 'autopay') || 'no',
      active: parseBool(cell(row, idx, 'active'), true),
      notes: cell(row, idx, 'notes') || undefined,
    };
    if (!bill.notes) delete bill.notes;
    if (bill.anchor === null) delete bill.anchor;
    if (bill.month === null) delete bill.month;
    if (bill.dayOfMonth === null) delete bill.dayOfMonth;
    out.push(bill);
  }
  return out;
}

// Rules sheet columns (see docs/sheets-config.md / config/rules.example.json):
// payee | category | active | notes
// Exact payee string match for now (no fuzzy variants in this slice).
export function parseRulesGrid(values) {
  if (!values?.length) return [];
  const [header, ...rows] = values;
  const idx = headerIndex(header);
  // Accept "payee" or "payeepattern" as the payee column label.
  const payeeKey = idx.has('payee') ? 'payee' : idx.has('payeepattern') ? 'payeepattern' : null;
  if (!payeeKey || !idx.has('category')) {
    throw new Error(
      'Rules sheet is missing "payee" (or "payeePattern") and/or "category" header columns. ' +
        'Expected: payee, category, active, notes'
    );
  }
  const out = [];
  for (const row of rows) {
    if (!row || row.every((c) => String(c ?? '').trim() === '')) continue;
    const payee = cell(row, idx, payeeKey);
    const category = cell(row, idx, 'category');
    if (!payee || !category) continue;
    const rule = {
      payee,
      category,
      active: parseBool(cell(row, idx, 'active'), true),
      notes: cell(row, idx, 'notes') || undefined,
    };
    if (!rule.notes) delete rule.notes;
    out.push(rule);
  }
  return out;
}
