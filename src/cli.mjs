import { parseArgs } from 'node:util';

// Options shared by every command; commands add their own via `extra`.
const COMMON = {
  provider: { type: 'string' },
  since: { type: 'string' },
  until: { type: 'string' },
  in: { type: 'string' },
};

export function parse(argv, extra = {}) {
  const { values } = parseArgs({
    args: argv,
    options: { ...COMMON, ...extra },
    allowPositionals: false,
  });
  if (values.since !== undefined && values.since !== '') {
    assertDate('--since', values.since);
  }
  if (values.until !== undefined && values.until !== '') {
    assertDate('--until', values.until);
  }
  if (values.since && values.until && values.since > values.until) {
    throw new Error(`--since (${values.since}) must not be later than --until (${values.until})`);
  }
  return values;
}

// Coerces a numeric CLI arg, or falls back when the flag is omitted entirely.
// Rejects empty/whitespace strings explicitly: Number("") and Number(" ") both
// yield 0 (not NaN), so a bare NaN check would silently accept `--z ''` as
// z=0 and misflag every transaction as an outlier. If you want the default,
// omit the flag — an explicitly-empty value is a mistake and should be surfaced.
export function num(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error(`Expected a number, got "${value}"`);
  }
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`Expected a number, got "${value}"`);
  return n;
}

// Validates a YYYY-MM-DD calendar date. The format regex is not enough: JS rolls
// impossible dates forward (2026-02-31 → 2026-03-03), so round-trip the value
// through the Date constructor and compare the rendered form back to the input.
export function assertDate(label, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD (got "${value}")`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`${label} is not a valid calendar date: "${value}"`);
  }
  return value;
}

// All command output is JSON on stdout — designed to be read by Claude, not humans.
export function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}
