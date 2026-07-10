import { parse, out } from '../cli.mjs';
import { getProvider } from '../providers/index.mjs';

// Config doctor. Prints ONLY booleans/counts — never secret values.
export async function run(argv) {
  const opts = parse(argv);
  const provider = getProvider(opts.provider);
  let api;
  try {
    api = await provider.checkAuth();
  } catch (err) {
    api = { ok: false, error: err.message };
  }
  out({
    provider: provider.name,
    env: {
      YNAB_ACCESS_TOKEN: Boolean(process.env.YNAB_ACCESS_TOKEN),
      YNAB_BUDGET_ID: process.env.YNAB_BUDGET_ID || '(default: last-used)',
      XERO_CLIENT_ID: Boolean(process.env.XERO_CLIENT_ID),
      XERO_CLIENT_SECRET: Boolean(process.env.XERO_CLIENT_SECRET),
      XERO_TENANT_ID: Boolean(process.env.XERO_TENANT_ID),
    },
    api,
  });
}
