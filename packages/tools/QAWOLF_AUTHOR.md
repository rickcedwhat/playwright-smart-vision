# QA Wolf skill: author a smart-vision screen

Use this when a human asks you to create OCR templates from a captured blank.

You run in a **flow**, not the wolf shell. `npx` cannot import this package here.

## Setup

```ts
import { configure, saveScreen } from '@rickcedwhat/playwright-smart-vision';
import { detectScreen, applyScreen, writeScreenCatalog } from '@rickcedwhat/playwright-smart-vision/author';

await configure({ storage: { root: process.env.TEAM_STORAGE_DIR! }, devtools: true, page });
```

`TEAM_STORAGE_DIR` is `/home/wolf/team-storage`.

## Loop

1. **Capture** — eye FAB, or `await saveScreen(page, 'customer-info')`. Lands at `{TEAM_STORAGE_DIR}/{name}/blank.png`.
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
