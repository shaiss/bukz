// Thin Google Sheets API v4 client (values.get only). Auth lives in auth.mjs;
// grid → JSON parsing lives in parse.mjs. Live calls need a service account
// and spreadsheet id; demo/offline mode feeds fixture grids through the same
// parsers without hitting the network.
import { accessToken, sheetsConfigured } from './auth.mjs';
import { parseBillsGrid, parseRulesGrid } from './parse.mjs';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

function spreadsheetId() {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) {
    throw new Error(
      'GOOGLE_SHEETS_SPREADSHEET_ID is not set. See .env.example — the hub ' +
        'spreadsheet id from the sheet URL (.../d/<ID>/edit).'
    );
  }
  return id;
}

function tabName(envKey, fallback) {
  const v = process.env[envKey];
  return (v && v.trim()) || fallback;
}

export async function fetchValues(range, { spreadsheetId: sid } = {}) {
  const id = sid || spreadsheetId();
  const token = await accessToken();
  const url =
    `${API}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}` +
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
export async function checkAuth() {
  if (!sheetsConfigured()) {
    return { ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_FILE and/or GOOGLE_SHEETS_SPREADSHEET_ID unset' };
  }
  const billsTab = tabName('GOOGLE_SHEETS_BILLS_TAB', 'Bills');
  // A 1-cell read is enough to prove the key + sheet sharing work.
  await fetchValues(`${billsTab}!A1`);
  return { ok: true };
}

// Pull both hub tabs and return parsed config objects.
export async function fetchHubConfig() {
  const billsTab = tabName('GOOGLE_SHEETS_BILLS_TAB', 'Bills');
  const rulesTab = tabName('GOOGLE_SHEETS_RULES_TAB', 'Rules');
  const [billsValues, rulesValues] = await Promise.all([
    fetchValues(`${billsTab}!A:J`),
    fetchValues(`${rulesTab}!A:D`),
  ]);
  return {
    bills: parseBillsGrid(billsValues),
    rules: parseRulesGrid(rulesValues),
    source: {
      kind: 'sheets',
      spreadsheetId: spreadsheetId(),
      billsTab,
      rulesTab,
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
