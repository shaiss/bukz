import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, out } from '../cli.mjs';
import { saveConfig } from '../config.mjs';
import { fetchHubConfig, loadHubFixture } from '../sheets/client.mjs';

// Read-path: hub Google Sheet tabs → local gitignored config/*.json.
// Live mode needs GOOGLE_SERVICE_ACCOUNT_FILE + GOOGLE_SHEETS_SPREADSHEET_ID.
// Demo/offline: --from fixtures/sheets-hub.json (no credentials required).
export async function run(argv) {
  const opts = parse(argv, {
    from: { type: 'string' },
  });

  let hub;
  if (opts.from) {
    const path = resolve(process.cwd(), opts.from);
    const fixture = JSON.parse(readFileSync(path, 'utf8'));
    hub = loadHubFixture(fixture);
  } else {
    hub = await fetchHubConfig();
  }

  const billsPath = saveConfig('bills.json', hub.bills);
  const rulesPath = saveConfig('rules.json', hub.rules);

  out({
    meta: {
      syncedAt: new Date().toISOString(),
      source: hub.source,
      from: opts.from ?? null,
    },
    written: {
      bills: { path: billsPath, count: hub.bills.length },
      rules: { path: rulesPath, count: hub.rules.length },
    },
  });
}
