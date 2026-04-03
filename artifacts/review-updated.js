
const { chromium } = require('@playwright/test');
(async() => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5174/app', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'artifacts/ux-landing-desktop-updated.png', fullPage: true });
  await page.click('#create-ws-btn');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/ux-app-after-create-updated.png', fullPage: true });
  await browser.close();
})();
