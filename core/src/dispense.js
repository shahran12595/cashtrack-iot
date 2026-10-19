// Vault withdrawal planning. The vault has 12 cassettes: four note values for each currency.
// The planner finds the combination with the fewest notes that the cassettes can actually make.
// (A plain greedy plan can fail, e.g. ৳600 from one ৳500 and three ৳200 notes.)

import { CURRENCIES, balanceOf, noteKey } from './currency.js';

/**
 * @param {string} cur currency code
 * @param {number} amount amount in that currency
 * @param {Record<string, number>} inventory vault notes, e.g. {"BDT:500": 3}
 * @returns {string[] | null} note keys to dispense, largest first, or null if impossible
 */
export function planWithdrawal(cur, amount, inventory) {
  const values = [...CURRENCIES[cur].vaultNotes].sort((a, b) => b - a);
  const counts = values.map((v) => inventory[noteKey(cur, v)] || 0);
  let best = null;

  const search = (i, remaining, used, chosen) => {
    if (remaining === 0) {
      if (!best || used < best.used) best = { used, chosen: [...chosen] };
      return;
    }
    if (i === values.length) return;
    if (best && used >= best.used) return; // cannot beat the best plan
    const v = values[i];
    const maxK = Math.min(Math.floor(remaining / v), counts[i]);
    for (let k = maxK; k >= 0; k--) {
      chosen.push(k);
      search(i + 1, remaining - k * v, used + k, chosen);
      chosen.pop();
    }
  };
  search(0, amount, 0, []);
  if (!best) return null;

  const out = [];
  best.chosen.forEach((k, i) => {
    for (let n = 0; n < k; n++) out.push(noteKey(cur, values[i]));
  });
  return out;
}

/**
 * Checks a withdrawal request and returns the plan or the reason it cannot be made.
 * @returns {{ok:true, plan:string[]} | {ok:false, error:string}}
 */
export function validateWithdrawal(cur, amount, inventory) {
  const c = CURRENCIES[cur];
  if (!c) return { ok: false, error: 'unknown currency' };
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'enter a whole amount' };
  const unit = Math.min(...c.vaultNotes);
  if (amount % unit !== 0) return { ok: false, error: `use a multiple of ${c.symbol}${unit}` };
  const held = balanceOf(inventory, cur);
  if (amount > held) return { ok: false, error: `the vault only holds ${c.symbol}${held}` };
  const plan = planWithdrawal(cur, amount, inventory);
  if (!plan) return { ok: false, error: 'the vault cannot make this amount from the notes it holds' };
  return { ok: true, plan };
}
