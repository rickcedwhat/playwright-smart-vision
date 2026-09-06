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
  await form.element('lastName').toHaveValue('Smith');
  await form.element('phone').part('area').toHaveValue('555');
});
