import { test, expect } from '@playwright/test';
import { createFixture } from '../src/screen.js';

const testWithScreen = createFixture();

testWithScreen.use({
  trace: 'on',
  ocrOverlay: true,
});

testWithScreen.setTimeout(180_000);

/**
 * Canvas Desktop Demo E2E Tests
 * 
 * TODO: These tests require screen configs to be authored using Template Manager.
 * 
 * Steps to author screens:
 * 1. Start the canvas demo: `npm run demo`
 * 2. Navigate through the desktop workflow and take screenshots:
 *    - Desktop with CRM icon
 *    - CRM app with "New Customer" button
 *    - Customer form (filled state)
 * 3. Start Template Manager: `npm run tm`
 * 4. Create screen configs for each state:
 *    - screens/canvas-desktop/
 *    - screens/canvas-crm-app/
 *    - screens/canvas-customer-form/
 * 5. Uncomment and run these tests
 */

testWithScreen.skip('Desktop workflow - icon to form', async ({ page, screen }) => {
  await page.goto('http://localhost:3456');
  
  // TODO: Author desktop screen with TM
  // const desktop = screen('canvas-desktop');
  // await desktop.waitFor();
  // await desktop.element('crmIcon').click();
  
  // TODO: Author CRM app screen with TM
  // const crmApp = screen('canvas-crm-app');
  // await crmApp.waitFor();
  // await crmApp.element('newCustomerButton').click();
  
  // TODO: Author customer form screen with TM
  // const customerForm = screen('canvas-customer-form');
  // await customerForm.waitFor();
  
  // Verify desktop simulation loaded
  await expect(page.locator('canvas#desktopCanvas')).toBeVisible();
});

testWithScreen.skip('Customer form - fill and verify', async ({ page, screen }) => {
  await page.goto('http://localhost:3456');
  
  // Navigate to form using control buttons (faster for testing)
  await page.click('button:text("Open Form")');
  
  // Wait for canvas to update (give it time to render the form)
  await page.waitForTimeout(500);
  
  // TODO: Author customer form screen with TM
  // const form = screen('canvas-customer-form');
  // await form.waitFor();
  
  // Click "Fill Test Data" button to populate form
  await page.click('button:text("Fill Test Data")');
  await page.waitForTimeout(500);
  
  // TODO: Verify field values using OCR
  // await form.element('customerNumber').toHaveValue('CUST12345');
  // await form.element('firstName').toHaveValue('John');
  // await form.element('lastName').toHaveValue('Smith');
  // await form.element('email').toHaveValue('john.smith@example.com');
  // await form.element('phone').toHaveValue('555-123-4567');
  
  // TODO: Test multi-part fields
  // await form.element('phone').part('area').toHaveValue('555');
  // await form.element('phone').part('prefix').toHaveValue('123');
  // await form.element('phone').part('line').toHaveValue('4567');
  
  // TODO: Test checkboxes
  // await form.element('activeCustomer').toBeChecked();
  // await form.element('doNotCall').toBeUnchecked();
  
  // TODO: Test button states
  // await form.element('saveButton').toBeEnabled();
});

testWithScreen.skip('Canvas rendering - basic visual check', async ({ page }) => {
  await page.goto('http://localhost:3456');
  
  // Verify canvas exists and has correct dimensions
  const canvas = page.locator('canvas#desktopCanvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('width', '1200');
  await expect(canvas).toHaveAttribute('height', '800');
  
  // Test navigation controls
  await page.click('button:text("Open CRM App")');
  await page.waitForTimeout(300);
  
  await page.click('button:text("Open Form")');
  await page.waitForTimeout(300);
  
  await page.click('button:text("Reset to Desktop")');
  await page.waitForTimeout(300);
  
  // Verify we're back at desktop
  await expect(canvas).toBeVisible();
});

// This test can run without screen configs - just verifies the demo works
testWithScreen('Demo app loads and controls work', async ({ page }) => {
  await page.goto('http://localhost:3456');
  
  // Verify canvas loads
  const canvas = page.locator('canvas#desktopCanvas');
  await expect(canvas).toBeVisible();
  
  // Test control buttons exist and are clickable
  await expect(page.locator('button:text("Reset to Desktop")')).toBeVisible();
  await expect(page.locator('button:text("Open CRM App")')).toBeVisible();
  await expect(page.locator('button:text("Open Form")')).toBeVisible();
  await expect(page.locator('button:text("Fill Test Data")')).toBeVisible();
  
  // Quick navigation test
  await page.click('button:text("Open CRM App")');
  await page.waitForTimeout(200);
  
  await page.click('button:text("Open Form")');
  await page.waitForTimeout(200);
  
  await page.click('button:text("Fill Test Data")');
  await page.waitForTimeout(200);
  
  await page.click('button:text("Clear Form")');
  await page.waitForTimeout(200);
  
  // Success if no errors thrown
});
