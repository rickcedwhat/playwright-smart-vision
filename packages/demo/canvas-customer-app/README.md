# Canvas Desktop Simulation Demo

A complete desktop environment simulation rendered entirely on HTML5 canvas for testing OCR and visual automation with playwright-smart-vision.

## Why Canvas Desktop?

Unlike DOM-based UIs, this simulates a real desktop environment where everything is rendered on canvas:
- **True desktop testing**: Mimics RDP sessions, VNC, remote desktop applications
- **True OCR testing**: All text must be read via OCR (just like real desktop apps)
- **Real-world workflow**: Icon → Application → Form (multi-step navigation)
- **Visual automation**: Tests template matching at every level (icons, windows, buttons, fields)

## Desktop Simulation Features

### Desktop Environment
- **Simulated desktop** with taskbar and wallpaper
- **Desktop icons** - Click "CRM System" icon to launch app
- **Window management** - Proper window chrome with title bars, controls
- **Multi-level navigation** - Desktop → CRM App → Customer Form

### CRM Application
- **Application window** with sidebar navigation
- **Customer list** table with sample data
- **"New Customer" button** - Click to open customer form
- **Window controls** - Minimize, maximize, close buttons

### Customer Form
- **Text fields**: Customer number, name, email, address, VIN, etc.
- **Multi-part fields**: Phone (area/prefix/line), birthdate (mm/dd/yyyy)
- **Checkboxes**: Active customer, do not call
- **Dropdown**: Contact method selection
- **Buttons**: Save (enable/disable state), Close
- **Keyboard support**: Type in focused fields, tab navigation
- **Form within window**: Form appears as a modal window within the desktop

## Usage

### Start the demo server

```bash
# From monorepo root
pnpm --filter @playwright-smart-vision/demo-canvas-customer serve

# Or from this directory
node server.mjs
```

The app runs at `http://localhost:3456`

### Fill test data

Click the "Fill Test Data" button to populate with known values:
- Customer: CUST12345
- Name: John Smith
- Email: john.smith@example.com
- Phone: (555) 123-4567
- Address: 123 Main Street, Springfield, IL 62701
- VIN: 1HGBH41JXMN109186
- Birthdate: 05/15/1980
- Active Customer: ✓
- Contact Method: email

### Use with playwright-smart-vision

```typescript
import { test } from '@playwright/test';
import { createFixture } from '@rickcedwhat/playwright-smart-vision';

const testWithScreen = createFixture();

test('complete desktop workflow', async ({ page, screen }) => {
  await page.goto('http://localhost:3456');
  
  // 1. Desktop screen - find and click CRM icon
  const desktop = screen('desktop');
  await desktop.waitFor();
  await desktop.element('crmIcon').click();
  
  // 2. CRM app screen - find and click "New Customer" button
  const crmApp = screen('crm-app');
  await crmApp.waitFor();
  await crmApp.element('newCustomerButton').click();
  
  // 3. Customer form screen - verify and interact with form
  const customerForm = screen('customer-form');
  await customerForm.waitFor();
  
  // Fill the form using OCR and template matching
  await customerForm.element('customerNumber').fill('CUST12345');
  await customerForm.element('firstName').fill('John');
  await customerForm.element('email').fill('john.smith@example.com');
  
  // Verify form fields
  await customerForm.element('customerNumber').toHaveValue('CUST12345');
  await customerForm.element('saveButton').toBeEnabled();
  
  // Click save
  await customerForm.element('saveButton').click();
});
```

## Testing Scenarios

This demo supports testing:
- ✅ **Multi-level navigation**: Desktop → App → Form workflow
- ✅ **Icon recognition**: Find and click desktop icons
- ✅ **Window detection**: Identify application windows and modals
- ✅ **OCR text extraction**: Read field values, labels, button text from canvas
- ✅ **Template matching**: Find buttons, checkboxes, fields, icons
- ✅ **Multi-part fields**: Phone numbers, dates with multiple inputs
- ✅ **State changes**: Button enabled/disabled, checkbox checked/unchecked
- ✅ **Form validation**: Empty vs. filled states
- ✅ **Visual regression**: Compare screenshots at different navigation states
- ✅ **Real desktop simulation**: Mimics RDP/VNC testing scenarios

## Related

- Part of [Issue #115](https://github.com/rickcedwhat/playwright-smart-vision/issues/115)
- Used for E2E tests in `packages/core/tests/`
- Replaces dependency on external test applications
