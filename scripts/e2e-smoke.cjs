// Phone-size smoke test of the core loop (spec §12.2, §15).
// Usage: start `npm run preview` (or wrangler dev with AUTH_DISABLED=true), then
//   node scripts/e2e-smoke.cjs [baseUrl] [screenshotDir]
const { chromium, devices } = require('playwright');
const path = require('path');

const base = process.argv[2] || 'http://127.0.0.1:8787';
const out = process.argv[3] || '';
const shot = async (page, name) => { if (out) await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true }); };
const expectText = async (page, text) => { await page.getByText(text, { exact: false }).first().waitFor({ timeout: 8000 }); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // 1. Home: nothing in use yet, imported coffees available.
  await page.goto(base + '/');
  await expectText(page, 'No coffees marked as in use');
  await shot(page, '01-home-empty');

  // 2. Open an imported coffee and mark it as in use.
  await page.getByRole('link', { name: 'Imported coffees' }).click();
  await page.getByText('Lazzio Brazil Single Origin').click();
  await expectText(page, 'Minas Gerais');
  await shot(page, '02-coffee-imported');
  await page.getByRole('button', { name: 'Mark as in use' }).click();
  await expectText(page, 'In use');

  // 3. Log the first shot: 24 s, sour. Count taps/inputs.
  let taps = 0;
  await page.getByRole('link', { name: 'Log shot' }).first().click(); taps++;
  await page.getByLabel('Time', { exact: true }).fill('24'); taps++;
  await page.getByLabel('Grind', { exact: true }).fill('14'); taps++;
  await page.getByRole('button', { name: 'Sour' }).click(); taps++;
  await page.getByRole('button', { name: '2 stars' }).click(); taps++;
  await shot(page, '03-log-shot');
  await page.getByRole('button', { name: 'Save shot' }).click(); taps++;
  await expectText(page, 'Grind finer: 14 → 13');
  await shot(page, '04-advice-finer');
  console.log(`first shot logged in ${taps} taps/inputs (incl. opening the form)`);
  await page.getByRole('button', { name: 'Use for next shot' }).click();

  // 4. Second shot: grind is prefilled at 13; 29 s, sweet + chocolate, 5 stars.
  await expectText(page, 'Recipe history');
  await page.getByRole('link', { name: 'Log shot' }).first().click();
  const grind = await page.getByLabel('Grind', { exact: true }).inputValue();
  if (grind !== '13') throw new Error(`grind not prefilled from the new recipe (got ${grind})`);
  await page.getByLabel('Time', { exact: true }).fill('29');
  await page.getByRole('button', { name: 'Sweet' }).click();
  await page.getByRole('button', { name: 'Chocolate' }).click();
  await page.getByRole('button', { name: '5 stars' }).click();
  await page.getByRole('button', { name: 'Save shot' }).click();
  await expectText(page, 'Keep this recipe: promising');
  await shot(page, '05-advice-keep');
  await page.getByRole('button', { name: 'Keep this recipe' }).click();

  // 5. Coffee page: best shot, history, recipe timeline.
  await expectText(page, 'Best shot so far');
  await expectText(page, 'promising');
  await shot(page, '06-coffee-history');

  // 6. Home now shows the coffee in use with its recipe.
  await page.getByRole('link', { name: 'Home' }).click();
  await expectText(page, 'Next: Keep this recipe: promising');
  await shot(page, '07-home');

  // 7. Add a new coffee manually, with a photo; it gets a starting recipe.
  await page.goto(base + '/coffees/new');
  await page.locator('input[type=file]').first().setInputFiles(path.join(__dirname, '..', 'public', 'icon-192.png'));
  await page.locator('.photos img').first().waitFor();
  await page.getByPlaceholder('e.g. Lazzio Brazil Single Origin').fill('Test Kenya AA');
  await page.getByLabel(/Roast level/).selectOption('light');
  await page.getByLabel(/Processing/).fill('Washed');
  await shot(page, '08-add-coffee');
  await page.getByRole('button', { name: 'Save coffee' }).click();
  await expectText(page, 'Light roast');
  await expectText(page, '1:2.2');
  await shot(page, '09-new-coffee');

  // 8. Settings: assign the historical shot to the Guatemala; CSV exports are offered.
  await page.getByRole('link', { name: 'Settings' }).click();
  await expectText(page, 'Shots without a coffee');
  await expectText(page, 'Shots CSV');
  await shot(page, '10-settings');
  await page.getByLabel('Assign to coffee').selectOption({ label: 'Lazzio Luxe Reserve Guatemala' });
  await page.getByText('Shots without a coffee').waitFor({ state: 'detached' });

  // 9. Brazil: dial-in chart, planned vs actual, and correcting a shot's numbers.
  await page.goto(base + '/coffees/6');
  await page.locator('figure.chart svg').waitFor();
  await expectText(page, 'Actual: 1 shot');
  await shot(page, '11-chart');
  await page.locator('.shot-row').last().click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Time', { exact: true }).fill('25');
  await page.getByRole('button', { name: 'Save & update advice' }).click();
  await expectText(page, '20 g → 40 g · 1:2 · 25 s');

  // 10. Compare Brazil and Guatemala.
  await page.goto(base + '/compare?ids=6,7');
  await expectText(page, 'Most chocolate-forward');
  await expectText(page, 'Planned vs actual');
  await shot(page, '12-compare');

  await browser.close();
  if (errors.length) { console.error('Console errors:\n' + errors.join('\n')); process.exit(1); }
  console.log('Smoke test passed.');
})().catch((e) => { console.error(e); process.exit(1); });
