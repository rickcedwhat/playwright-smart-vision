# @rickcedwhat/playwright-smart-vision

Computer-vision and OCR-based element assertions for Playwright — local, fast, no GPT Vision required.

## Overview

`playwright-smart-vision` lets you write Playwright tests against applications where DOM access is unavailable or unreliable:

- 🖥️ **Desktop applications** (Electron, native apps via RDP/VNC)
- 🌐 **Remote sessions** (Citrix, RDP, VNC, browser-in-browser)
- 📱 **Embedded WebViews** where standard locators fail
- 🎨 **Canvas-rendered UIs** (games, drawing apps, custom widgets)
- 🏢 **Legacy applications** without modern web APIs

Uses **OpenCV** for template matching and **Tesseract.js** for OCR — all running locally with no external API calls or cloud dependencies.

## Features

✅ **Visual element location** - Find buttons, fields, and UI elements via template matching  
✅ **OCR text extraction** - Read field values, labels, and messages  
✅ **Intelligent interactions** - Click, fill, and verify without DOM access  
✅ **Playwright-native API** - Familiar `.toHaveText()`, `.fill()`, `.click()` patterns  
✅ **Local-first** - No GPT Vision, no cloud APIs, runs completely offline  
✅ **Template Manager** - Visual authoring tool for creating screen configs  

## Installation

```bash
npm install @rickcedwhat/playwright-smart-vision
```

`@playwright/test` is required as a peer dependency.

## Quick Start

### 1. Create a screen config

Screen configs define the UI elements you want to interact with. You can create these manually or use the Template Manager tool (see below).

```ts
// screens/login.config.ts
import { defineScreen, ElementType } from '@rickcedwhat/playwright-smart-vision';

export const loginScreen = defineScreen({
  name: 'login',
  blankScreen: './login/blank.png',      // Full screenshot of the screen
  elements: [
    { 
      name: 'username', 
      template: './login/templates/username.png',  // Cropped image of just this field
      type: ElementType.FIELD 
    },
    { 
      name: 'password', 
      template: './login/templates/password.png',
      type: ElementType.FIELD 
    },
    { 
      name: 'signIn', 
      template: './login/templates/sign-in-btn.png',
      type: ElementType.BUTTON 
    },
  ],
});
```

### 2. Write tests using the fixture

```ts
import { test } from '@playwright/test';
import { createFixture } from '@rickcedwhat/playwright-smart-vision';
import { loginScreen } from './screens/login.config.js';

const testWithScreen = createFixture();

testWithScreen('user can log in', async ({ page, screen }) => {
  await page.goto('https://your-app.com/login');
  
  const login = screen(loginScreen);
  
  // Wait for screen to be visible
  await login.waitFor();
  
  // Fill form fields using OCR and template matching
  await login.element('username').fill('admin@example.com');
  await login.element('password').fill('securePassword123');
  
  // Click the sign-in button
  await login.element('signIn').click();
  
  // Verify we landed on the dashboard
  const dashboard = screen(dashboardScreen);
  await dashboard.waitFor();
  await dashboard.element('welcomeMessage').toHaveText('Welcome back!');
});
```

## Template Manager

The Template Manager is a visual authoring tool that helps you create screen configs by:

1. Loading a screenshot of your application
2. Drawing boxes around UI elements
3. Configuring element properties (type, OCR settings)
4. Exporting ready-to-use screen configs

### Running Template Manager

```bash
# From your project root
npm run tm:v2

# Or use npx
npx @rickcedwhat/playwright-smart-vision tm:v2
```

Open `http://localhost:3455` in your browser and follow the visual workflow to author your screens.

### Template Manager Features

- 📸 **Visual element selection** - Draw boxes around buttons, fields, checkboxes
- 🎯 **OCR preview** - See what text Tesseract extracts in real-time
- ⚙️ **Element configuration** - Set types, charsets, OCR corrections
- 📦 **Auto-export** - Generates `index.json` and template PNGs
- 🔄 **Local storage** - All screens stored in your project directory

## Storage-Based Workflow

