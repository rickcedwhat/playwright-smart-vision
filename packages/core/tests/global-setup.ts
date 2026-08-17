import { chromium, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screens = (...p: string[]) => path.join(__dirname, 'screens', ...p);
const templates = (screen: string, file: string) => screens(screen, 'templates', file);

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Measure input/select positions in each row via getBoundingClientRect and
 * write them into the screen's index.json as ocrRect (single input) or parts
 * (multiple inputs, positional only — names come from config.ts).
 * Checkboxes are inset 1 px on every side so ocrRect covers the interior.
 */
async function measureAndUpdateIndex(
  page: Page,
  indexPath: string,
  items: Array<{ name: string; rowSel: string }>,
): Promise<void> {
  const data = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
    elements: Array<Record<string, unknown>>;
  };
  const byName = new Map(data.elements.map((e) => [e['name'] as string, e]));

  for (const { name, rowSel } of items) {
    const el = byName.get(name);
    if (!el) continue;

    const pos = await page.evaluate(
      (sel: string): { ocrRect: Rect; parts?: Rect[] } | null => {
        const row = document.querySelector(sel);
        if (!row) return null;
        const rowRect = row.getBoundingClientRect();
        const inputs = Array.from(
          row.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select',
          ),
        );
        if (!inputs.length) return null;

        const rects: Rect[] = inputs.map((input) => {
          const r = input.getBoundingClientRect();
          const isCheckbox = (input as HTMLInputElement).type === 'checkbox';
          const x = Math.round(r.left - rowRect.left);
          const y = Math.round(r.top - rowRect.top);
          const w = Math.round(r.width);
          const h = Math.round(r.height);
          return isCheckbox
            ? { x: x + 1, y: y + 1, width: w - 2, height: h - 2 }
            : { x, y, width: w, height: h };
        });

        if (rects.length === 1) return { ocrRect: rects[0] };

        const first = rects[0];
        const last = rects[rects.length - 1];
        return {
          ocrRect: {
            x: first.x,
            y: first.y,
            width: last.x + last.width - first.x,
            height: first.height,
          },
          parts: rects,
        };
      },
      rowSel,
    );

    if (!pos) continue;
    el['ocrRect'] = pos.ocrRect;
    if (pos.parts) {
      el['parts'] = pos.parts;
    } else {
      delete el['parts'];
    }
  }

  fs.writeFileSync(indexPath, JSON.stringify(data, null, 4) + '\n');
}

