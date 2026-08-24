// Money math in integer cents. Floats drift when summing many decimal amounts
// (0.1 + 0.2 !== 0.3); every reporting aggregate accumulates in cents and only
// converts back to currency units at the output edge.
export const toCents = (amount) => Math.round(amount * 100);
export const fromCents = (cents) => +(cents / 100).toFixed(2);

// Normalize an already-currency-unit value to a clean 2-dp number.
export const round2 = (amount) => fromCents(toCents(amount));