For projects with many screens, use the storage-based workflow:

```ts
// Configure storage once
import { configure } from '@rickcedwhat/playwright-smart-vision';

await configure({
  storage: { root: './screens' },  // Directory containing your screen folders
});

// Load screens by name
import { test } from '@playwright/test';
import { createFixture } from '@rickcedwhat/playwright-smart-vision';

const testWithScreen = createFixture();

testWithScreen('verify customer form', async ({ page, screen }) => {
  await page.goto('http://localhost:3456');
  
  // Loads ./screens/customer-form/index.json + templates
  const form = screen('customer-form');
  await form.waitFor();
  
  await form.element('firstName').toHaveText('John');
  await form.element('email').toHaveText('john.smith@example.com');
});
```

### Storage Structure

```
screens/
├── customer-form/
│   ├── index.json          # Element definitions
│   ├── blank.png           # Full screen template
│   └── templates/
│       ├── firstName.png
│       ├── lastName.png
│       └── email.png
├── login/
│   ├── index.json
│   ├── blank.png
│   └── templates/
│       ├── username.png
│       └── password.png
└── generated.ts            # Optional: typed catalog (see below)
```

## Non-Fixture Usage (init/screen API)

For non-Playwright-Test runners or projects that can't use fixtures:

```ts
import { init, screen, release } from '@rickcedwhat/playwright-smart-vision';

// Initialize once
await init({
  page,
  storage: { root: './screens' },
  devtools: true,  // Optional: show overlay
});

// Use screens synchronously
const login = await screen('login');
await login.element('username').fill('admin');
await login.element('password').fill('secret');
await login.element('signIn').click();

// Cleanup when done
await release();
```

## API Reference

### Screen Result

| Method | Description |
|--------|-------------|
| `.waitFor()` | Wait for screen to appear (matches blank template) |
| `.element(name)` | Get a specific element for interaction/assertion |
| `.refresh()` | Force a new screenshot capture |

### Element Assertions

| Method | Description |
|--------|-------------|
| `.toHaveValue(text)` | Field contains exact text (after OCR) |
| `.toHaveText(text)` | Element contains text (fuzzy match by default) |
| `.toBeChecked()` | Checkbox is checked (via template match) |
| `.toBeUnchecked()` | Checkbox is not checked |
| `.toBeVisible()` | Element template found on screen |
| `.toBeEmpty()` | Field contains no text |
| `.toBeEnabled()` | Button matches enabled variant template |
| `.toBeDisabled()` | Button matches disabled variant template |

### Element Actions

| Method | Description |
|--------|-------------|
| `.fill(text)` | Click field and type text |
| `.click()` | Click element center point |
| `.hover()` | Move mouse to element |
| `.dblclick()` | Double-click element |

### Multi-part Fields

For fields split into multiple inputs (phone numbers, dates):

```ts
const phone = form.element('phone');
await phone.part('area').fill('555');
await phone.part('prefix').fill('123');
await phone.part('line').fill('4567');
```

### Configuration

```ts
await configure({
  storage: { root: './screens' },
  devtools: true,                    // Show visual overlay
  unhoverBeforeCapture: true,        // Move mouse before screenshots (default: true)
  unhoverPoint: { x: 10, y: 10 },   // Custom unhover location
});
```

## Element Types

```ts
enum ElementType {
  FIELD,      // Text input, textarea
  BUTTON,     // Clickable button
  CHECKBOX,   // Checkbox or toggle
  DROPDOWN,   // Select/dropdown
  MESSAGE,    // Read-only text, labels
}
```

## OCR Configuration

### Charsets

Constrain OCR to specific character sets for better accuracy:

```ts
{
  name: 'customerNumber',
  template: 'cust-num.png',
  type: ElementType.FIELD,
  charset: 'CUST0123456789',  // Only uppercase CUST and digits
}
```

**Built-in charsets:**
- `digits`: `0123456789`
- `email`: Alphanumeric + `@._-+`
- `vin`: Vehicle Identification Number characters

### OCR Corrections (swaps)

Fix common OCR mistakes:

