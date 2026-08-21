---
name: review-psv
description: >-
  Playwright Smart Vision review checklist. Use with Bugbot (/review-bugbot)
  before marking a PSV PR ready, or when reviewing PSV diffs for OCR, TM, FUSE,
  clipboard, or authoring issues.
---

# Review PSV (playwright-smart-vision)

After implementing or before opening/merging a PR in this repo:

1. Run typecheck + relevant unit/e2e tests.
2. Run `/review-bugbot` on **branch changes** (default).
3. Run `/review-security` if the diff touches auth, storage, clipboard, GCS, network, or dependencies.
4. Fix clear Bugbot findings; leave intentional trade-offs noted in the PR.

## Domain checklist (pass Custom Instructions to Bugbot when useful)

- No `dist/` or deep imports in QA Wolf / public API examples — package root or documented subpaths only.
- `configure({ page, storage })` + `screen(name)` for flows; `ocrScreen` fixture for Playwright Test.
- Live capture path: unhover default (`unhoverBeforeCapture`) unless intentionally opted out.
- Authoring: `applyScreen` must preserve or round-trip `charset`, `swaps`, `read`, `overflow` — do not wipe TM-authored options on re-apply.
- FUSE/runtime layout: `{root}/{screen}/blank.png`, `index.json`, `templates/`; push must not delete remote objects.
- Clipboard `read: "clipboard"` needs page + clipboard permissions; document Guacamole caveats.
- Errors should distinguish “not located” vs “OCR empty string” when possible.
- TM v2 lives at `/template-manager` on the hub (port 2020), not a separate 2021 server.

## Bugbot prompt addition

When launching Bugbot for this repo, prefer Custom Instructions:

```text
Apply the review-psv skill checklist. Focus on regressions in OCR/read options persistence, screen() API, and TM v2 authoring.
```
