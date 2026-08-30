import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// The SPA views run in the browser; this suite renders them in Node against a
// minimal DOM shim so a render-time ReferenceError (e.g. a helper used but
// never imported — the bug that once blanked the Budget tab, passing
// node --check the whole time) fails tests instead of the user's browser.

const el = () => {
  const node = {
    nodeType: 1, children: [], style: {}, dataset: {},
    setAttribute() {}, addEventListener() {}, append(...xs) { node.children.push(...xs); },
    replaceChildren(...xs) { node.children = xs; }, remove() {},
  };
  return node;
};
globalThis.document = {
  createElement: el,
  createElementNS: (_ns, _tag) => el(),
  createTextNode: (t) => ({ nodeType: 3, text: t }),
  getElementById: () => el(),
  addEventListener() {}, removeEventListener() {},
};

register('./spa-loader.mjs', import.meta.url);
const views = await import('../web/views.mjs');

const state = {
  data: JSON.parse(readFileSync(new URL('../fixtures/sample.json', import.meta.url), 'utf8')),
  bills: JSON.parse(readFileSync(new URL('../fixtures/bills.json', import.meta.url), 'utf8')),
};
const noop = () => {};

// Every view, in every control mode the UI can hold. A case renders by simply
// not throwing; the size assertion guards against silently-empty output.
const cases = {
  Checkpoint: [{}, { checkpointDays: 7 }, { checkpointDays: 30 }],
  Pl: [{}, { plPeriod: 'd7' }, { plPeriod: 'd30' },
    { plPeriod: 'custom' }, { plPeriod: 'custom', plFrom: '2026-07-01', plTo: '2026-07-20' },
    { plPeriod: 'custom', plFrom: '2026-07-20', plTo: '2026-07-01' }],
  Cashflow: [{}, { cfMode: 'in-out' }, { cfMode: 'cumulative' }, { cfAccount: 'Checking' }],
  Budget: [{}, { varMonth: '2026-06' }, { varMonth: '2026-07' },
    { varMonth: '2026-08', budgetCopyFrom: '2026-06' }, { varMonth: '2026-06', budgetCopyFrom: '2026-06' }],
};

for (const [name, uiStates] of Object.entries(cases)) {
  test(`spa: render${name} renders in every control mode`, () => {
    const render = views[`render${name}`];
    for (const ui of uiStates) {
      const dom = render(state, ui, noop);
      assert.ok(JSON.stringify(dom.children ?? []).length > 0, `empty DOM for ${JSON.stringify(ui)}`);
    }
  });
}
