// End-to-end tests of the simulator in a real browser (Playwright).
import { test, expect } from '@playwright/test';

const sim = (page, fn, arg) => page.evaluate(fn, arg);
const state = (page) => sim(page, () => JSON.parse(JSON.stringify(window.__sim.S())));
const balance = (inv, cur) => Object.entries(inv).reduce((a, [k, n]) => (k.startsWith(cur + ':') ? a + Number(k.split(':')[1]) * n : a), 0);

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); // tests run offline
  await page.goto('/');
  await page.waitForFunction(() => window.__sim);
  await sim(page, () => window.__sim.setSpeed(0.15));
});
test.afterEach(() => expect(errors, 'no JavaScript errors').toEqual([]));

async function pickNote(page, cur, value) {
  await page.click(`#curSel [data-cur=${cur}]`);
  await page.click(`#denoms [data-d="${value}"]`);
}
async function idle(page) {
  await expect.poll(() => sim(page, () => window.__sim.ui.busy), { timeout: 20_000 }).toBe(false);
}

test('E2E-01 the app shows taka, dollar and yuan balances separately', async ({ page }) => {
  const hero = page.locator('#app .curbig b');
  await expect(hero).toHaveCount(3);
  const text = (await hero.allTextContents()).join(' ');
  expect(text).toContain('৳');
  expect(text).toContain('$');
  expect(text).toContain('¥');
});

test('E2E-02 a taka note going in changes only the taka balance', async ({ page }) => {
  const before = (await state(page)).wallet;
  await pickNote(page, 'BDT', 500);
  await page.click('#wInBtn');
  await idle(page);
  const after = (await state(page)).wallet;
  expect(balance(after, 'BDT')).toBe(balance(before, 'BDT') + 500);
  expect(balance(after, 'USD')).toBe(balance(before, 'USD'));
  expect(balance(after, 'CNY')).toBe(balance(before, 'CNY'));
});

test('E2E-03 dollar and yuan notes are recognised in their own currency', async ({ page }) => {
  const before = (await state(page)).wallet;
  await pickNote(page, 'USD', 20);
  await page.click('#wInBtn');
  await idle(page);
  await pickNote(page, 'CNY', 100);
  await page.click('#wInBtn');
  await idle(page);
  const after = (await state(page)).wallet;
  expect(balance(after, 'USD')).toBe(balance(before, 'USD') + 20);
  expect(balance(after, 'CNY')).toBe(balance(before, 'CNY') + 100);
  expect(balance(after, 'BDT')).toBe(balance(before, 'BDT'));
});

test('E2E-04 a counterfeit note is flagged and not counted', async ({ page }) => {
  const before = await state(page);
  await page.check('#fakeChk');
  await pickNote(page, 'BDT', 1000);
  await page.click('#wInBtn');
  await idle(page);
  const after = await state(page);
  expect(after.wallet).toEqual(before.wallet);
  expect(after.fakes).toBe(before.fakes + 1);
});

test('E2E-05 low confidence asks the user before counting', async ({ page }) => {
  const before = (await state(page)).wallet;
  await page.check('#lowChk');
  await pickNote(page, 'BDT', 100);
  await page.click('#wInBtn');
  const sheet = page.locator('#sheet');
  await expect(sheet).toContainText('Did you add');
  await sheet.locator('[data-d="100"]').click();
  await idle(page);
  expect(balance((await state(page)).wallet, 'BDT')).toBe(balance(before, 'BDT') + 100);
});

test('E2E-06 a taka withdrawal with a fingerprint leaves dollars and yuan untouched', async ({ page }) => {
  const before = (await state(page)).vault;
  await page.click('[data-tab=vault]');
  await page.fill('#wdAmt', '2000');
  await page.click('#app [data-act=withdraw]');
  await page.click('#sheet [data-k=fp]');
  await expect.poll(async () => balance((await state(page)).vault, 'BDT'), { timeout: 20_000 }).toBe(balance(before, 'BDT') - 2000);
  const after = (await state(page)).vault;
  expect(balance(after, 'USD')).toBe(balance(before, 'USD'));
  expect(balance(after, 'CNY')).toBe(balance(before, 'CNY'));
});

test('E2E-07 an amount the vault cannot dispense is refused before any prompt', async ({ page }) => {
  await page.click('[data-tab=vault]');
  await page.fill('#wdAmt', '150');
  await page.click('#app [data-act=withdraw]');
  await expect(page.locator('#app')).toContainText('multiple of ৳100');
  await expect(page.locator('#sheetWrap')).toBeHidden();
});

test('E2E-08 after 3 failed fingerprints the PIN completes the withdrawal', async ({ page }) => {
  const before = balance((await state(page)).vault, 'BDT');
  await page.check('#wetChk');
  await page.click('[data-tab=vault]');
  await page.fill('#wdAmt', '1000');
  await page.click('#app [data-act=withdraw]');
  for (let i = 0; i < 3; i++) await page.click('#sheet [data-k=fp]');
  await expect(page.locator('#sheet')).toContainText('Enter your PIN');
  for (const d of '246810') await page.click(`#sheet [data-n="${d}"]`);
  await expect.poll(async () => balance((await state(page)).vault, 'BDT'), { timeout: 20_000 }).toBe(before - 1000);
});

test('E2E-09 five wrong PINs lock withdrawals', async ({ page }) => {
  await page.click('[data-tab=vault]');
  await page.fill('#wdAmt', '1000');
  await page.click('#app [data-act=withdraw]');
  await page.click('#sheet [data-k=pin]');
  for (let i = 0; i < 5; i++) {
    for (const d of '111111') await page.click(`#sheet [data-n="${d}"]`);
    await page.waitForTimeout(250);
  }
  await expect(page.locator('#pinMsg')).toContainText('Too many wrong PINs');
  expect((await state(page)).pinLock).toBeGreaterThan(Date.now());
});

test('E2E-10 the converted total appears only when asked, in the chosen currency', async ({ page }) => {
  await expect(page.locator('#app .totbox .big')).toHaveCount(0);
  await page.click('#app [data-act=showtot]');
  await page.click('#app [data-act=disp][data-c=USD]');
  await expect(page.locator('#app .totbox .big')).toContainText('$');
});

test('E2E-11 the built-in AI coach answers from the user’s own figures', async ({ page }) => {
  await page.click('[data-tab=coach]');
  await expect(page.locator('#app')).toContainText('goals');
  await page.fill('#chatIn', 'How can I save for my laptop?');
  await page.click('#app [data-act=send]');
  await expect
    .poll(() => sim(page, () => window.__sim.ui.chat.at(-1).text), { timeout: 15_000 })
    .toMatch(/Laptop for final-year project: put aside ৳[\d,]+ a month/);
});

test('E2E-12 the layout fits a 390 px phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('E2E-13 the guided demo runs every step without errors', async ({ page }) => {
  test.setTimeout(150_000);
  await sim(page, () => window.__sim.runDemo());
  await expect.poll(() => sim(page, () => window.__sim.demo.on), { timeout: 140_000, intervals: [1000] }).toBe(false);
});
