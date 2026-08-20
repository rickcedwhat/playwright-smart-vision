# QA Wolf skill: author a smart-vision screen

Use this when a human asks you to create OCR templates from a captured blank.

You own **first-pass naming**. Detect and apply run in a flow. The typed catalog is a file you write in the repo after the flow. Product tests must not call an LLM; they consume the authored templates and that catalog.

You run in a **flow**, not the wolf shell.

## Package (flow vs shell)

Import from `@rickcedwhat/playwright-smart-vision` **in a flow**. Session-workspace `node_modules` and `npx` will not resolve it — that is expected. Do not `npm install`.

`flow` is **not** a smart-vision export. Import it from `@qawolf/flows/web`.

```ts
import * as author from '@rickcedwhat/playwright-smart-vision/author';
```

That namespace must include `detectScreen`, `applyScreen`, and `showAnnotated`.

## Setup

```ts
import { flow } from '@qawolf/flows/web';
import { configure, saveScreen } from '@rickcedwhat/playwright-smart-vision';
import * as author from '@rickcedwhat/playwright-smart-vision/author';

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
{TEAM_STORAGE_DIR}/screens/generated.ts                   ← after apply (all screens)
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
const detected = await author.detectScreen('customer-info');
// detected.dir            — folder on FUSE
// detected.annotatedPath  — PNG with red box IDs and gold L{id} labels
// detected.boxesPath      — boxes.json
// detected.boxes          — [{ id, x, y, width, height }, ...]
// detected.labels         — [{ id, x, y, width, height, text }, ...]
```

## Inspect the annotated PNG (required before naming)

Raw FUSE bytes are not a visual. `showAnnotated` opens the PNG in a **new tab** so the Guacamole / app page stays alive. Do not `page.setContent` on the app page.

```ts
const viewer = await author.showAnnotated(page, detected.annotatedPath);
await viewer.bringToFront();
// inspect the viewer tab's flow screenshot — red boxes + gold L{id} labels
await viewer.close();
```

Also read `detected.boxes`, `detected.labels`, and `detected.boxesPath`. Do not invent ids or coordinates. Join a control with `boxIds` plus the `labelIds` that caption it (any side).

## Loop

1. **Capture** — FAB `+` → eye, or `await saveScreen(page, 'customer-info')`. Lands at `{TEAM_STORAGE_DIR}/screens/{name}/blank.png`. Overlay on the live page needs a chosen catalog screen (FAB library).
2. **Detect** — `const detected = await author.detectScreen('customer-info')`.
3. **Inspect** — `showAnnotated` as above.
4. **Name** — you emit first-pass JSON and pass it to `author.applyScreen` (it writes `first-pass.json` for you):

```ts
await author.applyScreen('customer-info', {
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
      labelIds: [3],
    },
    {
      name: 'fullName',
      type: 'field',
      section: null,
      boxIds: [14, 15, 16],
      labelIds: [5],
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
| `sections` | optional | Dropdown glued to a value field: one `{name}Section` with **both** `boxIds`, then two elements that share that `section` (not parts). Apply uses the union as the match crop. Otherwise `[]`. |
| `elements` | array | one entry per named control |
| `elements[].name` | string | camelCase |
| `elements[].type` | string | `field` \| `button` \| `checkbox` \| `radio` \| `dropdown` \| `tab` \| `label` \| `icon` \| `message` \| `other`. Crop is the union of `boxIds` + `labelIds`. Type from the screenshot; do not assume wider = field. |
| `elements[].includeLabel` | optional boolean | Legacy left-grow when Detect missed the caption. Prefer `labelIds`. |
| `elements[].section` | string or `null` | `{row}Section` name when used; otherwise `null` |
| `elements[].boxIds` | `number[]` | **only ids from `detected.boxes`**. One or more boxes. |
| `elements[].labelIds` | `number[]` | **only ids from `detected.labels`**. Caption may be left, top, right, or below. Omit for buttons whose text is inside the box. |
| `elements[].parts` | optional | Same-kind cells of one control only (`{ name, boxId }[]`: dates, name row, phones). Never for a dropdown+field pair. Names-only parts only if Detect still merged the cells into one box. |

Rules: assign, do not draw. Skip chrome (taskbar, desktop icons, window title). Do not invent coordinates. Do not grow left by default. Do not use `as` or `as const` in authored files.

5. **Catalog** — `applyScreen` writes `{TEAM_STORAGE_DIR}/screens/generated.ts` (every applied screen, not just the one you named). After the flow, **copy that file** to `src/helpers/screens.generated.ts` in the repo with your file-write tool (overwrite the whole file). Do not invent names, do not merge by hand, do not call `writeScreenCatalog`, and do not mkdir `/app/generatedProgram`. No `as` / `as const`.

```ts
import fs from 'node:fs';
const src = process.env.TEAM_STORAGE_DIR + '/screens/generated.ts';
const dest = 'src/helpers/screens.generated.ts';
// Read `src` (FUSE). Write the same bytes to `dest` in the git repo.
```

Example shape (do not type this from memory — copy `generated.ts`):

```ts
/** Generated from screens/*/index.json. Copy to src/helpers/screens.generated.ts */
export type Screens = {
  "customer-info": {
    "fullName": { type: "field"; parts: ["firstName", "middleInitial", "lastName"] };
    "primaryContactMethod": { type: "dropdown"; section: "primaryContactSection" };
    "save": { type: "button" };
  };
};

export type ScreenName = keyof Screens;
export type ElementName<S extends ScreenName> = keyof Screens[S] & string;
export type ElementType<S extends ScreenName, E extends ElementName<S>> = Screens[S][E]["type"];
export type PartName<S extends ScreenName, E extends ElementName<S>> =
  Screens[S][E] extends { parts: readonly (infer P)[] } ? P : never;

export const screens: Screens = {
  "customer-info": {
    "fullName": { type: "field", parts: ["firstName", "middleInitial", "lastName"] },
    "primaryContactMethod": { type: "dropdown", section: "primaryContactSection" },
    "save": { type: "button" },
  },
};
```

6. Product tests only **read** FUSE. In a **QA Wolf flow** (no Playwright `ocrScreen` fixture):

```ts
import { configure, releaseOcrScreen, screen } from '@rickcedwhat/playwright-smart-vision';

await configure({
  page,
  storage: { root: process.env.TEAM_STORAGE_DIR + '/screens' },
});
const customerInfo = await screen('customer-info');
await customerInfo.element('customerNumber').toHaveValue(expected);
await releaseOcrScreen(); // optional at end of flow
```

Import from `@rickcedwhat/playwright-smart-vision` only. Do **not** import `FieldExtractor` or anything under `dist/`. Playwright Test can keep using `ocrScreen` from `@rickcedwhat/playwright-smart-vision/test`.

No LLM during assertions.
