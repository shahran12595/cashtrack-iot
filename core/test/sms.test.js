import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSms } from '../src/sms.js';

test('UT-31 bank debit SMS: amount, merchant, balance and category', () => {
  const r = parseSms('DemoBank', 'Demo Bank: Tk 1,250.00 debited from A/C **4821 at City Grocers on 19-Oct-26 21:40. Avl Bal Tk 18,430.50');
  assert.deepEqual(r, { amount: 1250, balance: 18430.5, direction: 'out', merchant: 'City Grocers', category: 'Food' });
});

test('UT-32 mobile wallet payment and income', () => {
  const pay = parseSms('MobiPay', 'MobiPay: Payment Tk 120.00 to RideNow successful. Fee Tk 0.00. Balance Tk 2,380.00. TrxID 8F2K1Q');
  assert.equal(pay.amount, 120);
  assert.equal(pay.balance, 2380);
  assert.equal(pay.category, 'Transport');
  const inc = parseSms('MobiPay', 'MobiPay: You have received Tk 1,500.00 from 01XXXXXXX45. Balance Tk 3,880.00. TrxID 9A1B2C');
  assert.equal(inc.direction, 'in');
  assert.equal(inc.category, 'Income');
});

test('UT-33 messages from unknown senders are not read', () => {
  assert.equal(parseSms('+8801711000000', 'Tk 500.00 debited'), null);
});

test('UT-34 unknown merchants fall back to Other', () => {
  const r = parseSms('DemoBank', 'Demo Bank: Tk 90.00 debited from A/C **4821 at Tea Stall on 19-Oct-26 10:00. Avl Bal Tk 100.00');
  assert.equal(r.merchant, 'Tea Stall');
  assert.equal(r.category, 'Other');
});
