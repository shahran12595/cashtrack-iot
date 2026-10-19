import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coach, localAnswer, summaryForAI } from '../src/coach.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 19);
const budgets = { Food: 3000, Transport: 1200, Shopping: 2500, Education: 1500, Bills: 2500, Health: 1500, Other: 1000 };
const tx = [
  { t: now - 2 * DAY, kind: 'out', amount: 2750, cat: 'Food', src: 'wallet' },
  { t: now - 3 * DAY, kind: 'out', amount: 2000, cat: 'Shopping', src: 'bank' },
  { t: now - 4 * DAY, kind: 'out', amount: 10, cur: 'USD', cat: 'Other', src: 'wallet' },
  { t: now - 5 * DAY, kind: 'out', amount: 5000, cat: 'Withdrawal', src: 'vault' }, // not spending
  { t: now - 40 * DAY, kind: 'out', amount: 9999, cat: 'Food', src: 'wallet' }, // older than 30 days
];
const data = {
  income: 25000,
  transactions: tx,
  budgets,
  goals: [
    { name: 'Laptop for final-year project', cur: 'BDT', target: 85000, saved: 22000, due: now + 150 * DAY },
    { name: 'Competition trip to China', cur: 'CNY', target: 2500, saved: 1800, due: now + 60 * DAY },
  ],
};

test('UT-35 goal monthly need = remaining ÷ months left (foreign goals in taka)', () => {
  const r = coach(data, now);
  assert.equal(Math.round(r.goals[0].monthlyNeed), 12600); // ৳63,000 over 5 months
  assert.equal(Math.round(r.goals[1].monthlyNeed), 5950); // ¥700 × 17 over 2 months
});

test('UT-36 spending excludes vault withdrawals and old transactions; foreign spending in taka', () => {
  const r = coach(data, now);
  assert.equal(r.spend, 2750 + 2000 + 1220);
  assert.equal(r.spentBy.Other, 1220);
});

test('UT-37 suggested budgets: floors, wants trimmed by 20%, rounded to ৳100, within the cap', () => {
  const r = coach(data, now);
  for (const v of Object.values(r.suggested)) assert.equal(v % 100, 0);
  const cap = 25000 - Math.min(r.need, 12500);
  assert.ok(r.suggestedTotal <= cap + 700, 'total fits the cap, give or take rounding');
  assert.ok(r.suggested.Shopping < 2000 * 1.1, 'wants are trimmed');
});

test('UT-38 gap and headline', () => {
  const r = coach(data, now);
  assert.ok(Math.abs(r.gap - (r.need - r.surplus)) < 1e-9);
  assert.match(r.headline, /on track|short/);
  assert.equal(coach({ ...data, goals: [] }, now).headline, 'Add a goal and I’ll plan how to reach it.');
});

test('UT-39 saving tips carry a monthly saving estimate', () => {
  const r = coach(data, now);
  const ids = r.tips.map((t) => t.id);
  assert.ok(ids.includes('round-up')); // ৳2,750 cash → ৳50 round-up
  assert.equal(r.tips.find((t) => t.id === 'round-up').monthlySaving, 50);
  assert.equal(r.tips.find((t) => t.id === 'lunch').monthlySaving, 550);
  assert.ok(ids.includes('watch-Food')); // ৳2,750 of ৳3,000 = 92%
});

test('UT-40 the AI only sees a figures-only summary', () => {
  const r = coach(data, now);
  const s = JSON.stringify(summaryForAI(r, { BDT: 1000, USD: 20, CNY: 0 }));
  assert.equal(s.includes('src'), false);
  assert.equal(s.includes('wallet'), false);
  assert.ok(s.includes('neededPerMonthBDT'));
});

test('UT-41 the built-in coach answers from the same figures', () => {
  const r = coach(data, now);
  const a = localAnswer('How can I save for my laptop?', r);
  assert.match(a, /৳12,600 a month/);
  assert.match(localAnswer('Suggest a budget', r), /Suggested budgets/);
});
