# Template Manager Tool

Visual tool for creating UI element templates. **Export writes the files** — no copy/paste.

By default everything lands in `tests/screens/<screen-name>/`. You can point `config.ts` and the PNG images at the same folder or at different folders.

## Quick Start

```bash
npm run template-manager
```

Opens http://localhost:8000 — a hub with links to the fixture, source, and Template Manager.

- http://localhost:8000/app/login.html
- http://localhost:8000/app/customer.html
- http://localhost:8000/app/screens.html
- http://localhost:8000/app/config.html
- http://localhost:8000/template-manager.html

The hub **Last run** section can start `tests/html-login-ocr.spec.ts` headless or headed. Each run copies `video.webm` and `trace.zip` over `artifacts/html-fixture/`.

```bash
npx playwright test tests/html-login-ocr.spec.ts
npm run test:html   # same test, then copies video + trace to artifacts/ for the hub
```

1. Load a blank screenshot (and a filled one in Test).
2. For a first pass, run `node tools/detect-boxes.mjs tests/screens/<screen>` then ask the agent to follow `tools/ai-first-pass-prompt.md`. The model assigns names to detected box IDs; it does not guess coordinates.
3. Switch to **Field**, crop a control (labels are fine — matching uses them, OCR ignores unchanged pixels). Add a section only if two empty boxes cannot be told apart.
4. Use **Details** to hover the screenshot and inspect one field or section at a time.
5. Enter a screen name and click **Export Screen**.
6. To keep editing later, click the screen name tag under Export. That loads `blank.png`, fields, and sections back into the canvas. Re-export once so crop positions are stored in `manager.json` (needed for Details/Test overlays).

That creates:

```
tests/screens/autosoft-customer-information/
  config.ts
  blank.png
  templates/
    name.png
    address.png
    ...
```

## Sections

Sections are independent crops of a whole panel. Fields can optionally sit inside one.

Matching finds the section on the blank form first, then the field inside that region. Use this when several empty boxes look alike.

Generated config:

```typescript
{
  name: 'zipCode',
  template: 'zip-code.png',
  type: ElementType.FIELD,
  section: 'contact-details.png',
}
```

## Destinations

Set these in the sidebar before exporting.

| Setting | Default | Other option |
|---|---|---|
| **config.ts** | In repo (`tests/screens`) | Custom folder |
| **Images** | Same as config | Different folder |

Common setups:

- **Normal:** both in repo. Click Export.
- **Repo can’t hold PNGs:** config.ts in repo, images in a custom folder (`~/ocr-screens`, a USB drive, etc.).
- **Everything off-repo:** custom folder for config and “same as config” for images.

When images live somewhere else, the generated `config.ts` uses `screenAssetsDir()` so tests still find them via `OCR_SCREENS_DIR` or `~/.playwright-ocr-screens.json`.

```bash
export OCR_SCREENS_DIR="$HOME/ocr-screens"
```

## Naming

| What you type | What gets saved |
|---|---|
| Element `first-name-input` | `firstNameInput` |
| Screen `autosoft-customer-information` | Folder `autosoft-customer-information/` |
| Screen `autosoft-customer-information` | Export `autosoftCustomerInformationScreen` |

Template PNGs are kebab-case: `firstNameInput` → `first-name-input.png`.

## Import

Click a purple screen tag in the Export section. That reads the screen folder from disk (config + `blank.png` + templates) so you can add or recrop fields.

Export writes `manager.json` with crop coordinates. If those are missing (0×0), import locates each template on `blank.png` and writes the positions back. Leftover crops from a different screenshot stay at 0×0.

## Test mode

Switch to **Test** after a screen is imported (blank + optional `filled.png`).

- **Blank / Filled / Diff** toggles the canvas. Diff keeps filled pixels that changed and paints unchanged pixels white — the same image OCR reads.
- **Noise floor** (0–1) is how much change a pixel needs before it stays. `0.20` matches the library default (~51/255). Raise it to drop JPEG/label flicker; lower it to keep faint text.
- Each field card shows the blank crop vs the current diff crop.
- **OCR current diff** sends those diff crops through Tesseract. Each card has an **Expected** box; **Save expected values** writes `expected.json` so the Playwright test can mark OK/WRONG at each noise floor.
- **Relocate on this blank** finds each saved template on the current blank (same match the tests use) and moves the boxes. Use this after loading a new screenshot so Test/Diff cards follow the form. Templates that do not match stay put.

## Details mode

Hover the screenshot to highlight fields (blue) and sections (orange). The sidebar shows the name, crop, and section for whatever is under the cursor. Click to pin; click empty space to unpin. The full field/section lists stay collapsed under **Saved** unless you expand them.

## Other export options

- **Download ZIP** — portable copy of the screen folder. Prefer **Export Screen** so files go to the configured destinations.
- **Preview Config** — shows what would be written; does not create files.

## Using the exported screen

```typescript
import { autosoftCustomerInformationScreen } from './screens/autosoft-customer-information/config.js';

const screenshot = await formTester.captureScreen('autosoft-customer-information.png');
const results = await formTester.compareScreen(screenshot, autosoftCustomerInformationScreen);
```

## Troubleshooting

**Export is disabled**

Run `npm run template-manager` and use http://localhost:8000/template-manager.html — not a `file://` tab.

**Tests cannot find blank.png**

If images are in a custom folder, confirm `<images-dir>/<screen>/blank.png` exists, or set `OCR_SCREENS_DIR` to that parent folder.

## Walkthrough

POC for AI OCR form field testing (Autosoft Customer Information): https://www.loom.com/share/c82b907ea9a04db1bc3d4983f61ab415
