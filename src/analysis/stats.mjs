// Small statistics toolkit. Robust estimators (median/MAD) are used everywhere
// because transaction amounts are heavy-tailed — one rent payment would wreck
// a mean/stdev-based outlier test.

export const sum = (arr) => arr.reduce((a, b) => a + b, 0);

export const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Median absolute deviation — a robust spread measure.
export function mad(arr) {
  const m = median(arr);
  return median(arr.map((x) => Math.abs(x - m)));
}

// Robust z-score. 0.6745 rescales MAD to be stdev-comparable for normal data.
// When history is perfectly consistent (MAD = 0, e.g. a fixed subscription),
// score relative deviation instead: a >35% change clears the default 3.5
// threshold, a small price bump does not. Capped at 99.
export function robustZ(x, arr) {
  if (!arr.length) return 0;
  const m = median(arr);
  const d = mad(arr);
  if (d > 0) return (0.6745 * (x - m)) / d;
  if (x === m) return 0;
  const relative = Math.abs(x - m) / Math.max(Math.abs(m), 1);
  return Math.min(99, relative * 10) * Math.sign(x - m);
}

export function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

// Both dates are YYYY-MM-DD strings; parsing them yields UTC midnights,
// so the difference is exact whole days regardless of local timezone.
export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86_400_000);
}
