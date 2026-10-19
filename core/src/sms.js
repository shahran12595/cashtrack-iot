// Parses bank and mobile-wallet SMS on the phone. Only known senders are read,
// and the raw text is never uploaded. Formats follow the demo senders used in the simulator.

export const KNOWN_SENDERS = Object.freeze(['DemoBank', 'MobiPay']);

export const MERCHANT_CATEGORIES = Object.freeze({
  'City Grocers': 'Food',
  'Food Corner': 'Food',
  'Metro Pharmacy': 'Health',
  'Campus Bookshop': 'Education',
  RideNow: 'Transport',
  'Power Utility': 'Bills',
  'Style Mart': 'Shopping',
});

const num = (s) => Number(s.replace(/,/g, ''));

/**
 * @returns {null | {amount:number|null, balance:number|null, direction:'in'|'out'|null, merchant:string|null, category:string}}
 *   null when the sender is not a known bank sender
 */
export function parseSms(sender, text, categories = MERCHANT_CATEGORIES) {
  if (!KNOWN_SENDERS.includes(sender)) return null;
  const amount = text.match(/Tk\s?([\d,]+\.\d{2})/);
  const balance = text.match(/(?:Avl Bal|Balance)\s*Tk\s?([\d,]+\.\d{2})/i);
  const direction = /(debited|payment|paid|sent|withdrawn)/i.test(text)
    ? 'out'
    : /(credited|received)/i.test(text)
      ? 'in'
      : null;
  const mer = text.match(/\b(?:at|to)\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)*)(?=\s+(?:on|successful)\b)/);
  const merchant = mer ? mer[1] : null;
  const category = direction === 'in' ? 'Income' : categories[merchant] || 'Other';
  return {
    amount: amount ? num(amount[1]) : null,
    balance: balance ? num(balance[1]) : null,
    direction,
    merchant,
    category,
  };
}
