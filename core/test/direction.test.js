import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DirectionDetector, detectAll, isBlocked } from '../src/direction.js';

const ev = (beam, blocked, t) => ({ beam, blocked, t });

test('UT-07 beam is blocked below 60% of its clear level', () => {
  assert.equal(isBlocked(590, 1000), true);
  assert.equal(isBlocked(600, 1000), false);
  assert.equal(isBlocked(950, 1000), false);
  assert.throws(() => isBlocked(1, 0));
});

test('UT-08 beam 1 then beam 2 means IN', () => {
  const r = detectAll([ev(1, true, 0), ev(2, true, 240), ev(1, false, 570), ev(2, false, 810)]);
  assert.deepEqual(r, ['IN']);
});

test('UT-09 beam 2 then beam 1 means OUT', () => {
  const r = detectAll([ev(2, true, 0), ev(1, true, 200), ev(2, false, 500), ev(1, false, 700)]);
  assert.deepEqual(r, ['OUT']);
});

test('UT-10 a note pushed halfway and pulled back is UNKNOWN, not counted', () => {
  const r = detectAll([ev(1, true, 0), ev(2, true, 200), ev(2, false, 400), ev(1, false, 600)]);
  assert.deepEqual(r, ['UNKNOWN']);
});

test('UT-11 a pass that breaks only one beam is UNKNOWN', () => {
  assert.deepEqual(detectAll([ev(1, true, 0), ev(1, false, 300)]), ['UNKNOWN']);
});

test('UT-12 a pass slower than the timeout is UNKNOWN', () => {
  const r = detectAll([ev(1, true, 0), ev(2, true, 1000), ev(1, false, 2000), ev(2, false, 3500)]);
  assert.deepEqual(r, ['UNKNOWN']);
});

test('UT-13 repeated readings are ignored and passes in a row are all detected', () => {
  const d = new DirectionDetector();
  const seq = [ev(1, true, 0), ev(1, true, 10), ev(2, true, 200), ev(1, false, 400), ev(2, false, 600),
    ev(2, true, 2000), ev(1, true, 2200), ev(2, false, 2400), ev(1, false, 2600)];
  const out = seq.map((e) => d.feed(e)).filter(Boolean);
  assert.deepEqual(out, ['IN', 'OUT']);
});
