import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNote, balances, balanceOf, convert, convertedTotal, format, noteKey, parseNoteKey, removeNote } from '../src/currency.js';

test('UT-01 note keys encode currency and value', () => {
  assert.equal(noteKey('BDT', 500), 'BDT:500');
  assert.deepEqual(parseNoteKey('CNY:100'), { cur: 'CNY', value: 100 });
  assert.throws(() => noteKey('BDT', 25), RangeError); // no ৳25 note
  assert.throws(() => noteKey('EUR', 10), RangeError);
  assert.throws(() => parseNoteKey('USD:3'), RangeError);
});

test('UT-02 balances are kept per currency and never mixed', () => {
  let w = {};
  w = addNote(w, 'BDT:500');
  w = addNote(w, 'BDT:100', 3);
  w = addNote(w, 'USD:20', 2);
  w = addNote(w, 'CNY:50');
  assert.deepEqual(balances(w), { BDT: 800, USD: 40, CNY: 50 });
});

test('UT-03 taking out taka changes only the taka balance', () => {
  const before = { 'BDT:500': 2, 'USD:20': 1, 'CNY:100': 1 };
  const after = removeNote(before, 'BDT:500');
  assert.equal(balanceOf(after, 'BDT'), 500);
  assert.equal(balanceOf(after, 'USD'), balanceOf(before, 'USD'));
  assert.equal(balanceOf(after, 'CNY'), balanceOf(before, 'CNY'));
  assert.deepEqual(before, { 'BDT:500': 2, 'USD:20': 1, 'CNY:100': 1 }, 'inventory is not mutated');
});

test('UT-04 removing a note that is not there throws', () => {
  assert.throws(() => removeNote({ 'BDT:100': 1 }, 'BDT:500'), RangeError);
});

test('UT-05 converted total is computed on request at the given rates', () => {
  assert.equal(convert(10, 'USD', 'BDT'), 1220);
  assert.equal(convert(1220, 'BDT', 'USD'), 10);
  assert.equal(convertedTotal({ BDT: 1000, USD: 10, CNY: 100 }, 'BDT'), 1000 + 1220 + 1700);
  const inYuan = convertedTotal({ BDT: 1700, USD: 0, CNY: 0 }, 'CNY');
  assert.equal(inYuan, 100);
  assert.throws(() => convert(1, 'USD', 'BDT', { BDT: 1 }), RangeError);
});

test('UT-06 amounts are formatted with the right symbol', () => {
  assert.equal(format(12600), '৳12,600');
  assert.equal(format(20, 'USD'), '$20');
  assert.equal(format(-50, 'CNY'), '−¥50');
});
