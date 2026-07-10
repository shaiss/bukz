import * as ynab from './ynab.mjs';
import * as xero from './xero.mjs';

// Every provider normalizes to this transaction shape:
// {
//   id: string,             // provider transaction id (":n" suffix for split lines)
//   date: 'YYYY-MM-DD',
//   amount: number,         // currency units; NEGATIVE = outflow, POSITIVE = inflow
//   payee: string|null,
//   category: string|null,  // null = uncategorized
//   categoryId: string|null,
//   account: string|null,
//   memo: string,
//   status: 'cleared'|'uncleared'|'reconciled',
//   approved: boolean,
//   transfer: boolean,      // analysis excludes transfers
//   provider: string,
// }
// Required exports per provider: listSources, checkAuth, fetchCategories,
// fetchTransactions({ since }).

const PROVIDERS = { ynab, xero };

export function getProvider(name) {
  const key = (name || process.env.BUKZ_PROVIDER || 'ynab').toLowerCase();
  const impl = PROVIDERS[key];
  if (!impl) {
    throw new Error(`Unknown provider "${key}". Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return { name: key, ...impl };
}
