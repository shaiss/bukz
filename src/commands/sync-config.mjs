import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, out } from '../cli.mjs';
import { saveConfig } from '../config.mjs';
import { fetchHubConfig, loadHubFixture } from '../sheets/client.mjs';

// Read-path hydrate: hub Google Sheet tabs → local gitignored config/*.json.
//
// Happy path does NOT require editing `.env` — pass credentials as CLI flags:
//   sync-config --service-account ./sa.json --spreadsheet-id <id>
// Optional env (GOOGLE_SERVICE_ACCOUNT_FILE, GOOGLE_SHEETS_SPREADSHEET_ID, …)
// is only a fallback. This command never reads or rewrites `.env`.
//
// Demo/offline (skills + CI): --from fixtures/sheets-hub.json
//
// After sync, outlook / rule-check keep using local config via loadConfig —
// Sheets is a hydrate step, not a live dependency on every command.
export async function run(argv) {
  const opts = parse(argv, {
    from: { type: 'string' },
    'service-account': { type: 'string' },
    'spreadsheet-id': { type: 'string' },
    'bills-tab': { type: 'string' },
    'rules-tab': { type: 'string' },
  });

  let hub;
  if (opts.from) {
    const path = resolve(process.cwd(), opts.from);
    const fixture = JSON.parse(readFileSync(path, 'utf8'));
    hub = loadHubFixture(fixture);
  } else {
    hub = await fetchHubConfig({
      serviceAccountFile: opts['service-account'],
      spreadsheetId: opts['spreadsheet-id'],
      billsTab: opts['bills-tab'],
      rulesTab: opts['rules-tab'],
    });
  }

  const billsPath = saveConfig('bills.json', hub.bills);
  const rulesPath = saveConfig('rules.json', hub.rules);

  out({
    meta: {
      syncedAt: new Date().toISOString(),
      source: hub.source,
      from: opts.from ?? null,
      // Hydrate only — callers keep reading local config/*.json via loadConfig.
      localConfigPreferred: true,
    },
    written: {
      bills: { path: billsPath, count: hub.bills.length },
      rules: { path: rulesPath, count: hub.rules.length },
    },
  });
}
