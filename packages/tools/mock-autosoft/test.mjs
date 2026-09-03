import { test, expect } from '@playwright/test';
import { init, screen, release, Strategies } from '../../core/src/index.js';
import os from 'os';
import path from 'path';

// ── Hardcode the expected values to match your test customer ─────────────────
// These must match what AUTOSOFT_CONNECT_CREDENTIALS returns for vin=5NPDH4AE1DH314535
// Update index.html MOCK object with the same values.
const RESULT = {
  customerId:  'SEA314535',
  person: {
    firstName: 'QAWCUSTOMR',  // verify — matches what OCR reads at name.firstName ocrRect
    lastName:  '',            // verify — Name row appears blank in filled screenshot
  },
  addresses: [{
    addressLine1: '123 MAIN ST',
    city:         'LOS ANGELES',
    state:        'CA',
    zipCode:      '90201',
  }],
  vehicles: [{
    vin:                '5NPDH4AE1DH314535',
    year:               2013,
    make:               'HYUNDAI',
    model:              'ELANTRA GL',
    licensePlateNumber: '9QAW4567',
    licensePlateState:  'CA',
  }],
};
// ─────────────────────────────────────────────────────────────────────────────

const VIN = '5NPDH4AE1DH314535';

test.use({ viewport: { width: 1280, height: 720 } });

test('POC [II-12690] AutoSoft mock — customer search by VIN', async ({ page }) => {
  await page.goto('http://localhost:3001/');

  await init({
    page,
    storage: { root: path.join(os.homedir(), '.smart-vision/screens') },
    read: 'ocr',
    strategies: {
      charsets: {
        state: { only: ['A-Z'] },
      },
      ocr: {
        infer: { state: 'state' },
      },
      fill: Strategies.Fill.charByChar({ delay: 30 }),
    },
  });

  // ── desktop → wolf01 ──────────────────────────────────────────────────────
  const desktopScreen = await screen('desktop');
  await desktopScreen.element('kill').dblclick();
  await page.waitForTimeout(500); // mock has no 5s delay
  await desktopScreen.element('wolf01').dblclick();

  // ── wolf01 → service ──────────────────────────────────────────────────────
  const wolf01Screen = await screen('wolf01');
  await wolf01Screen.element('autosoftDmsLogo').click();

  await wolf01Screen.element('service').hover();
  await page.waitForTimeout(500);
  await wolf01Screen.element('service').click();

  // ── service → customer-info ───────────────────────────────────────────────
  const serviceScreen = await screen('service');
  await serviceScreen.element('customerInformation').click();

  // ── customer-info: fill VIN → trigger search ──────────────────────────────
  const customerInfoScreen = await screen('customer-info');
  await customerInfoScreen.element('vin').fill(VIN);
  await page.keyboard.press('Enter'); // triggers the mock's filled state

  await customerInfoScreen.refresh();

  // ── Assert ────────────────────────────────────────────────────────────────
  const result = RESULT;

  await customerInfoScreen.element('customerNumber').toHaveValue(result.customerId);

  await customerInfoScreen.element('name').part('firstName').toHaveText(result.person.firstName);
  await customerInfoScreen.element('name').part('lastName').toHaveText(result.person.lastName);

  const address = result.addresses[0];
  await customerInfoScreen.element('address').toHaveText(address.addressLine1);
  await customerInfoScreen.element('cityStateZip').part('city').toHaveText(address.city);
  await customerInfoScreen.element('cityStateZip').part('state').toHaveText(address.state);
  await customerInfoScreen.element('cityStateZip').part('zip').toHaveValue(address.zipCode);

  const vehicle = result.vehicles[0];
  await customerInfoScreen.element('vin').toHaveValue(vehicle.vin, {
    swaps: { '5': ['S'], 'S': ['5'] },
  });
  await customerInfoScreen.element('year').toHaveValue(String(vehicle.year));
  await customerInfoScreen.element('make').toHaveText(vehicle.make);
  await customerInfoScreen.element('model').part('description').toHaveText(vehicle.model);
  await customerInfoScreen.element('licenseState').part('plate').toHaveText(vehicle.licensePlateNumber, {
    swaps: { '4': ['L'], '5': ['S'] },
  });
  await customerInfoScreen.element('licenseState').part('state').toHaveValue(vehicle.licensePlateState);

  await release();
});
