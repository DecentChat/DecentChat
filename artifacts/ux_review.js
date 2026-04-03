const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

(async() => {
  const outDir = path.join(process.cwd(), 'artifacts', 'ux');
  fs.mkdirSync(outDir, { recursive: true });

  async function capture(name, url, viewport, actions) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on('console', msg => console.log(`[console:${name}] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.log(`[pageerror:${name}] ${err.message}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    if (actions) await actions(page);
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
    console.log(`SHOT ${name} ${page.url()}`);
    console.log(`TITLE ${name} ${await page.title()}`);
    const text = await page.locator('body').innerText();
    console.log(`BODY_START ${name}`);
    console.log(text.slice(0, 5000));
    console.log(`BODY_END ${name}`);
    await browser.close();
  }

  await capture('landing_desktop', 'http://127.0.0.1:4173/', { width: 1440, height: 1200 });
  await capture('landing_mobile', 'http://127.0.0.1:4173/', { width: 390, height: 844 });
  await capture('app_welcome_desktop', 'http://127.0.0.1:4173/app', { width: 1440, height: 1200 });
  await capture('app_welcome_mobile', 'http://127.0.0.1:4173/app', { width: 390, height: 844 });
  await capture('app_after_create_desktop', 'http://127.0.0.1:4173/app', { width: 1440, height: 1200 }, async (page) => {
    await page.getByRole('button', { name: /create private group/i }).first().click();
    await page.waitForTimeout(1200);
  });
  await capture('app_after_create_mobile', 'http://127.0.0.1:4173/app', { width: 390, height: 844 }, async (page) => {
    await page.getByRole('button', { name: /create private group/i }).first().click();
    await page.waitForTimeout(1200);
  });
})();
