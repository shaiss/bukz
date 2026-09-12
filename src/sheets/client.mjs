// Thin Google Sheets API v4 client (values.get only). Auth lives in auth.mjs;
// grid → JSON parsing lives in parse.mjs. Live calls need a service account
// and spreadsheet id (CLI flags preferred; env is optional fallback). Demo
// mode feeds fixture grids through the same parsers without hitting the network.
// This module never reads or writes `.env`.
import { accessToken, sheetsConfigured, resolveSheetsCredentials } from './auth.mjs';
import { parseBillsGrid, parseRulesGrid } from './parse.mjs';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export async function fetchValues(range, opts = {}) {
  const creds = resolveSheetsCredentials(opts);
  if (!creds.spreadsheetId) {
    throw new Error(
      'Google spreadsheet id not set. Pass --spreadsheet-id <id> to sync-config, ' +
        'or optionally set GOOGLE_SHEETS_SPREADSHEET_ID. See docs/sheets-config.md.'
    );
  }
  const token = await accessToken(opts);
  const url =
    `${API}/${encodeURIComponent(creds.spreadsheetId)}/values/${encodeURIComponent(range)}` +
    '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      `Google Sheets API ${res.status} ${res.statusText} for range ${range} ` +
        `(share the sheet with the service-account email as Viewer)`
    );
  }
  const body = await res.json();
  return body.values ?? [];
}

// Connectivity probe for `check` — booleans/counts only, never secrets.
export async function checkAuth(opts = {}) {
  if (!sheetsConfigured(opts)) {
    return {
      ok: false,
      error:
        'Sheets not configured — pass --service-account + --spreadsheet-id to sync-config, ' +
        'or set GOOGLE_SERVICE_ACCOUNT_FILE + GOOGLE_SHEETS_SPREADSHEET_ID',
    };
  }
  const { billsTab } = resolveSheetsCredentials(opts);
  await fetchValues(`${billsTab}!A1`, opts);
  return { ok: true };
}

// Pull both hub tabs and return parsed config objects.
export async function fetchHubConfig(opts = {}) {
  const creds = resolveSheetsCredentials(opts);
  if (!creds.spreadsheetId || !creds.serviceAccountFile) {
    throw new Error(
      'Live sync-config needs --service-account <key.json> and --spreadsheet-id <id> ' +
        '(env vars are an optional fallback). Demo without credentials: ' +
        'sync-config --from fixtures/sheets-hub.json. See docs/sheets-config.md.'
    );
  }
  const [billsValues, rulesValues] = await Promise.all([
    fetchValues(`${creds.billsTab}!A:J`, opts),
    fetchValues(`${creds.rulesTab}!A:D`, opts),
  ]);
  return {
    bills: parseBillsGrid(billsValues),
    rules: parseRulesGrid(rulesValues),
    source: {
      kind: 'sheets',
      spreadsheetId: creds.spreadsheetId,
      billsTab: creds.billsTab,
      rulesTab: creds.rulesTab,
    },
  };
}

// Demo/offline: a fixture JSON with { bills: { values: [...] }, rules: { values: [...] } }
// (or bare arrays under those keys). Same parsers as the live path.
export function loadHubFixture(fixture) {
  const billsValues = fixture.bills?.values ?? fixture.bills ?? [];
  const rulesValues = fixture.rules?.values ?? fixture.rules ?? [];
  return {
    bills: parseBillsGrid(billsValues),
    rules: parseRulesGrid(rulesValues),
    source: {
      kind: 'fixture',
      billsTab: fixture.bills?.tab ?? 'Bills',
      rulesTab: fixture.rules?.tab ?? 'Rules',
    },
  };
}
