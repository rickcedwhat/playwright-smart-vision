# QA Wolf skill: author a smart-vision screen

Use this when a human asks you to create OCR templates from a captured blank.

Do **not** create a product flow or capture a new blank screen. This authoring workflow uses the four files below. If either utility flow is missing, create it exactly as shown (only change `target` / `launch` to match a working flow in this repo), then run it.

- `src/flows/smart-vision-detect.flow.ts`
- `src/helpers/smart-vision-first-pass.ts` — you overwrite this with names after inspecting
- `src/flows/smart-vision-apply.flow.ts`
- `src/helpers/screens.generated.ts` — you merge typed names after apply (repo file, not a flow)

Product tests must not call an LLM.

## `src/flows/smart-vision-detect.flow.ts`

When you **start** this flow, set the run environment variable `SMART_VISION_SCREEN` to one exact folder name (same as the FAB save, e.g. `customer-info`). Do not leave it unset while authoring.

Unset `SMART_VISION_SCREEN` only for batch detection: the flow detects every folder with `blank.png`, then shows the first screen that has no `index.json`. For authoring, set `SMART_VISION_SCREEN`, inspect and apply that screen, then repeat for each remaining screen.

Look at the annotated tab (red boxes + numeric IDs). Also use the logged `boxIds`. Do not invent ids or coordinates. Do not `page.setContent` on the app page.

```ts
import fs from 'node:fs';
import { join } from 'node:path';
import { flow } from '@qawolf/flows/web';
import { configure } from '@rickcedwhat/playwright-smart-vision';
import * as author from '@rickcedwhat/playwright-smart-vision/author';

function screensRoot(): string {
  const team = process.env.TEAM_STORAGE_DIR;
  if (!team) throw new Error('TEAM_STORAGE_DIR is not set');
  return join(team, 'screens');
}

function listBlanks(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => fs.existsSync(join(root, name, 'blank.png')))
    .sort();
}

export default flow(
  'Smart vision: detect and show',
  { target: 'Web - Chrome', launch: true },
  async ({ page, test }) => {
    const root = screensRoot();
    await configure({ storage: { root }, devtools: true, page });

    const requested = process.env.SMART_VISION_SCREEN;
    const savedNames = listBlanks(root);
    if (requested && !savedNames.includes(requested)) {
      throw new Error(`screen ${requested} has no blank.png under ${root}`);
    }

    const names = requested ? [requested] : savedNames;
    if (names.length === 0) {
      throw new Error('no screens with blank.png under ' + root);
    }

    const detected = new Map<string, Awaited<ReturnType<typeof author.detectScreen>>>();
    for (const name of names) {
      await test('detect ' + name, async () => {
        detected.set(name, await author.detectScreen(name));
      });
    }

    const showName =
      requested ||
      names.find((name) => !fs.existsSync(join(root, name, 'index.json'))) ||
      names[0];

    await test('show ' + showName, async () => {
      const result = detected.get(showName);
      if (!result) {
        throw new Error('no detection result for ' + showName);
      }
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

After inspecting exactly one annotated screen, overwrite `src/helpers/smart-vision-first-pass.ts` (file write, not a flow). Replace every staging value below with the actual screen name, dimensions, observations, and detected box IDs before running apply. No `as` / `as const`.

```ts
export const screenName = 'replace-with-screen-folder';

export const firstPass = {
  screen: { name: screenName, width: 0, height: 0 },
  notes: [],
  unknowns: [],
  sections: [],
  elements: [],
};
```

The zero dimensions, empty element list, and placeholder screen name are staging values only. The apply flow rejects the placeholder name, non-positive dimensions, and an empty `elements` array; populate `elements` with assigned names and only IDs from detect before running it.

| Field | Type | Rules |
|---|---|---|
| `screen.name` | string | kebab-case, same as the folder / FAB name |
| `screen.width` / `height` | number | copy from detect |
| `notes` | `string[]` | optional observations |
| `unknowns` | `string[]` | human-readable reasons only, never coordinates. `[]` if complete |
| `sections` | `[]` | always `[]` for now |
| `elements` | array | at least one named control |
| `elements[].name` | string | camelCase |
| `elements[].type` | string | `field` \| `button` \| `checkbox` \| `radio` \| `dropdown` \| `tab` \| `label` \| `icon` \| `message` \| `other` |
| `elements[].section` | `null` | always `null` until sections are supported |
| `elements[].boxIds` | `number[]` | only ids from detect |
| `elements[].parts` | optional | `{ name, boxId }[]` for shared-label rows |

Assign, do not draw. Skip chrome. Run `smart-vision-apply` for this screen, then repeat the detect, inspect, name, and apply steps for every remaining screen.

## `src/flows/smart-vision-apply.flow.ts`

`applyScreen` is synchronous. Do not treat it as async.

```ts
import fs from 'node:fs';
import { join } from 'node:path';
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
    const root = join(team, 'screens');
    await configure({
      storage: { root },
      devtools: true,
      page,
    });

    await test('apply ' + screenName, async () => {
      const screen = firstPass.screen;
      if (
        screenName === 'replace-with-screen-folder' ||
        !screen ||
        screen.name !== screenName ||
        screen.width <= 0 ||
        screen.height <= 0 ||
        firstPass.elements.length === 0
      ) {
        throw new Error('replace the smart-vision first-pass staging values before apply');
      }

      const result = author.applyScreen(screenName, firstPass);
      const screenDir = join(root, screenName);
      if (
        result.elements.length === 0 ||
        !fs.existsSync(join(screenDir, 'index.json')) ||
        !fs.existsSync(join(screenDir, 'templates'))
      ) {
        throw new Error('smart-vision apply did not create the expected screen artifacts');
      }
      console.log(JSON.stringify(result.elements.map((el) => el.name)));
    });
  },
);
```

## Inspect / tweak (optional)

After apply, a human can open a minimal manager in a **new tab** (Guacamole stays up). It reads/writes FUSE `index.json` + template crops. Click **Save**, then **Done**.

```ts
await author.runManager(page, 'customer-info');
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
