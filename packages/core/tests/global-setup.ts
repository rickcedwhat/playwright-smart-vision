import { chromium } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Navigate to customer.html without sessionStorage set → fields render empty
  await page.goto('http://localhost:4321/customer.html');
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({
    path: path.join(__dirname, 'screens/html-customer-information/blank.png'),
  });

  await page.goto('http://localhost:4321/login.html');
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({
    path: path.join(__dirname, 'screens/html-login/blank.png'),
  });

  await browser.close();
}
