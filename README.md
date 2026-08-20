# @rickcedwhat/playwright-smart-vision

Computer-vision and OCR-based element assertions for Playwright — local, fast, no GPT Vision required.

Part of the [@rickcedwhat/playwright-smart-*](https://github.com/rickcedwhat) suite.

## Overview

`playwright-smart-vision` lets you write Playwright tests against desktop applications or any UI where direct DOM access is unavailable (RDP sessions, embedded WebViews, legacy apps). It uses OpenCV template matching to locate elements on screen and Tesseract.js to extract text — all running locally, no external API calls.

## Installation

```bash
npm install @rickcedwhat/playwright-smart-vision
```

`@playwright/test` must be installed as a peer dependency in your project.

## Quick start

**1. Define a screen config**

```ts
import { defineScreen, ElementType } from '@rickcedwhat/playwright-smart-vision';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const loginScreen = defineScreen({
  name: 'login',
  baseDir: __dirname,
  elements: [
    { name: 'username', template: 'username.png', type: ElementType.FIELD },
    { name: 'password', template: 'password.png', type: ElementType.FIELD },
    { name: 'signIn',   template: 'sign-in.png',  type: ElementType.BUTTON },
  ],
});
```

**2. Write a test**

```ts
import { test } from '@rickcedwhat/playwright-smart-vision';
import { loginScreen } from './screens/login/config.js';

test('logs in', async ({ ocrScreen }) => {
  const login = ocrScreen(loginScreen);
  await login.element('username').fill('admin');
  await login.element('password').fill('secret');
  await login.element('signIn').click();
});
```

QA Wolf flows do not get the `ocrScreen` fixture:

```ts
import { configure, screen } from '@rickcedwhat/playwright-smart-vision';

await configure({
  page,
  storage: { root: process.env.TEAM_STORAGE_DIR + '/screens' },
});
const wolf01 = await screen('wolf01');
await wolf01.element('service').click();
```

## API

### `test` / `expect`

Drop-in replacements for `@playwright/test`'s `test` and `expect`. Adds the `ocrScreen` fixture.

### `ocrScreen(config)` → `ScreenResult`

Playwright Test fixture. Returns a `ScreenResult` bound to the current page.

### `screen(name)` → `Promise<ScreenResult>`

Same bound screen for QA Wolf flows (or any runner that is not `@playwright/test`). Requires `configure({ page, storage: { root } })`. Initializes OCR/OpenCV, loads the named screen from FUSE, and binds `ScreenResult`. Call `releaseOcrScreen()` when the flow finishes.

### `screen.element(name)` → `ScreenElement`

Assertions mirror Playwright's locator API:

| Method | Description |
|---|---|
| `.toHaveValue(text)` | OCR-reads the field and asserts exact value |
| `.toHaveText(text)` | OCR-reads and asserts text (fuzzy match by default) |
| `.toBeChecked()` / `.toBeUnchecked()` | Checkbox state via template match |
| `.toHaveVariant(name)` | Button/element variant via template match |
| `.toBeVisible()` | Element is present on screen |
| `.toBeEmpty()` | Field contains no text |
| `.fill(text)` | Click and type into a field |
| `.click()` | Click the element |
| `.part(name)` | Access a sub-region of a composite field |

### `screen.waitFor()` — waits until the screen's blank template matches the current screenshot.

## Screen config reference

```ts
defineScreen({
  name: string,           // unique identifier
  baseDir: string,        // directory containing template PNGs
  elements: ElementConfig[],
})
```

`ElementConfig`:

```ts
{
  name: string,
  template?: string,                         // PNG filename relative to baseDir
  variants?: Record<string, { template: string }>, // for buttons with states
  type: ElementType,                         // FIELD | BUTTON | CHECKBOX | DROPDOWN | MESSAGE
  charset?: string,                          // OCR charset hint: 'digits' | 'email' | 'vin'
  swaps?: Record<string, string[]>,          // OCR correction map
  overflow?: 'start' | 'end',               // allow partial text match
  parts?: PartConfig[],                      // sub-regions within the element
}
```

## License

MIT
