
const { chromium } = require('@playwright/test');
(async() => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await context.newPage();
  page.on('console', msg => console.log('console:', msg.type(), msg.text()));
  await page.goto('http://127.0.0.1:5173/app', { waitUntil: 'networkidle' });
  await page.click('#create-ws-btn');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'artifacts/ux-app-after-create.png', fullPage: true });
  console.log('URL', page.url());
  console.log('BODY CLASSES', await page.locator('body').getAttribute('class'));
  console.log('TEXT', await page.locator('body').innerText());
  await browser.close();
})();
