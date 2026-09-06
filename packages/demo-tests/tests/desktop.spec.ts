import { test, expect } from './fixture.js';

test('navigates desktop → CRM → customer form', async ({ page, screen }) => {
  await page.goto('/');

  const desktop = screen('desktop');
  await desktop.waitFor();
  await desktop.element('crmIcon').click();

  const crm = screen('crm-system');
  await crm.waitFor();
  await crm.element('newCustomer').click();

  const form = screen('customer-information');
  await form.waitFor();
  await expect(page.locator('canvas#desktopCanvas')).toBeVisible();
});

test('fills a few customer-information fields', async ({ page, screen }) => {
  await page.goto('/');

  const desktop = screen('desktop');
  await desktop.waitFor();
  await desktop.element('crmIcon').click();

  const crm = screen('crm-system');
  await crm.waitFor();
  await crm.element('newCustomer').click();

  const form = screen('customer-information');
  await form.waitFor();

  // Fill using canvas test API (canvas apps don't support standard keyboard input)
  await page.evaluate(() => {
    (window as any).testFillElement('firstName', null, 'John');
    (window as any).testFillElement('lastName', null, 'Smith');
    (window as any).testFillElement('phone', 'area', '555');
    (window as any).testFillElement('phone', 'prefix', '123');
    (window as any).testFillElement('phone', 'line', '4567');
  });
  
  await page.waitForTimeout(200); // Let canvas render

  await form.element('firstName').toHaveValue('John');
  await form.element('lastName').toHaveValue('Smith');
  await form.element('phone').part('area').toHaveValue('555');
});

test('searches for customer by VIN and loads data', async ({ page, screen }) => {
  await page.goto('/');

  const desktop = screen('desktop');
  await desktop.waitFor();
  await desktop.element('crmIcon').click();

  const crm = screen('crm-system');
  await crm.waitFor();

  // Click search field and type VIN
  await crm.element('searchCustomers').click();
  await page.waitForTimeout(100);
  
  // Type VIN and press Enter to search
  await page.keyboard.type('1HGBH41JXMN109186');
  await page.keyboard.press('Enter');
  
  await page.waitForTimeout(200);

  // Customer form should open with data loaded
  const form = screen('customer-information');
  await form.waitFor();

  // Verify customer data was loaded correctly via OCR
  await form.element('firstName').toHaveValue('John');
  await form.element('lastName').toHaveValue('Smith');
  await form.element('email').toHaveValue('john@example.com');
  await form.element('phone').part('area').toHaveValue('555');
  await form.element('phone').part('prefix').toHaveValue('123');
  await form.element('phone').part('line').toHaveValue('4567');
  await form.element('vin').toHaveValue('1HGBH41JXMN109186');
});
