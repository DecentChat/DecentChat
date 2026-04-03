const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
(async() => {
  const outDir = path.join(process.cwd(), 'artifacts', 'ux3');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  for (const [name, viewport] of [
    ['create_modal_desktop_after', { width: 1440, height: 1200 }],
    ['create_modal_mobile_after', { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/app', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Create private group$/i }).first().waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /^Create private group$/i }).first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
    console.log(`saved ${name}`);
    await context.close();
  }
  await browser.close();
})();
