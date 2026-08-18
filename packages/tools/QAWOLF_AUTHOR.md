# QA Wolf skill: author a smart-vision screen

Use this when a human asks you to create OCR templates from a captured blank.

You own **first-pass naming**. Detect, apply, and catalog are library calls. Product tests must not call an LLM; they consume the authored templates and generated catalog.

You run in a **flow**, not the wolf shell.

## Package (flow vs shell)

The **flow runner** installs whatever `package.json` pins (`@rickcedwhat/playwright-smart-vision`). Session-workspace `node_modules` and `npx` will not have this package — that is expected. Do not `npm install`. A shell `ERR_MODULE_NOT_FOUND` is not a package bug.

`flow` is **not** a smart-vision export. Import it from `@qawolf/flows/web`.

Validate `/author` **in a flow**:

```ts
import * as author from '@rickcedwhat/playwright-smart-vision/author';
console.log(Object.keys(author).sort());
// expect: applyScreen, detectScreen, showAnnotated, writeScreenCatalog, screenCatalogSource
```

If that import fails in a flow, the pin is wrong or the runner did not install. If `showAnnotated` is missing, render `detected.annotatedPath` on the current page as a fallback.

## Setup

```ts
import { flow } from '@qawolf/flows/web';
import { configure, saveScreen } from '@rickcedwhat/playwright-smart-vision';
import {
  detectScreen,
  applyScreen,
  writeScreenCatalog,
  showAnnotated,
} from '@rickcedwhat/playwright-smart-vision/author';

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
{TEAM_STORAGE_DIR}/screens/{name}/boxes-annotated.png     ← after detect
{TEAM_STORAGE_DIR}/screens/{name}/first-pass.json         ← after you name boxes
{TEAM_STORAGE_DIR}/screens/{name}/index.json              ← after apply
{TEAM_STORAGE_DIR}/screens/{name}/templates/*.png
```

`{name}` is the FAB save name / `saveScreen` argument (`customer-info`).

To see what is already captured, **in a flow**:

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
// detected.annotatedPath  — PNG with box IDs drawn on the blank
// detected.boxesPath      — boxes.json
// detected.boxes          — [{ id, x, y, width, height }, ...]
```

## Inspect the annotated PNG (required before naming)

Raw FUSE bytes are not a visual. `showAnnotated` opens the PNG in a **new tab** (the Guacamole / app page stays alive). Look at that tab’s flow screenshot, then close it:

```ts
const viewer = await showAnnotated(page, detected.annotatedPath);
// look at the current page screenshot — red boxes + numeric IDs
await viewer.close();
```

Also read `detected.boxes` / `detected.boxesPath` for the id list. Do not invent ids or coordinates.

## Loop

1. **Capture** — eye FAB, or `await saveScreen(page, 'customer-info')`. Lands at `{TEAM_STORAGE_DIR}/screens/{name}/blank.png`.
2. **Detect** — `const detected = await detectScreen('customer-info')`.
3. **Inspect** — `showAnnotated` as above.
4. **Name** — you emit first-pass JSON and pass it to `applyScreen` (it writes `first-pass.json` for you):

```ts
await applyScreen('customer-info', {
  screen: { name: 'customer-info', width: detected.width, height: detected.height },
  notes: ['short observations'],
  unknowns: [
    'DOB field: no detected box',
  ],
  sections: [],
  elements: [
    {
      name: 'lastName',
      type: 'field',
      section: null,
      boxIds: [12],
    },
    {
      name: 'fullName',
      type: 'field',
      section: null,
      boxIds: [14, 15, 16],
      parts: [
        { name: 'firstName', boxId: 14 },
        { name: 'middleInitial', boxId: 15 },
        { name: 'lastName', boxId: 16 },
      ],
    },
    { name: 'ok', type: 'button', section: null, boxIds: [20] },
  ],
});
```

### First-pass shape

| Field | Type | Rules |
|---|---|---|
| `screen.name` | string | kebab-case, same as the folder / FAB name |
| `screen.width` / `height` | number | copy from `detected.width` / `detected.height` |
| `notes` | `string[]` | optional observations |
| `unknowns` | `string[]` | **human-readable reasons only.** A control with no box, a missing layout variant, or a box you cannot read. Never put coordinates here. Example: `"phone extension: no box"`. Use `[]` if everything was assigned. |
| `sections` | `[]` | **Always `[]` for now.** `applyScreen` ignores this. Do not invent section crops. Only revisit if two fields are still interchangeable after including their labels. |
| `elements` | array | one entry per named control |
| `elements[].name` | string | camelCase |
| `elements[].type` | string | `field` \| `button` \| `checkbox` \| `radio` \| `dropdown` \| `tab` \| `label` \| `icon` \| `message` \| `other` |
| `elements[].section` | `null` | always `null` until sections are supported |
| `elements[].boxIds` | `number[]` | **only ids from `detected.boxes`**. One or more boxes. |
| `elements[].parts` | optional | shared-label rows: `{ name: camelCase, boxId: number }[]` matching ids in `boxIds` |

Rules: assign, do not draw. Skip chrome (taskbar, desktop icons, window title). Do not invent coordinates.

5. **Catalog** — the flow runtime can write FUSE, not the git workspace (`/app/generatedProgram`). **Do not** call `writeScreenCatalog('src/helpers/screens.generated.ts')` from a flow (ENOENT). In the flow:

```ts
const source = writeScreenCatalog();
console.log(source);
// also on FUSE: {TEAM_STORAGE_DIR}/screens/screens.generated.ts
```

After the flow, as a workspace file write (not a flow), copy that source to `src/helpers/screens.generated.ts`. Prefer the FUSE file if the log is truncated.

6. Product tests only **read** FUSE:

```ts
const screen = ocrScreen('customer-info');
await screen.element('lastName').toHaveValue('Smith');
```

No LLM during assertions.
