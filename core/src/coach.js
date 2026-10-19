// AI finance coach: turns the user's own figures into goals, suggested budgets and saving tips.
// Everything here is deterministic. The live AI answers questions using only `summaryForAI()`,
// and the built-in rules in `localAnswer()` answer when the AI service is unavailable.
// The coach gives suggestions only; it has no way to move money or change settings.

import { SAMPLE_RATES, format } from './currency.js';

export const CATEGORIES = Object.freeze(['Food', 'Transport', 'Shopping', 'Education', 'Bills', 'Health', 'Other']);
export const FLOORS = Object.freeze({ Food: 2500, Transport: 800, Shopping: 500, Education: 800, Bills: 2000, Health: 500, Other: 500 });
export const WANTS = Object.freeze(['Shopping', 'Other']);
const DAY = 86_400_000;
const MONTH = 30 * DAY;

export const roundTo100 = (v) => Math.max(100, Math.round(v / 100) * 100);

const toTaka = (amount, cur, rates) => amount * (rates[cur || 'BDT'] ?? 1);

/**
 * @param {object} data
 * @param {number} data.income monthly income in taka
 * @param {Array<{t:number, kind:'in'|'out'|'move', amount:number, cur?:string, cat?:string|null, src?:string}>} data.transactions
 * @param {Record<string, number>} data.budgets monthly limits in taka
 * @param {Array<{name:string, cur:string, target:number, saved:number, due:number}>} data.goals
 * @param {Record<string, number>} [data.rates]
 * @param {number} [now]
 */
export function coach(data, now = Date.now()) {
  const rates = data.rates || SAMPLE_RATES;
  const since = now - MONTH;
  const outs = data.transactions.filter((t) => t.kind === 'out' && t.t >= since && t.cat !== 'Withdrawal');
  const spend = outs.reduce((a, t) => a + toTaka(t.amount, t.cur, rates), 0);
  const cashOuts = outs.filter((t) => t.src === 'wallet');
  const cash = cashOuts.reduce((a, t) => a + toTaka(t.amount, t.cur, rates), 0);
  const income = data.income;
  const surplus = income - spend;

  const goals = data.goals.map((g) => {
    const remaining = Math.max(0, g.target - g.saved) * (rates[g.cur] ?? 1);
    const months = Math.max(0.5, (g.due - now) / MONTH);
    return { ...g, remaining, months, monthlyNeed: remaining / months, progress: Math.min(1, g.saved / g.target) };
  });
  const need = goals.reduce((a, g) => a + g.monthlyNeed, 0);
  const gap = need - surplus;

  const spentBy = {};
  for (const c of CATEGORIES) {
    spentBy[c] = outs.filter((t) => t.cat === c).reduce((a, t) => a + toTaka(t.amount, t.cur, rates), 0);
  }

  // Suggested budget: last month's spend + 10%, never below a safe floor; wants trimmed by 20%;
  // scaled down so that budgets leave room for goals (at most half the income is reserved), then rounded.
  const suggested = {};
  for (const c of CATEGORIES) {
    let v = Math.max(spentBy[c] * 1.1, FLOORS[c]);
    if (WANTS.includes(c)) v *= 0.8;
    suggested[c] = v;
  }
  const cap = Math.max(income - Math.min(need, income * 0.5), 0);
  const sum = CATEGORIES.reduce((a, c) => a + suggested[c], 0);
  if (cap > 0 && sum > cap) for (const c of CATEGORIES) suggested[c] *= cap / sum;
  for (const c of CATEGORIES) suggested[c] = roundTo100(suggested[c]);
  const suggestedTotal = CATEGORIES.reduce((a, c) => a + suggested[c], 0);

  const tips = [];
  const roundUp = cashOuts
    .filter((t) => (t.cur || 'BDT') === 'BDT')
    .reduce((a, t) => a + (Math.ceil(t.amount / 100) * 100 - t.amount), 0);
  if (roundUp > 0) tips.push({ id: 'round-up', title: 'Save the change', monthlySaving: roundUp });
  const [want, wantSpent] = WANTS.map((c) => [c, spentBy[c]]).sort((a, b) => b[1] - a[1])[0];
  if (wantSpent > 0) tips.push({ id: 'wants', title: `Spend a quarter less on ${want.toLowerCase()}`, monthlySaving: wantSpent * 0.25 });
  if (spentBy.Food > 0) tips.push({ id: 'lunch', title: 'Carry lunch twice a week', monthlySaving: spentBy.Food * 0.2 });
  for (const c of CATEGORIES) {
    if (data.budgets[c] && spentBy[c] >= 0.8 * data.budgets[c]) tips.push({ id: `watch-${c}`, title: `Watch ${c.toLowerCase()}`, monthlySaving: 0 });
  }
  if (spend > 0 && cash / spend > 0.5) {
    tips.push({ id: 'allowance', title: 'Use a weekly cash allowance', weekly: roundTo100(cash / 4.3), monthlySaving: 0 });
  }
  const tipSaving = tips.reduce((a, t) => a + t.monthlySaving, 0);

  const headline = !goals.length
    ? 'Add a goal and I’ll plan how to reach it.'
    : gap > 0
      ? `You’re ${format(gap)} a month short of your ${goals.length} goals.`
      : `You’re on track for all ${goals.length} goals, with ${format(-gap)} a month to spare.`;

  return { spend, cash, income, surplus, goals, need, gap, spentBy, suggested, suggestedTotal, tips, tipSaving, headline };
}

