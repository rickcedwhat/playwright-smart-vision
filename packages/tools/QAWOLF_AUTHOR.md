# QA Wolf skill: author a smart-vision screen

Use this when a human asks you to create OCR templates from a captured blank.

Do **not** invent a new flow. If these two files are missing, write them exactly as below (only change `target` / `launch` to match a working flow in this repo). Then run them.

- `src/flows/smart-vision-detect.flow.ts`
- `src/helpers/smart-vision-first-pass.ts` — you overwrite this with names after inspecting
- `src/flows/smart-vision-apply.flow.ts`
- `src/helpers/screens.generated.ts` — you merge typed names after apply (repo file, not a flow)

Product tests must not call an LLM.

## `src/flows/smart-vision-detect.flow.ts`

Unset `SMART_VISION_SCREEN` to detect every folder with `blank.png`, then show the first screen that has no `index.json`. Set `SMART_VISION_SCREEN=customer-info` to do one folder only.

Look at the annotated tab (red boxes + numeric IDs). Also use the logged `boxIds`. Do not invent ids or coordinates. Do not `page.setContent` on the app page.

```ts
import fs from 'node:fs';
import { flow } from '@qawolf/flows/web';
import { configure } from '@rickcedwhat/playwright-smart-vision';
import * as author from '@rickcedwhat/playwright-smart-vision/author';

function screensRoot(): string {
  const team = process.env.TEAM_STORAGE_DIR;
  if (!team) throw new Error('TEAM_STORAGE_DIR is not set');
  return team + '/screens';
}

function listBlanks(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => fs.existsSync(root + '/' + name + '/blank.png'));
}

export default flow(
  'Smart vision: detect and show',
  { target: 'Web - Chrome', launch: true },
  async ({ page, test }) => {
    const root = screensRoot();
    await configure({ storage: { root }, devtools: true, page });

    const requested = process.env.SMART_VISION_SCREEN;
    const names = requested ? [requested] : listBlanks(root);
    if (names.length === 0) {
      throw new Error('no screens with blank.png under ' + root);
    }

    const detected = {};
    for (const name of names) {
      await test('detect ' + name, async () => {
        detected[name] = await author.detectScreen(name);
      });
    }

    const showName =
      requested ||
      names.find((name) => !fs.existsSync(root + '/' + name + '/index.json')) ||
      names[0];

    await test('show ' + showName, async () => {
      const result = detected[showName];
      const viewer = await author.showAnnotated(page, result.annotatedPath);
      await viewer.bringToFront();
      console.log(
        JSON.stringify(
          {
            screen: showName,
            width: result.width,
            height: result.height,
            boxIds: result.boxes.map((box) => box.id),
          },
          null,
          2,
        ),
      );
    });
  },
);
```

## Name

Overwrite `src/helpers/smart-vision-first-pass.ts` (file write, not a flow). Copy `width` / `height` from detect. No `as` / `as const`.

```ts
export const screenName = 'customer-info';

export const firstPass = {
  screen: { name: 'customer-info', width: 1280, height: 720 },
  notes: ['short observations'],
  unknowns: ['DOB field: no detected box'],
  sections: [],
  elements: [
    { name: 'lastName', type: 'field', section: null, boxIds: [12] },
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
};
```

| Field | Type | Rules |
|---|---|---|
| `screen.name` | string | kebab-case, same as the folder / FAB name |
| `screen.width` / `height` | number | copy from detect |
| `notes` | `string[]` | optional observations |
| `unknowns` | `string[]` | human-readable reasons only, never coordinates. `[]` if complete |
| `sections` | `[]` | always `[]` for now |
| `elements[].name` | string | camelCase |
| `elements[].type` | string | `field` \| `button` \| `checkbox` \| `radio` \| `dropdown` \| `tab` \| `label` \| `icon` \| `message` \| `other` |
| `elements[].section` | `null` | always `null` until sections are supported |
| `elements[].boxIds` | `number[]` | only ids from detect |
| `elements[].parts` | optional | `{ name, boxId }[]` for shared-label rows |

Assign, do not draw. Skip chrome. Then run `smart-vision-apply`.

## `src/flows/smart-vision-apply.flow.ts`

```ts
import { flow } from '@qawolf/flows/web';
import { configure } from '@rickcedwhat/playwright-smart-vision';
import * as author from '@rickcedwhat/playwright-smart-vision/author';
import { firstPass, screenName } from '../helpers/smart-vision-first-pass';

export default flow(
  'Smart vision: apply first pass',
  { target: 'Web - Chrome', launch: true },
  async ({ page, test }) => {
    const team = process.env.TEAM_STORAGE_DIR;
    if (!team) throw new Error('TEAM_STORAGE_DIR is not set');
    await configure({
      storage: { root: team + '/screens' },
      devtools: true,
      page,
    });

    await test('apply ' + screenName, async () => {
      const result = author.applyScreen(screenName, firstPass);
      console.log(JSON.stringify(result.elements.map((el) => el.name)));
    });
  },
);
```

## Catalog (not a flow)

After apply, merge `src/helpers/screens.generated.ts`. Keep other screens; add/replace only the one you just authored. No `as` / `as const`.

```ts
export type ScreenName = "customer-info";

export type ElementName<S extends ScreenName> = {
  "customer-info": "lastName" | "fullName" | "ok";
}[S];

export const screens: { [K in ScreenName]: readonly ElementName<K>[] } = {
  "customer-info": ["lastName", "fullName", "ok"],
};
```

## Tests

```ts
const screen = ocrScreen('customer-info');
await screen.element('lastName').toHaveValue('Smith');
```
