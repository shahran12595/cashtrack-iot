import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createBackend } from '../src/app.js';
import { VaultVerifier, createWithdrawRequest, generateKeys } from '../../core/src/secure.js';

const phone = generateKeys();
const backendKeys = generateKeys();
let now = Date.UTC(2026, 9, 19, 6, 0, 0);
let server;
let base;
const app = createBackend({
  vaultId: 'vault-1',
  phonePublicKey: phone.publicKey,
  backendPrivateKey: backendKeys.privateKey,
  dailyLimitBDT: 10000,
  vaultInventory: { 'BDT:1000': 5, 'BDT:500': 4, 'USD:20': 3, 'USD:10': 2 },
  clock: () => now,
});

before(async () => {
  server = createServer(app.handler);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = async (body) => {
  const r = await fetch(`${base}/api/withdrawals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const req = (cur, amount, key = phone.privateKey) => createWithdrawRequest({ vaultId: 'vault-1', cur, amount, now }, key);

test('IT-01 health check', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
});

test('IT-02 full withdrawal: phone signs, backend co-signs, vault accepts', async () => {
  const r = await post(req('BDT', 1500));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.command.plan, ['BDT:1000', 'BDT:500']);
  const vault = new VaultVerifier({ vaultId: 'vault-1', phonePublicKey: phone.publicKey, backendPublicKey: backendKeys.publicKey });
  assert.equal(vault.verify(r.body, now + 5000).ok, true);
});

test('IT-03 replayed request is rejected', async () => {
  const signed = req('USD', 20);
  assert.equal((await post(signed)).status, 200);
  const again = await post(signed);
  assert.equal(again.status, 409);
});

test('IT-04 request signed by another key is rejected', async () => {
  const r = await post(req('BDT', 1000, generateKeys().privateKey));
  assert.equal(r.status, 401);
});

test('IT-05 invalid amounts are rejected with a reason', async () => {
  assert.equal((await post(req('BDT', 150))).status, 422);
  assert.equal((await post(req('USD', 500))).status, 422);
});

test('IT-06 daily limit counts all currencies in taka', async () => {
  // Already ৳1,500 + $20 (৳2,440) today = ৳3,940. ৳5,000 more is fine, then $50 (৳6,100) exceeds ৳10,000.
  assert.equal((await post(req('BDT', 5000))).status, 200);
  const r = await post(req('USD', 50));
  assert.equal(r.status, 403);
  now += 24 * 3600_000; // next day
  assert.equal((await post(req('USD', 30))).status, 200);
});

test('IT-07 malformed input never crashes the server', async () => {
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal((await post('x'.repeat(20000))).status, 413);
  const r = await fetch(`${base}/nope`);
  assert.equal(r.status, 404);
});

test('IT-08 old requests are refused', async () => {
  const old = createWithdrawRequest({ vaultId: 'vault-1', cur: 'BDT', amount: 1000, now: now - 10 * 60_000 }, phone.privateKey);
  assert.equal((await post(old)).status, 400);
});
