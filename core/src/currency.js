// Currencies, note keys and per-currency balances.
// A note is identified by a key "CUR:VALUE", e.g. "BDT:500", "USD:20", "CNY:100".
// Balances are always kept per currency; a converted total is only computed on request.

export const CURRENCIES = Object.freeze({
  BDT: Object.freeze({ symbol: '৳', name: 'Bangladeshi taka', notes: [10, 20, 50, 100, 200, 500, 1000], vaultNotes: [1000, 500, 200, 100] }),
  USD: Object.freeze({ symbol: '$', name: 'US dollar', notes: [1, 2, 5, 10, 20, 50, 100], vaultNotes: [100, 50, 20, 10] }),
  CNY: Object.freeze({ symbol: '¥', name: 'Chinese yuan', notes: [1, 5, 10, 20, 50, 100], vaultNotes: [100, 50, 20, 10] }),
});

export const CURRENCY_CODES = Object.freeze(Object.keys(CURRENCIES));

/** Sample rates used by the prototype: value of 1 unit in taka. Replace with live rates in production. */
export const SAMPLE_RATES = Object.freeze({ BDT: 1, USD: 122, CNY: 17 });

export function isCurrency(cur) {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, cur);
}

export function isValidNote(cur, value) {
  return isCurrency(cur) && CURRENCIES[cur].notes.includes(value);
}

export function noteKey(cur, value) {
  if (!isValidNote(cur, value)) throw new RangeError(`Unknown note ${cur} ${value}`);
  return `${cur}:${value}`;
}

export function parseNoteKey(key) {
  const m = /^([A-Z]{3}):(\d+)$/.exec(String(key));
  if (!m) throw new RangeError(`Bad note key "${key}"`);
  const cur = m[1];
  const value = Number(m[2]);
  if (!isValidNote(cur, value)) throw new RangeError(`Unknown note ${key}`);
  return { cur, value };
}

/** Returns a new inventory with one more note of `key`. */
export function addNote(inventory, key, n = 1) {
  parseNoteKey(key);
  return { ...inventory, [key]: (inventory[key] || 0) + n };
}

/** Returns a new inventory with one note of `key` removed. Throws if there is none. */
export function removeNote(inventory, key, n = 1) {
  parseNoteKey(key);
  const have = inventory[key] || 0;
  if (have < n) throw new RangeError(`No ${key} note to remove`);
  const next = { ...inventory, [key]: have - n };
  if (next[key] === 0) delete next[key];
  return next;
}

/** Amount held in one currency, in that currency's units. */
export function balanceOf(inventory, cur) {
  let sum = 0;
  for (const [key, count] of Object.entries(inventory)) {
    const { cur: c, value } = parseNoteKey(key);
    if (c === cur) sum += value * count;
  }
  return sum;
}

/** Balances for every currency, never mixed: { BDT, USD, CNY }. */
export function balances(inventory) {
  const out = {};
  for (const c of CURRENCY_CODES) out[c] = balanceOf(inventory, c);
  return out;
}

/** Converts an amount between currencies through taka. */
export function convert(amount, from, to, rates = SAMPLE_RATES) {
  if (!isCurrency(from) || !isCurrency(to)) throw new RangeError('Unknown currency');
  if (!(rates[from] > 0) || !(rates[to] > 0)) throw new RangeError('Missing exchange rate');
  return (amount * rates[from]) / rates[to];
}

/** Total of several per-currency balances expressed in `target`. Display only. */
export function convertedTotal(balanceMap, target, rates = SAMPLE_RATES) {
  let sum = 0;
  for (const [cur, amount] of Object.entries(balanceMap)) sum += convert(amount, cur, target, rates);
  return sum;
}

export function format(amount, cur = 'BDT') {
  const { symbol } = CURRENCIES[cur];
  const decimals = cur === 'BDT' || Math.abs(amount) >= 100 ? 0 : 2;
  const n = Math.abs(amount).toLocaleString(cur === 'BDT' ? 'en-IN' : 'en-US', { maximumFractionDigits: decimals });
  return `${amount < 0 ? '−' : ''}${symbol}${n}`;
}
