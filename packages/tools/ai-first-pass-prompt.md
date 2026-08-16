# AI first-pass: assign names to detected boxes

You are authoring templates for Playwright OCR. Matching finds a crop on the **blank** screenshot. OCR reads only pixels that **changed** on the filled screenshot. Labels in a crop help matching and drop out of OCR.

This is authoring only. Do not invent runtime matchers or API calls.

## Inputs

1. **blank** and one or more **filled** shots (same width and height)
2. **boxes.json** — rectangles from `tools/detect-boxes.mjs` (OpenCV). Each has `id, x, y, width, height`
3. **boxes-annotated.png** — the blank with those IDs drawn on it
4. Optional **focus** — only assign these controls

Do not invent coordinates. Only use `boxIds` from `boxes.json`. If a control has no box, put it in `unknowns`.

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

1. **Assign, do not draw.** Every element is one or more detected boxes. The apply step builds the match crop (boxes + label to the left) and insets `parts` inside each box (no border).

2. **Fields first. Sections only if two assignments would still be interchangeable** after each includes its label. Usually `sections` is `[]`.

3. **Shared-label rows** (Name, City/State, phones): one element, several `boxIds`, `parts` for each inner box.

4. **Split at the assertion boundary.** If tests need first / middle / last, emit those `parts`.

5. **Look at filled shots** to see which boxes received values. Crops still come from the blank.

6. **Skip chrome:** browser tabs, desktop icons, window title, footer buttons unless asked.

7. **Names** are camelCase. Screen folder names stay kebab-case.

8. Skip a box you cannot read. Do not reuse IDs from a previous screenshot.
