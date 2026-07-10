import { parse, out } from '../cli.mjs';
import { getProvider } from '../providers/index.mjs';

// Lists YNAB budgets or Xero organisations (ids here are not secrets).
export async function run(argv) {
  const opts = parse(argv);
  const provider = getProvider(opts.provider);
  out({ provider: provider.name, sources: await provider.listSources() });
}