export default async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // login blank + element templates
  await page.goto('http://localhost:4321/login.html');
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: screens('html-login', 'blank.png') });
  await page.locator('.row:has(#username)').screenshot({ path: templates('html-login', 'username.png') });
  await page.locator('.row:has(#password)').screenshot({ path: templates('html-login', 'password.png') });
  await page.locator('#signIn').screenshot({ path: templates('html-login', 'sign-in.png') });

  await measureAndUpdateIndex(page, screens('html-login', 'index.json'), [
    { name: 'username', rowSel: '.row:has(#username)' },
    { name: 'password', rowSel: '.row:has(#password)' },
  ]);

  // nav blank — set sessionStorage before navigating so the redirect guard doesn't fire
  await page.goto('http://localhost:4321/login.html');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => sessionStorage.setItem('ocrLoggedIn', '1'));
  await page.goto('http://localhost:4321/nav.html');
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: screens('html-nav', 'blank.png') });

  // nav button templates
  for (const [id, file] of [
    ['customerSearch',   'customer-search.png'],
    ['vehicleInventory', 'vehicle-inventory.png'],
    ['service',          'service.png'],
    ['fni',              'fni.png'],
    ['parts',            'parts.png'],
    ['reports',          'reports.png'],
  ] as const) {
    await page.locator(`#${id}`).screenshot({ path: templates('html-nav', file) });
  }

  // customer blank — no sessionStorage so fields render empty
  await page.evaluate(() => sessionStorage.removeItem('ocrLoggedIn'));
  await page.goto('http://localhost:4321/customer.html');
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: screens('html-customer-information', 'blank.png') });

  // section anchor templates — captured from blank so they're always present
  await page.locator('.section-title').nth(0).screenshot({ path: templates('html-customer-information', 'customer-section.png') });
  await page.locator('.section-title').nth(1).screenshot({ path: templates('html-customer-information', 'vehicle-section.png') });

  // field element templates — captured from blank form rows
  for (const [file, selector] of [
    ['customer-number.png',        '.row:has(#customerNumber)'],
    ['vin.png',                    '.row:has(#vin)'],
    ['name.png',                   '.row:has(#firstName)'],
    ['home-phone.png',             '.row:has(#homeArea)'],
    ['address.png',                '.row:has(#address)'],
    ['birthdate.png',              '.row:has(#birthMonth)'],
    ['city-state.png',             '.row:has(#city)'],
    ['primary-contact-method.png', '.row:has(#contactMethod)'],
    ['email.png',                  '.row:has(#email)'],
    ['active.png',                 '.row:has(#active)'],
    ['stock-no.png',               '.row:has(#stockNo)'],
    ['delivered.png',              '.row:has(#deliveredMonth)'],
    ['year.png',                   '.row:has(#year)'],
    ['odometer.png',               '.row:has(#odometer)'],
    ['make.png',                   '.row:has(#make)'],
    ['color.png',                  '.row:has(#color)'],
    ['model.png',                  '.row:has(#model)'],
    ['do-not-call.png',            '.row:has(#doNotCall)'],
  ] as const) {
    await page.locator(selector).screenshot({ path: templates('html-customer-information', file) });
  }

  await measureAndUpdateIndex(page, screens('html-customer-information', 'index.json'), [
    { name: 'customerNumber',       rowSel: '.row:has(#customerNumber)' },
    { name: 'vin',                  rowSel: '.row:has(#vin)' },
    { name: 'name',                 rowSel: '.row:has(#firstName)' },
    { name: 'homePhone',            rowSel: '.row:has(#homeArea)' },
    { name: 'address',              rowSel: '.row:has(#address)' },
    { name: 'birthdate',            rowSel: '.row:has(#birthMonth)' },
    { name: 'cityState',            rowSel: '.row:has(#city)' },
    { name: 'primaryContactMethod', rowSel: '.row:has(#contactMethod)' },
    { name: 'email',                rowSel: '.row:has(#email)' },
    { name: 'customerActive',       rowSel: '.row:has(#active)' },
    { name: 'vehicleActive',        rowSel: '.row:has(#vehicleActive)' },
    { name: 'stockNo',              rowSel: '.row:has(#stockNo)' },
    { name: 'delivered',            rowSel: '.row:has(#deliveredMonth)' },
    { name: 'year',                 rowSel: '.row:has(#year)' },
    { name: 'odometer',             rowSel: '.row:has(#odometer)' },
    { name: 'make',                 rowSel: '.row:has(#make)' },
    { name: 'color',                rowSel: '.row:has(#color)' },
    { name: 'model',                rowSel: '.row:has(#model)' },
    { name: 'doNotCall',            rowSel: '.row:has(#doNotCall)' },
  ]);

  // save button variants — disabled by default, enabled after dirty
  await page.locator('#save').screenshot({ path: templates('html-customer-information', 'save-disabled.png') });
  await page.locator('#active').click(); // dirty the form
  await page.locator('#save').screenshot({ path: templates('html-customer-information', 'save-enabled.png') });

  // save toast — click save, screenshot toast before it auto-dismisses
  await page.locator('#save').click();
  await page.locator('#saveToast').waitFor({ state: 'visible' });
  await page.locator('#saveToast').screenshot({ path: templates('html-customer-information', 'save-toast.png') });

  await browser.close();
}