```ts
{
  name: 'status',
  template: 'status.png',
  type: ElementType.MESSAGE,
  swaps: {
    'Active': ['Act1ve', 'Actlve'],      // Map OCR errors to correct value
    'Inactive': ['lnactive', '!nactive'],
  }
}
```

### Overflow Handling

For fields where text may be truncated:

```ts
{
  name: 'address',
  template: 'address.png',
  type: ElementType.FIELD,
  overflow: 'end',  // Match start of text even if end is cut off
}
```

## Button Variants

Define multiple states for buttons:

```ts
{
  name: 'saveButton',
  type: ElementType.BUTTON,
  variants: {
    enabled: { template: 'save-enabled.png' },
    disabled: { template: 'save-disabled.png' },
  }
}

// Test specific states
await form.element('saveButton').toBeEnabled();
await form.element('saveButton').toBeDisabled();
```

## Demo Application

The repo includes a canvas-based customer form demo for testing:

```bash
# Start demo app
npm run demo

# App runs at http://localhost:3456
```

This demo renders a complete customer form on HTML5 canvas, perfect for testing OCR and visual automation without needing an actual desktop application.

## Development Tools

### Template Manager v2

Visual authoring tool for creating screen configs:

```bash
npm run tm:v2  # http://localhost:3455
```

### Serve Test Fixtures

Run the test HTML fixtures:

```bash
npm run dev:fixtures  # http://localhost:3457
```

### Debugging

Enable visual overlay to see what's being matched:

```ts
testWithScreen.use({ ocrOverlay: true });
```

Set `OCR_DEBUG=1` to see detailed OCR output in console.

## Advanced Features

### Custom Strategies

Override default behaviors:

```ts
await init({
  page,
  strategies: {
    ocr: {
      defaultCharset: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      swaps: {
        'O': ['0'],  // Global correction: OCR "0" → letter "O"
      },
    },
    actions: {
      fill: async (element, text) => {
        // Custom fill logic
        await element.click();
        await page.keyboard.type(text);
      },
    },
  },
});
```

### Generated Catalog

Generate a typed TypeScript catalog of all screens:

```ts
// After authoring screens with TM, generate catalog:
import { writeScreenCatalog } from '@rickcedwhat/playwright-smart-vision/author';

writeScreenCatalog('./screens/generated.ts');

// Use typed screens:
import { screens } from './screens/generated.js';

const login = screen(screens.login);
await login.element('username').fill('admin');  // Fully typed!
```

## Troubleshooting

### Template not found

- Ensure `storage.root` is configured correctly
- Check that template PNGs exist in the right directory
- Verify screen folder name matches the name in `screen('name')`

### OCR reading wrong text

- Use `charset` to constrain character set
- Add `swaps` to fix common misreadings
- Ensure template image is clear and high-contrast
- Check that text isn't being cropped (use `overflow`)

### Template matching fails

- Capture template at same resolution as test screenshots
- Avoid templates that include dynamic content
- Use section templates for context when element appearance varies
- Consider using `variants` for different states

### Mouse hover breaks matching

- Default `unhoverBeforeCapture: true` should handle this
- If top-left corner has hover effects, set custom `unhoverPoint`

## Architecture

```
┌─────────────────┐
│  Playwright     │
│   Test          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────┐
│  ScreenResult   │─────▶│  Template    │
│                 │      │  Matching    │
└────────┬────────┘      │  (OpenCV)    │
         │               └──────────────┘
         ▼
┌─────────────────┐      ┌──────────────┐
│ FieldExtractor  │─────▶│     OCR      │
│                 │      │ (Tesseract)  │
└─────────────────┘      └──────────────┘
```

## Contributing

Contributions welcome! This library is being generalized from internal QA Wolf tools.

Current focus areas:
- Improving OCR accuracy
- Adding more element types
- Better Template Manager UX
- Documentation and examples

## License

MIT

## Related Projects

Part of the [@rickcedwhat/playwright-smart-*](https://github.com/rickcedwhat) suite for advanced Playwright testing scenarios.
