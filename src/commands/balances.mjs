import { parse, out } from '../cli.mjs';
import { loadData, meta } from '../data.mjs';

// Account balances as of the last pull. Balances are snapshotted by `pull`
// when the provider exposes them (YNAB does; Xero not yet) — judge staleness
// from meta.pulledAt.
export async function run(argv) {
  const opts = parse(argv);
  const data = loadData(opts);
  if (!data.accounts) {
    throw new Error(
      'No account balances in the cache. Pull from a provider that exposes them (YNAB), ' +
        'or try demo mode: --in fixtures/sample.json'
    );
  }
  out({ meta: meta(data, opts), accounts: data.accounts });
}
