// Google service-account JWT → access token (Sheets API, read-only).
// Machine-to-machine, same spirit as Xero's Custom Connection: no browser
// flow. Zero npm deps — Node crypto signs RS256; fetch exchanges the JWT.
//
// Credentials come from CLI flags (preferred for skill/happy-path sync) or
// optional process.env fallback. This module never reads or writes `.env`.
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { ROOT } from '../env.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

let tokenCache = null;

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function resolveKeyPath(raw) {
  if (isAbsolute(raw)) return raw;
  // Prefer cwd (matches how users pass relative CLI paths), then repo root.
  const fromCwd = resolve(process.cwd(), raw);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(ROOT, raw);
}

// Resolve Sheets credentials. `opts` (from CLI flags) wins over env.
// Never opens `.env` — env is whatever the process already has.
export function resolveSheetsCredentials(opts = {}) {
  const serviceAccountFile =
    opts.serviceAccountFile ||
    opts['service-account'] ||
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE ||
    null;
  const spreadsheetId =
    opts.spreadsheetId ||
    opts['spreadsheet-id'] ||
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
    null;
  const billsTab =
    opts.billsTab ||
    opts['bills-tab'] ||
    process.env.GOOGLE_SHEETS_BILLS_TAB ||
    'Bills';
  const rulesTab =
    opts.rulesTab ||
    opts['rules-tab'] ||
    process.env.GOOGLE_SHEETS_RULES_TAB ||
    'Rules';
  return {
    serviceAccountFile: serviceAccountFile ? String(serviceAccountFile).trim() : null,
    spreadsheetId: spreadsheetId ? String(spreadsheetId).trim() : null,
    billsTab: String(billsTab).trim() || 'Bills',
    rulesTab: String(rulesTab).trim() || 'Rules',
  };
}

export function sheetsConfigured(opts = {}) {
  const c = resolveSheetsCredentials(opts);
  return Boolean(c.serviceAccountFile && c.spreadsheetId);
}

function loadServiceAccount(serviceAccountFile) {
  if (!serviceAccountFile) {
    throw new Error(
      'Google service-account key not set. Pass --service-account <path> to sync-config, ' +
        'or optionally set GOOGLE_SERVICE_ACCOUNT_FILE in the environment. ' +
        'See docs/sheets-config.md.'
    );
  }
  const path = resolveKeyPath(serviceAccountFile);
  if (!existsSync(path)) {
    throw new Error(
      `Service-account key not found: ${path}. Pass a real path via --service-account ` +
        '(or GOOGLE_SERVICE_ACCOUNT_FILE). Never commit the key file.'
    );
  }
  let sa;
  try {
    sa = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse service-account JSON at ${path}: ${err.message}`);
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error(
      `Service-account JSON at ${path} is missing client_email or private_key.`
    );
  }
  return sa;
}

function signJwt(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const sig = signer.sign(sa.private_key).toString('base64url');
  return `${unsigned}.${sig}`;
}

export async function accessToken(opts = {}) {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const { serviceAccountFile } = resolveSheetsCredentials(opts);
  const sa = loadServiceAccount(serviceAccountFile);
  const assertion = signJwt(sa);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Google token request failed (${res.status} ${res.statusText}) — check the ` +
        'service-account key and that the Sheets API is enabled for the GCP project'
    );
  }
  const body = await res.json();
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return tokenCache.token;
}

// For tests: drop the cached token between cases.
export function _resetTokenCache() {
  tokenCache = null;
}
