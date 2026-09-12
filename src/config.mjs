import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './env.mjs';

// Curated, machine-local reference data (the bills registry, the account→entity
// map, curated payee→category rules, …) lives in config/. Like data/, config/
// is gitignored — it holds the user's private bookkeeping context, not code.
// Committed *.example.json files document each schema; copy one to the real
// name and edit locally, or pull from the hub sheet via `sync-config`.

export function configPath(file) {
  return resolve(ROOT, 'config', file);
}

export function loadConfig(file) {
  const path = configPath(file);
  if (!existsSync(path)) {
    const example = file.replace(/\.json$/, '.example.json');
    throw new Error(
      `No config file: ${path}. Copy config/${example} to config/${file} and edit it ` +
        '(config/ is gitignored — its contents stay on this machine), or run ' +
        '`node bin/bukz.mjs sync-config` to pull from the hub Google Sheet.'
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Atomic write, same pattern as saveCache: stage to .tmp then rename so an
// interrupted sync never leaves a half-written config file.
export function saveConfig(file, data) {
  const path = configPath(file);
  mkdirSync(resolve(path, '..'), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  const swap = () => renameSync(tmp, path);
  try {
    swap();
  } catch (err) {
    if (err.code !== 'EPERM') throw err;
    swap();
  }
  return path;
}
