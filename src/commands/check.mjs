import { parse, out } from '../cli.mjs';
import { getProvider } from '../providers/index.mjs';
import { sheetsConfigured } from '../sheets/auth.mjs';
import { checkAuth as checkSheetsAuth } from '../sheets/client.mjs';

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

  let sheets;
  if (!sheetsConfigured()) {
    sheets = { ok: false, configured: false, error: 'Sheets env vars unset' };
  } else {
    try {
      sheets = { ...(await checkSheetsAuth()), configured: true };
    } catch (err) {
      sheets = { ok: false, configured: true, error: err.message };
    }
  }

  out({
    provider: provider.name,
    env: {
      YNAB_ACCESS_TOKEN: Boolean(process.env.YNAB_ACCESS_TOKEN),
      YNAB_BUDGET_ID: process.env.YNAB_BUDGET_ID || '(default: last-used)',
      XERO_CLIENT_ID: Boolean(process.env.XERO_CLIENT_ID),
      XERO_CLIENT_SECRET: Boolean(process.env.XERO_CLIENT_SECRET),
      XERO_TENANT_ID: Boolean(process.env.XERO_TENANT_ID),
      GOOGLE_SERVICE_ACCOUNT_FILE: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_FILE),
      GOOGLE_SHEETS_SPREADSHEET_ID: Boolean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID),
      GOOGLE_SHEETS_BILLS_TAB: Boolean(process.env.GOOGLE_SHEETS_BILLS_TAB),
      GOOGLE_SHEETS_RULES_TAB: Boolean(process.env.GOOGLE_SHEETS_RULES_TAB),
      BUKZ_API_KEY: Boolean(process.env.BUKZ_API_KEY),
    },
    api,
    sheets,
  });
}
