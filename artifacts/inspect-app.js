
const { chromium } = require('@playwright/test');
(async() => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await context.newPage();
  page.on('console', msg => console.log('console:', msg.type(), msg.text()));
  await page.goto('http://127.0.0.1:5173/app', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'artifacts/ux-app-initial.png', fullPage: true });
  const buttons = await page.locator('button').evaluateAll(btns => btns.map(b => ({text:b.textContent?.trim(), id:b.id, cls:b.className})));
  console.log(JSON.stringify(buttons, null, 2));
  await browser.close();
})();
