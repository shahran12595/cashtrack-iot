import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PinGuard, pinProblem, shouldOfferPin } from '../src/pin.js';

test('UT-25 the PIN is offered after 3 failed fingerprint touches', () => {
  assert.equal(shouldOfferPin(2), false);
  assert.equal(shouldOfferPin(3), true);
});

test('UT-26 easy PINs are rejected', () => {
  for (const p of ['111111', '123456', '654321', '121212', '123123', '12345', 'abcdef']) {
    assert.notEqual(pinProblem(p), null, p);
  }
  assert.equal(pinProblem('246810'), null);
  assert.equal(pinProblem('730194'), null);
  assert.throws(() => PinGuard.create('000000'), RangeError);
});

test('UT-27 the right PIN unlocks; the PIN itself is not stored', () => {
  const g = PinGuard.create('246810');
  assert.equal(JSON.stringify(g.toJSON()).includes('246810'), false);
  assert.equal(g.verify('246810').ok, true);
});

test('UT-28 five wrong PINs lock withdrawals for 30 s', () => {
  const g = PinGuard.create('246810');
  const t0 = 1_000_000;
  for (let i = 1; i <= 4; i++) assert.equal(g.verify('000001', t0).triesLeft, 5 - i);
  const r = g.verify('000001', t0);
  assert.equal(r.locked, true);
  assert.equal(r.lockedUntil, t0 + 30_000);
  assert.equal(g.verify('246810', t0 + 29_000).ok, false, 'even the right PIN is refused while locked');
  assert.equal(g.verify('246810', t0 + 30_001).ok, true);
});

test('UT-29 repeated lockouts wait longer', () => {
  const g = PinGuard.create('246810');
  let t = 0;
  for (let i = 0; i < 5; i++) g.verify('999990', t);
  t = g.lockedUntil + 1;
  for (let i = 0; i < 5; i++) g.verify('999990', t);
  assert.equal(g.lockedUntil - t, 60_000);
});

test('UT-30 changing the PIN applies the same rules', () => {
  const g = PinGuard.create('246810');
  assert.throws(() => g.change('222222'));
  g.change('730194');
  assert.equal(g.verify('246810').ok, false);
  assert.equal(g.verify('730194').ok, true);
});
