# QA Wolf skill: author a smart-vision screen

Use this when a human asks you to create OCR templates from a captured blank.

You run in a **flow**, not the wolf shell. `npx` cannot import this package here.

## Setup

```ts
import { configure, saveScreen } from '@rickcedwhat/playwright-smart-vision';
import { detectScreen, applyScreen, writeScreenCatalog } from '@rickcedwhat/playwright-smart-vision/author';

await configure({
  storage: { root: process.env.TEAM_STORAGE_DIR + '/screens' },
  devtools: true,
  page,
});
```

## Find screens

Root is always `process.env.TEAM_STORAGE_DIR + '/screens'` (same as `configure`). Each screen is a folder:

```text
{TEAM_STORAGE_DIR}/screens/{name}/blank.png
{TEAM_STORAGE_DIR}/screens/{name}/boxes.json              ← after detect
{TEAM_STORAGE_DIR}/screens/{name}/boxes-annotated.png     ← after detect (look at this)
{TEAM_STORAGE_DIR}/screens/{name}/first-pass.json         ← after you name boxes
{TEAM_STORAGE_DIR}/screens/{name}/index.json              ← after apply
{TEAM_STORAGE_DIR}/screens/{name}/templates/*.png
```

`{name}` is the FAB save name / `saveScreen` argument (`customer-info`).

To see what is already captured, **in a flow** (FUSE is not in the wolf shell unless you pass the absolute path):

```ts
import fs from 'node:fs';
const root = process.env.TEAM_STORAGE_DIR + '/screens';
const names = fs.readdirSync(root).filter((n) =>
  fs.existsSync(root + '/' + n + '/blank.png')
);
console.log(names);
```

After `detectScreen(name)`, do not guess paths. Use the return value:

```ts
const detected = await detectScreen('customer-info');
// detected.dir            — folder on FUSE
// detected.annotatedPath  — PNG with box IDs; read/view this
// detected.boxesPath      — boxes.json
// detected.boxes          — [{ id, x, y, width, height }, ...]
```

Read `detected.annotatedPath` (and `detected.boxesPath` if needed) before naming.

## Loop

1. **Capture** — eye FAB, or `await saveScreen(page, 'customer-info')`. Lands at `{TEAM_STORAGE_DIR}/screens/{name}/blank.png`.
2. **Detect** — `const detected = await detectScreen('customer-info')`. Writes `boxes.json` and `boxes-annotated.png`. Do not invent coordinates.
3. **Name** — look at `boxes-annotated.png` (and `boxes.json`). Write `first-pass.json` **or** pass the object to apply:

```ts
await applyScreen('customer-info', {
  screen: { name: 'customer-info', width: detected.width, height: detected.height },
  notes: [],
  unknowns: [], // controls with no box
  sections: [],
  elements: [
    { name: 'lastName', type: 'field', boxIds: [12] },
    { name: 'ok', type: 'button', boxIds: [20] },
  ],
});
```

Rules: camelCase names; only existing `boxIds`; skip chrome (taskbar, icons); shared-label rows use one element + `parts: [{ name, boxId }]`.

4. **Catalog** — typed helper for test authors:

```ts
writeScreenCatalog('src/helpers/screens.generated.ts');
```

5. Product tests only **read** FUSE:

```ts
const screen = ocrScreen('customer-info');
await screen.element('lastName').toHaveValue('Smith');
```

No LLM during assertions.
