import { test, expect } from './fixture.js';

async function openNewCustomer(page, screen) {
  await page.goto('/');
  const desktop = screen('desktop');
  await desktop.waitFor();
  await desktop.element('crmIcon').click();
  const crm = screen('crm-system');
  await crm.waitFor();
  await crm.element('newCustomer').click();
  const form = screen('customer-information');
  await form.waitFor();
  return form;
}

test('navigates desktop → CRM → customer form', async ({ page, screen }) => {
  const form = await openNewCustomer(page, screen);
  await expect(page.locator('canvas#desktopCanvas')).toBeVisible();
  await form.element('save').toBeDisabled();
});

test('fills customer-information fields with Element.fill', async ({ page, screen }) => {
  const form = await openNewCustomer(page, screen);

  await form.element('firstName').fill('John');
  await form.element('lastName').fill('Smith');
  await form.element('phone').part('area').fill('555');
  await form.element('phone').part('prefix').fill('123');
  await form.element('phone').part('line').fill('4567');

  await form.element('firstName').toHaveValue('John');
  await form.element('lastName').toHaveValue('Smith');
  await form.element('phone').part('area').toHaveValue('555');
});

test('save getVariant is disabled and not enabled', async ({ page, screen }) => {
  const form = await openNewCustomer(page, screen);
  const save = form.element('save');

  expect(await save.getVariant()).toBe('disabled');
  await save.not.toHaveVariant('enabled');
  await save.not.toHaveVariant('loading');
});

test('save button cycles disabled → enabled → loading → disabled', async ({ page, screen }) => {
  const form = await openNewCustomer(page, screen);

  await form.element('save').toHaveVariant('disabled');

  await form.element('firstName').fill('Ada');
  await form.element('lastName').fill('Lovelace');

  await form.element('save').toHaveVariant('enabled');
  await form.element('save').click();
  await form.element('save').toHaveVariant('loading', { timeout: 2_000 });
  await form.element('save').toHaveVariant('disabled', { timeout: 4_000 });
});

test('searches for customer by VIN and loads data', async ({ page, screen }) => {
  await page.goto('/');

  const desktop = screen('desktop');
  await desktop.waitFor();
  await desktop.element('crmIcon').click();

  const crm = screen('crm-system');
  await crm.waitFor();

  await crm.element('searchCustomers').fill('1HGBH');
  await (await crm.getByText('1HGBH41JXMN109186')).click();

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
