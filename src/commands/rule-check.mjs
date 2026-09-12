import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, out } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';
import { loadConfig } from '../config.mjs';
import { checkCuratedRules } from '../analysis/curated-rules.mjs';

// Curated payee→category check against config/rules.json (or --rules FILE).
// Complements `rules` (history-derived candidates): this checks the user-owned
// curated set. Demo: --in fixtures/sample.json --rules fixtures/rules.json
export async function run(argv) {
  const opts = parse(argv, {
    rules: { type: 'string' },
    'violations-only': { type: 'boolean' },
  });

  const data = loadData(opts);
  const rules = opts.rules
    ? JSON.parse(readFileSync(resolve(process.cwd(), opts.rules), 'utf8'))
    : loadConfig('rules.json');

  // Default: report violations + uncategorized + correct matches (leads).
  // --violations-only drops the correct-match list to keep the payload small.
  const includeMatches = !opts['violations-only'];
  const result = checkCuratedRules(data.transactions, rules, { includeMatches });

  out({
    meta: meta(data, opts),
    query: {
      rulesFile: opts.rules ?? 'config/rules.json',
      includeMatches,
      rulesLoaded: Array.isArray(rules) ? rules.length : 0,
    },
    ...result,
  });
}
