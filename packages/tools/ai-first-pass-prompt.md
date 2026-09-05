# AI first-pass: assign names to detected boxes

You are authoring templates for Playwright OCR. Matching finds a crop on the **blank** screenshot. OCR reads only pixels that **changed** on the filled screenshot. Labels in a crop help matching and drop out of OCR.

This is authoring only. Do not invent runtime matchers or API calls.

## Inputs

1. **blank** and one or more **filled** shots (same width and height)
2. **boxes.json** — `boxes` (controls), `labels` (OCR captions), and optionally `clusters` (adjacent same-row box groups) and box `value` fields. Each box/label has `id, x, y, width, height`. Labels also have `text`. Box `value` is the text OCR found **inside** that box on the blank screenshot (button labels, tab titles, dropdown text). A `cluster` is a list of box IDs that are spatially adjacent on the same visual row — use them to identify multi-cell fields (phone triplets, date triplets, name cells) without relying solely on labels.
3. **boxes-annotated.png** — red box IDs and gold `L{id}` label IDs on the blank
4. Optional **focus** — only assign these controls

Do not invent coordinates. Only use `boxIds` from `boxes` and `labelIds` from `labels`. If a control has no box, put it in `unknowns`.

Extra filled shots are layout variants (e.g. Individual unchecked). If a variant is missing, list it under `unknowns`.

## What to emit

Return **only** JSON:

```json
{
  "screen": { "name": "kebab-case", "width": 0, "height": 0 },
  "notes": ["short observations"],
  "unknowns": ["missing boxes or variants"],
  "sections": [],
  "elements": [
    {
      "name": "camelCase",
      "type": "field",
      "section": null,
      "boxIds": [12, 13, 14],
      "labelIds": [4],
      "parts": [
        { "name": "firstName", "boxId": 12 },
        { "name": "middleInitial", "boxId": 13 },
        { "name": "lastName", "boxId": 14 }
      ]
    }
  ]
}
```

`type` is one of: `field`, `button`, `checkbox`, `radio`, `dropdown`, `tab`, `label`, `icon`, `message`, `other`.

## Rules

1. **Assign, do not draw.** Join existing rectangles. Apply crops the **union** of `boxIds` plus `labelIds`. Labels may sit left, above, right, or below the control — pick the gold `L{id}` that captions it. Buttons with text inside the red box (shown in box `value`) usually need no `labelIds`. Do **not** assume the caption is to the left. Prefer `labelIds` over `"includeLabel": true` (legacy left-grow when Detect missed the caption).

   **Button values**: A box `value` shows what OCR read inside the box on the blank screenshot. Use it to name buttons and tabs. If a button wraps its label onto two lines, the value lists words top-to-bottom (display order), which may differ from the conventional name — use your knowledge of the application to pick the right camelCase name (e.g. `"Orders Repair"` → `repairOrders`). Values are not present for plain input fields (those are empty on the blank).

   **Clusters**: A cluster lists box IDs that are spatially adjacent on the same visual row. Use them as a hint that those boxes may form a single logical control (a multi-cell field, a button group, a tab bar — whatever fits the screen). They're geometric, not semantic: interpret each cluster in context.

2. **Dropdown glued to a field → section, not parts.** Two different controls (a list/combo and a value box) that sit on one row need a shared match region so the small one is not ambiguous. Emit a section named `{groupName}Section` with **both** `boxIds`, then **two elements** that share `"section": "thatName"`. No `parts`. Type each box from the screenshot: combo/list vs value cell. Do not assume wider = field or left = dropdown. Apply merges the members into one parent element (named `{groupName}`, stripping "Section") with named parts, so each small sub-element gets a correct relative position within the template.

   **Naming:** the section name (`{groupName}Section`) determines the parent element name. Member element names must be **short descriptive suffixes only** — do NOT prefix them with the group name. The suffix becomes the part name in the final API (`screen.{groupName}.{suffix}`).

   ```json
   { "name": "primaryContactSection", "boxIds": [34, 35] }
   { "name": "method", "type": "dropdown", "section": "primaryContactSection", "boxIds": [34], "labelIds": [23] }
   { "name": "flag", "type": "other", "section": "primaryContactSection", "boxIds": [35] }
   { "name": "warrantyRepairSection", "boxIds": [57, 58] }
   { "name": "type", "type": "dropdown", "section": "warrantyRepairSection", "boxIds": [57] }
   { "name": "code", "type": "field", "section": "warrantyRepairSection", "boxIds": [58] }
   ```

3. **Parts are only same-kind cells of one control.** Detect may emit one box per cell (mm / dd / yy, first / MI / last, phone segments). That is one element, several `boxIds`, `parts` with a `boxId` for each cell. Do not invent coordinates. Do not use parts for a dropdown+field pair.

   ```json
   { "name": "inService", "type": "field", "boxIds": [58, 59, 60], "labelIds": [20], "parts": [
     { "name": "month", "boxId": 58 }, { "name": "day", "boxId": 59 }, { "name": "year", "boxId": 60 }
   ]}
   ```

   Names-only parts (no `boxId`) only if Detect still left **one** merged box. Apply then finds inner cells from the blank.

4. **Shared-label rows** (Name, City/State, phones): same as rule 3 — one element, several `boxIds`, one shared `labelIds` entry, `parts` with a `boxId` for each inner box.

5. **Look at filled shots** to see which boxes received values. Crops still come from the blank.

6. **Skip OS chrome:** desktop icons, browser tabs, the OS window title bar. Keep in-window controls — footer buttons, a close X the human drew, and other app buttons.

7. **Names** are camelCase. Screen folder names stay kebab-case.

8. Skip a box you cannot read. Do not reuse IDs from a previous screenshot.

## After you write the file

Write `first-pass.json` next to `boxes.json` (under `~/.smart-vision/screens/{name}/`). TM applies automatically when that file is newer than `index.json`, including on Reload. Tell the user to Reload in TM. Do not tell them to Apply.