/**
 * The only data the live AI sees: totals, categories and goals. No SMS text, account numbers or places.
 */
export function summaryForAI(result, balances) {
  return {
    balances,
    monthlyIncomeBDT: Math.round(result.income),
    last30DaysSpendBDT: Math.round(result.spend),
    cashShareOfSpending: result.spend ? +(result.cash / result.spend).toFixed(2) : 0,
    spendingByCategoryBDT: Object.fromEntries(Object.entries(result.spentBy).map(([k, v]) => [k, Math.round(v)])),
    suggestedBudgetsBDT: result.suggested,
    goals: result.goals.map((g) => ({
      name: g.name,
      currency: g.cur,
      target: g.target,
      saved: g.saved,
      monthsLeft: +g.months.toFixed(1),
      neededPerMonthBDT: Math.round(g.monthlyNeed),
    })),
    tips: result.tips.map((t) => ({ title: t.title, monthlySavingBDT: Math.round(t.monthlySaving) })),
  };
}

/** Rule-based answer used when the AI service is unavailable (and in tests). */
export function localAnswer(question, result) {
  const q = question.toLowerCase();
  const lines = [];
  if (/save|saving|goal|laptop|trip|emergency|afford/.test(q)) {
    lines.push(result.headline);
    for (const g of result.goals) lines.push(`- ${g.name}: put aside ${format(g.monthlyNeed)} a month.`);
    result.tips.filter((t) => t.monthlySaving > 0).slice(0, 2).forEach((t) => lines.push(`- ${t.title}: about ${format(t.monthlySaving)} a month.`));
  } else if (/budget|limit|plan|next month/.test(q)) {
    lines.push(`Suggested budgets, total ${format(result.suggestedTotal)}:`);
    for (const c of CATEGORIES) lines.push(`- ${c}: ${format(result.suggested[c])}`);
  } else if (/spend|where|most|categor/.test(q)) {
    const top = CATEGORIES.map((c) => [c, result.spentBy[c]]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    lines.push(`In the last 30 days you spent ${format(result.spend)}.`);
    top.forEach(([c, v]) => lines.push(`- ${c}: ${format(v)}`));
  } else {
    lines.push(result.headline);
    result.tips.slice(0, 3).forEach((t) => lines.push(`- ${t.title}`));
  }
  return lines.join('\n');
}
