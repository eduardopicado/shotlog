// Phone-size test of the AI screens against the fake Claude API (scripts/fake-claude.cjs).
// Usage: node scripts/fake-claude.cjs & ; .dev.vars with ANTHROPIC_API_KEY=sk-fake and
// ANTHROPIC_BASE_URL=http://127.0.0.1:8788 ; npm run preview ; node scripts/e2e-ai.cjs [baseUrl] [screenshotDir]
const { chromium, devices } = require('playwright');
const path = require('path');

const base = process.argv[2] || 'http://127.0.0.1:8787';
const out = process.argv[3] || '';
const shot = async (page, name) => { if (out) await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true }); };
const see = (page, text, timeout = 15000) => page.getByText(text, { exact: false }).first().waitFor({ timeout });
const photo = path.join(__dirname, '..', 'public', 'icon-192.png');

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1. Add coffee: bag + beans photos, read the bag.
  await page.goto(base + '/coffees/new');
  await page.locator('input[type=file]').nth(0).setInputFiles(photo);
  await page.locator('.photos img').first().waitFor();
  await page.locator('input[type=file]').nth(1).setInputFiles(photo);
  await page.locator('.photos img').nth(1).waitFor();
  await page.getByRole('button', { name: '✨ Read the bag' }).click();
  await see(page, 'Read from the bag');
  const name = await page.getByPlaceholder('e.g. Lazzio Brazil Single Origin').inputValue();
  if (name !== 'Lazzio Brazil Single Origin') throw new Error(`name not filled: ${name}`);
  await see(page, 'A true 1:2.25 would be 45 g');
  await see(page, 'Read on the bag: “LAZZIO”');
  if (await page.getByLabel(/Processing/).inputValue() !== '') throw new Error('processing should stay unknown');
  await page.getByRole('button', { name: '✨ Describe beans' }).click();
  await see(page, 'Visual observations');
  await shot(page, 'ai-01-review');

  // 2. Save: packaging recipe kept as reference, engine recipe current; ask the barista.
  await page.getByRole('button', { name: 'Save coffee' }).click();
  await see(page, 'Recipe history');
  await see(page, 'packaging');
  await see(page, 'Visual observations');
  await page.getByRole('button', { name: '✨ Ask the barista' }).click();
  await see(page, 'Chocolate and toffee from the bag');
  await shot(page, 'ai-02-coffee');

  // 3. Log a shot described in words: the barista reviews the advice automatically.
  await page.getByRole('link', { name: 'Log shot' }).first().click();
  await page.getByLabel('Time', { exact: true }).fill('29');
  await page.getByRole('button', { name: 'Sour' }).click();
  await page.getByPlaceholder('e.g. much sweeter, good chocolate, slightly thin').fill('sweet but sharp at the finish');
  await page.getByRole('button', { name: 'Save shot' }).click();
  await see(page, 'reviewed by the AI barista', 30000);
  await see(page, 'Increase yield to 42 g');
  await shot(page, 'ai-03-advice');

  // 4. Settings shows usage.
  await page.getByRole('link', { name: 'Settings' }).click();
  await see(page, 'Connected. Today:');
  await shot(page, 'ai-04-settings');

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('AI smoke test passed.');
})().catch((e) => { console.error(e); process.exit(1); });
