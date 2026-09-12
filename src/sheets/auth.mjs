// Google service-account JWT → access token (Sheets API, read-only).
// Machine-to-machine, same spirit as Xero's Custom Connection: no browser
// flow. Zero npm deps — Node crypto signs RS256; fetch exchanges the JWT.
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../env.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

let tokenCache = null;

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!raw) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_FILE is not set. See .env.example — path to a Google ' +
        'service-account JSON key with Sheets read access to the hub spreadsheet.'
    );
  }
  const path = resolve(ROOT, raw);
  if (!existsSync(path)) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_FILE points at a missing file: ${path}. ` +
        'Copy the service-account key onto this machine and set the path in .env.'
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

export function sheetsConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_FILE && process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
}

export async function accessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const sa = loadServiceAccount();
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
