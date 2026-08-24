import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './env.mjs';

// Curated, machine-local reference data (the bills registry, the account→entity
// map, …) lives in config/. Like data/, config/ is gitignored — it holds the
// user's private bookkeeping context, not code. Committed *.example.json files
// document each schema; copy one to the real name and edit locally.

export function loadConfig(file) {
  const path = resolve(ROOT, 'config', file);
  if (!existsSync(path)) {
    const example = file.replace(/\.json$/, '.example.json');
    throw new Error(
      `No config file: ${path}. Copy config/${example} to config/${file} and edit it ` +
        '(config/ is gitignored — its contents stay on this machine).'
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}
