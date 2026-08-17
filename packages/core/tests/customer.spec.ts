import { test, expect } from '../src/ocr-test.js';
import { htmlLoginScreen } from './screens/html-login/config.js';
import { htmlNavScreen } from './screens/html-nav/config.js';
import { htmlCustomerInformationScreen } from './screens/html-customer-information/config.js';

test.use({
  trace: 'on',
  ocrOverlay: true,
});

test.setTimeout(180_000);

test('HTML Customer Information — full flow', async ({ page, ocrScreen }) => {
  await page.goto('/login.html');

  const login = ocrScreen(htmlLoginScreen);
  await login.element('username').fill('qawolf');
  await login.element('password').fill('secret');
  await login.element('username').toHaveValue('qawolf');
  await login.element('signIn').click();

  const nav = ocrScreen(htmlNavScreen);
  await nav.waitFor();
  await nav.element('customerSearch').click();

  const customer = ocrScreen(htmlCustomerInformationScreen);
  await customer.waitFor();

  // Basic field values
  await customer.element('customerNumber').toHaveValue('SEA314535');
  await customer.element('vin').toHaveValue('5NPDH4AE1DH314535');
  await customer.element('address').toHaveValue('123 MAIN ST');
  await customer.element('email').toHaveValue('QAWCUSTOMER@QAWOLF.EMAIL');

  // Multipart fields
  await customer.element('name').part('firstName').toHaveValue('QAWCUSTOMR');
  await customer.element('name').part('middleInitial').toBeEmpty();
  await customer.element('name').part('lastName').toHaveValue('SEARCH');

  await customer.element('homePhone').toHaveValue('760 543 2987');
  await customer.element('homePhone').part('area').toHaveValue('760');
  await customer.element('homePhone').part('prefix').toHaveValue('543');
  await customer.element('homePhone').part('line').toHaveValue('2987');

  await customer.element('cityState').part('city').toHaveValue('LOS ANGELES');
  await customer.element('cityState').part('state').toHaveValue('CA');
  await customer.element('cityState').part('zip').toHaveValue('90201');

  await customer.element('primaryContactMethod').toHaveValue('H - Home Phone');

  // Checkboxes — same template (active.png), section anchors disambiguate
  await customer.element('customerActive').toBeUnchecked();
  await customer.element('vehicleActive').toBeChecked();
  await customer.element('doNotCall').toBeUnchecked();

  // Empty date fields
  await customer.element('birthdate').toBeEmpty();
  await customer.element('birthdate').part('month').toBeEmpty();
  await customer.element('birthdate').part('day').toBeEmpty();
  await customer.element('birthdate').part('year').toBeEmpty();

  // Vehicle section
  await customer.element('stockNo').toHaveValue('HG9876');
  await customer.element('year').toHaveValue('2013');
  await customer.element('make').toHaveValue('HYUNDAI');
  await customer.element('model').toHaveValue('ELANTRA GL');
  await customer.element('color').toHaveValue('WHITE');
  await customer.element('odometer').toHaveValue('20398');

  await customer.element('delivered').toHaveValue('10 25 23');
  await customer.element('delivered').part('month').toHaveValue('10');
  await customer.element('delivered').part('day').toHaveValue('25');
  await customer.element('delivered').part('year').toHaveValue('23');

  // Save starts disabled
  await customer.element('save').toHaveVariant('disabled');

  // Dirty form → save enables
  await customer.element('customerActive').click();
  await customer.element('customerActive').toBeChecked();
  await customer.element('save').toHaveVariant('enabled');

  // Click save → toast appears, save disables again, toast auto-dismisses
  await customer.element('save').click();
  await customer.element('saveStatus').toBeVisible();
  await customer.element('save').toHaveVariant('disabled');
  await page.locator('#saveToast').waitFor({ state: 'hidden' });

  // Window repositioning — waitFor re-extracts at new position
  const moveWindow = page.locator('#moveWindow');
  for (const pos of ['middle-left', 'bottom-right']) {
    await moveWindow.click();
    await expect(moveWindow).toHaveAttribute('data-pos', pos);
    await customer.waitFor();
    await customer.element('customerNumber').toHaveValue('SEA314535');
    await customer.element('name').part('lastName').toHaveValue('SEARCH');
  }
});
