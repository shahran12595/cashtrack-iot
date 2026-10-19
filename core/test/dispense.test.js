import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWithdrawal, validateWithdrawal } from '../src/dispense.js';

const vault = {
  'BDT:1000': 2, 'BDT:500': 4, 'BDT:200': 5, 'BDT:100': 10,
  'USD:100': 1, 'USD:50': 2, 'USD:20': 3, 'USD:10': 4,
  'CNY:100': 5, 'CNY:50': 2, 'CNY:20': 5, 'CNY:10': 5,
};

test('UT-21 plan uses the fewest notes', () => {
  assert.deepEqual(planWithdrawal('BDT', 1700, vault), ['BDT:1000', 'BDT:500', 'BDT:200']);
  assert.deepEqual(planWithdrawal('USD', 180, vault), ['USD:100', 'USD:50', 'USD:20', 'USD:10']);
});

test('UT-22 plan finds a combination a greedy plan would miss', () => {
  const v = { 'BDT:500': 1, 'BDT:200': 3 };
  assert.deepEqual(planWithdrawal('BDT', 600, v), ['BDT:200', 'BDT:200', 'BDT:200']);
});

test('UT-23 plan only uses notes of the requested currency', () => {
  const p = planWithdrawal('CNY', 300, vault);
  assert.ok(p.every((k) => k.startsWith('CNY:')));
  assert.equal(p.reduce((a, k) => a + Number(k.split(':')[1]), 0), 300);
});

test('UT-24 withdrawals are validated before any fingerprint prompt', () => {
  assert.equal(validateWithdrawal('BDT', 150, vault).ok, false); // not a multiple of ৳100
  assert.equal(validateWithdrawal('USD', 15, vault).ok, false); // not a multiple of $10
  assert.equal(validateWithdrawal('USD', 1000, vault).ok, false); // more than the vault holds
  assert.equal(validateWithdrawal('BDT', 0, vault).ok, false);
  assert.equal(validateWithdrawal('EUR', 10, vault).ok, false);
  assert.equal(validateWithdrawal('BDT', 300, { 'BDT:200': 2 }).ok, false); // holds ৳400 but cannot make ৳300
  const ok = validateWithdrawal('BDT', 2000, vault);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.plan, ['BDT:1000', 'BDT:1000']);
});
