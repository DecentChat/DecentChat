
const { chromium } = require('@playwright/test');
(async() => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await context.newPage();
  page.on('console', msg => console.log('console:', msg.type(), msg.text()));
  await page.goto('http://127.0.0.1:5173/app', { waitUntil: 'networkidle' });
  await page.click('#create-ws-btn');
  await page.fill('input[name="name"]', 'UX Review Workspace');
  await page.fill('input[name="alias"]', 'Iris');
  await page.click('.create-workspace-submit');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'artifacts/ux-app-main.png', fullPage: true });
  console.log('URL', page.url());
  console.log('TEXT SAMPLE', (await page.locator('body').innerText()).slice(0, 3000));
  await browser.close();
})();
