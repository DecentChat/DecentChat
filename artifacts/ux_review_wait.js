const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

(async() => {
  const outDir = path.join(process.cwd(), 'artifacts', 'ux2');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  async function capture(name, url, viewport, readyText, actions) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (readyText) {
      await page.getByText(readyText, { exact: false }).waitFor({ timeout: 15000 });
    }
    await page.waitForTimeout(1500);
    if (actions) await actions(page);
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
    console.log(`saved ${name}`);
    await context.close();
  }

  await capture('landing_desktop_ready', 'http://127.0.0.1:4173/', { width: 1440, height: 1200 }, 'Start private chat');
  await capture('landing_mobile_ready', 'http://127.0.0.1:4173/', { width: 390, height: 844 }, 'Start private chat');
  await capture('create_modal_desktop_ready', 'http://127.0.0.1:4173/app', { width: 1440, height: 1200 }, 'Create private group', async (page) => {
    await page.getByRole('button', { name: /^Create private group$/i }).first().click();
    await page.getByLabel(/group name/i).waitFor({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);
  });
  await capture('create_modal_mobile_ready', 'http://127.0.0.1:4173/app', { width: 390, height: 844 }, 'Create private group', async (page) => {
    await page.getByRole('button', { name: /^Create private group$/i }).first().click();
    await page.waitForTimeout(1000);
  });

  await browser.close();
})();
