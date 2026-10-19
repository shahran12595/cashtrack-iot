import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, parseLabel } from '../src/recognition.js';

test('UT-14 model labels cover three currencies plus non-note classes', () => {
  assert.deepEqual(parseLabel('USD:20'), { cur: 'USD', value: 20 });
  assert.equal(parseLabel('no_note'), null);
  assert.equal(parseLabel('other_object'), null);
  assert.throws(() => parseLabel('BDT:30'));
});

test('UT-15 a clear, confident, genuine note is counted', () => {
  const r = decide({ direction: 'IN', prediction: { label: 'BDT:500', confidence: 0.97 }, uvPass: true });
  assert.deepEqual(r, { action: 'COUNT', event: 'IN', key: 'BDT:500' });
});

test('UT-16 confidence below 0.80 asks the user', () => {
  const r = decide({ direction: 'IN', prediction: { label: 'BDT:100', confidence: 0.62 }, uvPass: true });
  assert.equal(r.action, 'CONFIRM');
  assert.equal(r.event, 'IN?');
  assert.equal(decide({ direction: 'IN', prediction: { label: 'CNY:100', confidence: 0.8 } }).action, 'COUNT');
});

test('UT-17 a note that fails UV is flagged, never counted', () => {
  const r = decide({ direction: 'IN', prediction: { label: 'BDT:1000', confidence: 0.99 }, uvPass: false });
  assert.equal(r.action, 'SUSPECT');
});

test('UT-18 unclear direction asks the user', () => {
  assert.equal(decide({ direction: 'UNKNOWN', prediction: { label: 'USD:100', confidence: 0.99 } }).action, 'CONFIRM');
});

test('UT-19 taking out a note the wallet does not hold asks the user', () => {
  const r = decide({ direction: 'OUT', prediction: { label: 'USD:50', confidence: 0.95 }, inventory: { 'USD:20': 1 } });
  assert.equal(r.action, 'CONFIRM');
  const ok = decide({ direction: 'OUT', prediction: { label: 'USD:20', confidence: 0.95 }, inventory: { 'USD:20': 1 } });
  assert.equal(ok.action, 'COUNT');
});

test('UT-20 no note in view is ignored', () => {
  assert.equal(decide({ direction: 'IN', prediction: { label: 'no_note', confidence: 0.9 } }).action, 'IGNORE');
});
