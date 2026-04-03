
const { chromium } = require('@playwright/test');
(async() => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({ viewport: { width: 390, height: 1600 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'artifacts/ux-landing-mobile.png', fullPage: true });
  await browser.close();
})();
