import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './env.mjs';

export const CACHE_PATH = resolve(ROOT, 'data', 'transactions.json');

// Cache shape: { pulledAt, provider, since, categories: [...], transactions: [...] }
// Transactions are the normalized cross-provider shape (see providers/index.mjs).

export function saveCache(data) {
  mkdirSync(resolve(ROOT, 'data'), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2));
}

export function loadData(opts = {}) {
  const path = opts.in ? resolve(process.cwd(), opts.in) : CACHE_PATH;
  if (!existsSync(path)) {
    throw new Error(
      opts.in
        ? `No such file: ${path}`
        : 'No transaction cache yet. Run: node bin/bukz.mjs pull  ' +
          '(or use demo data: --in fixtures/sample.json)'
    );
  }
  const data = JSON.parse(readFileSync(path, 'utf8'));
  let transactions = data.transactions ?? [];
  if (opts.since) transactions = transactions.filter((t) => t.date >= opts.since);
  return { ...data, transactions };
}

// Every analysis command leads its output with this so Claude can judge staleness.
export function meta(data, opts = {}) {
  return {
    provider: data.provider,
    pulledAt: data.pulledAt,
    since: opts.since ?? data.since ?? null,
    transactionCount: data.transactions.length,
  };
}
