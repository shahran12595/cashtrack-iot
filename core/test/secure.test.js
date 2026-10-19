import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventReceiver, VaultVerifier, canonical, createWithdrawRequest, generateKeys, sealEvent, signObject } from '../src/secure.js';

const phone = generateKeys();
const backend = generateKeys();
const attacker = generateKeys();
const t0 = 1_800_000_000_000;

function signedCommand({ request, phoneSig }, { now = t0, plan = ['BDT:1000'], key = backend.privateKey, override = {} } = {}) {
  const command = { type: 'WITHDRAW', vaultId: request.vaultId, cur: request.cur, amount: request.amount, nonce: request.nonce, plan, expiresAt: now + 60_000, ...override };
  return { request, phoneSig, command, backendSig: signObject(command, key) };
}
const verifier = () => new VaultVerifier({ vaultId: 'vault-1', phonePublicKey: phone.publicKey, backendPublicKey: backend.publicKey });

test('UT-42 canonical JSON is independent of key order', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 0 }] }), canonical({ a: [2, { c: 0, d: 1 }], b: 1 }));
});

test('UT-43 a withdrawal with both valid signatures is accepted once', () => {
  const v = verifier();
  const cmd = signedCommand(createWithdrawRequest({ vaultId: 'vault-1', cur: 'BDT', amount: 1000, now: t0 }, phone.privateKey));
  assert.deepEqual(v.verify(cmd, t0 + 1000), { ok: true, plan: ['BDT:1000'] });
  assert.equal(v.verify(cmd, t0 + 2000).error, 'nonce already used', 'replay rejected');
});

test('UT-44 expired, single-signed and wrongly signed commands are rejected', () => {
  const req = createWithdrawRequest({ vaultId: 'vault-1', cur: 'BDT', amount: 1000, now: t0 }, phone.privateKey);
  assert.equal(verifier().verify(signedCommand(req), t0 + 61_000).error, 'command expired');
  const noBackend = { ...signedCommand(req), backendSig: '' };
  assert.equal(verifier().verify(noBackend, t0).error, 'bad backend signature');
  assert.equal(verifier().verify(signedCommand(req, { key: attacker.privateKey }), t0).error, 'bad backend signature');
  const fakePhone = createWithdrawRequest({ vaultId: 'vault-1', cur: 'BDT', amount: 1000, now: t0 }, attacker.privateKey);
  assert.equal(verifier().verify(signedCommand(fakePhone), t0).error, 'bad phone signature');
});

test('UT-45 a hacked backend cannot change the amount or target another vault', () => {
  const req = createWithdrawRequest({ vaultId: 'vault-1', cur: 'BDT', amount: 1000, now: t0 }, phone.privateKey);
  assert.equal(verifier().verify(signedCommand(req, { override: { amount: 5000 } }), t0).error, 'command does not match the signed request');
  assert.equal(verifier().verify(signedCommand(req, { override: { cur: 'USD' } }), t0).error, 'command does not match the signed request');
  assert.equal(verifier().verify(signedCommand(req, { override: { vaultId: 'vault-2' } }), t0).error, 'wrong vault');
});

test('UT-46 wallet events are encrypted and replay-protected', () => {
  const key = randomBytes(16);
  const rx = new EventReceiver(key);
  const p1 = sealEvent({ seq: 1042, evt: 'IN', cur: 'BDT', val: 500, conf: 0.97 }, key);
  assert.equal(rx.open(p1).ok, true);
  assert.equal(rx.open(p1).error, 'replayed or out-of-order event');
  const forged = sealEvent({ seq: 2000, evt: 'IN', cur: 'BDT', val: 1000 }, randomBytes(16));
  assert.equal(rx.open(forged).error, 'authentication failed');
  const tampered = { ...sealEvent({ seq: 1043, evt: 'IN', cur: 'BDT', val: 100 }, key) };
  tampered.body = Buffer.from(Buffer.from(tampered.body, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64');
  assert.equal(rx.open(tampered).error, 'authentication failed');
});

test('UT-47 the phone opens the binary packet format the wallet firmware sends', () => {
  const key = randomBytes(16);
  const json = '{"seq":7,"evt":"IN","cur":"CNY","val":100,"conf":0.91}';
  const p = sealEvent(JSON.parse(json), key);
  const bytes = Buffer.concat([Buffer.from(p.iv, 'base64'), Buffer.from(p.body, 'base64'), Buffer.from(p.tag, 'base64')]);
  const rx = new EventReceiver(key);
  assert.deepEqual(rx.openBytes(bytes), { ok: true, event: JSON.parse(json) });
  assert.equal(rx.openBytes(bytes.subarray(0, 20)).error, 'packet too short');
});
