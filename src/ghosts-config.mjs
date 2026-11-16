import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { configPath } from './config.mjs';

// Ghost allowlist: --allowlist FILE, else config/ghosts.json when present,
// else empty. Template: config/ghosts.example.json (config/ is gitignored).
export function loadAllowlist(file) {
  if (file) {
    const path = resolve(process.cwd(), file);
    return { source: file, entries: JSON.parse(readFileSync(path, 'utf8')) };
  }
  const path = configPath('ghosts.json');
  if (existsSync(path)) return { source: 'config/ghosts.json', entries: JSON.parse(readFileSync(path, 'utf8')) };
  return { source: null, entries: [] };
}

// "--days 1-5" or "--days 3" (meaning 1-3).
export function parseDays(value) {
  if (value === undefined) return { minDays: 1, maxDays: 5 };
  const m = String(value).trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!m) throw new Error(`--days must be N or MIN-MAX (got "${value}")`);
  const minDays = m[2] ? Number(m[1]) : 1;
  const maxDays = Number(m[2] ?? m[1]);
  if (minDays < 1 || maxDays < minDays) throw new Error(`--days needs 1 <= MIN <= MAX (got "${value}")`);
  return { minDays, maxDays };
}
