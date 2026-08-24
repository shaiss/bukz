import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { resolve } from 'node:path';

import { startServer } from '../src/server.mjs';

const FIXTURE_DATA = resolve(import.meta.dirname, '..', 'fixtures', 'sample.json');
const FIXTURE_BILLS = resolve(import.meta.dirname, '..', 'fixtures', 'bills.json');

test('serve: app shell, modules, and analysis imports all resolve', async (t) => {
  const server = await startServer({ port: 0, dataPath: FIXTURE_DATA, billsPath: FIXTURE_BILLS });
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const index = await fetch(base + '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(await index.text(), /id="app"/);

  for (const file of ['/app.js', '/views.mjs', '/util.mjs', '/style.css']) {
    const res = await fetch(base + file);
    assert.equal(res.status, 200, file);
    assert.match(res.headers.get('content-type'), file.endsWith('.css') ? /text\/css/ : /text\/javascript/, file);
  }

  // The browser imports the SAME analysis modules the CLI runs — they must be
  // served as JS from src/analysis, and nothing else from src/.
  const mod = await fetch(base + '/src/analysis/pl.mjs');
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-type'), /text\/javascript/);
  assert.match(await mod.text(), /profitAndLoss/);
  const beyond = await fetch(base + '/src/analysis/../../server.mjs');
  // fetch normalizes ../ client-side, so this lands on /src/server.mjs → 404
  assert.equal(beyond.status, 404);
});

test('serve: data and bills endpoints read the fixture files', async (t) => {
  const server = await startServer({ port: 0, dataPath: FIXTURE_DATA, billsPath: FIXTURE_BILLS });
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const data = await (await fetch(base + '/api/data')).json();
  assert.equal(data.transactions.length, 85);
  assert.equal(data.accounts.length, 3);
  assert.equal(data.budgetMonths.length, 1);

  const bills = await (await fetch(base + '/api/bills')).json();
  assert.equal(bills.length, 6);
});

test('serve: missing files give pointed 404s, not crashes', async (t) => {
  const server = await startServer({
    port: 0,
    dataPath: resolve(import.meta.dirname, 'does-not-exist.json'),
    billsPath: resolve(import.meta.dirname, 'no-bills.json'),
  });
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const data = await fetch(base + '/api/data');
  assert.equal(data.status, 404);
  assert.match((await data.json()).error, /pull|demo/i);

  const bills = await fetch(base + '/api/bills');
  assert.equal(bills.status, 404);
  assert.match((await bills.json()).error, /bills\.example\.json/);

  assert.equal((await fetch(base + '/nope.js')).status, 404);
});

test('serve: encoded traversal outside the served roots is refused', async (t) => {
  const server = await startServer({ port: 0, dataPath: FIXTURE_DATA, billsPath: FIXTURE_BILLS });
  t.after(() => new Promise((done) => server.close(done)));
  const port = server.address().port;

  // Two layers defend the filesystem: the WHATWG URL parser folds dot-segment
  // encodings (%2e%2e) into a harmless path, and safeJoin refuses anything
  // that still resolves outside a served root (e.g. %5c backslashes on
  // Windows, which the URL parser leaves alone). Either way the invariant is:
  // nothing outside web/ + src/analysis is ever served.
  for (const path of [
    '/%2e%2e/.env',
    '/%2e%2e/%2e%2e/src/server.mjs',
    '/src/analysis/%2e%2e/env.mjs',
    '/%5c..%5c.env',
    '/src/analysis/%5c..%5c..%5cserver.mjs',
  ]) {
    const res = await rawGet(port, path);
    assert.ok(res.status === 403 || res.status === 404, `${path}: expected refusal, got ${res.status}`);
  }
  // The secrets file is doubly unreachable: outside every served root, and
  // .env isn't even a servable file type.
  assert.equal((await rawGet(port, '/.env')).status, 403);
});

test('serve: non-GET methods are rejected (read-only)', async (t) => {
  const server = await startServer({ port: 0, dataPath: FIXTURE_DATA, billsPath: FIXTURE_BILLS });
  t.after(() => new Promise((done) => server.close(done)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/data`, { method: 'POST' });
  assert.equal(res.status, 405);
});

function rawGet(port, path) {
  return new Promise((resolveReq, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume(); // drain so the socket frees
      resolveReq({ status: res.statusCode ?? 500 });
    });
    req.once('error', reject);
    req.end();
  });
}
