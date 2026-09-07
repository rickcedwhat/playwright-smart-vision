# Demo tests

Consumer-style Playwright project for [`demo-app`](../demo-app). Template Manager screens live in `./screens`.

```bash
# From repo root
pnpm demo                                          # canvas app at :3456
pnpm tm                                            # TM against ./screens
pnpm --filter @playwright-smart-vision/demo-tests test:e2e
pnpm capture                                           # demo + FAB (starts demo-app if needed)
```

`SMART_VISION_SCREENS` is set to this package's `screens/` folder when you run `pnpm tm`.

## About Committing Screens

**This demo commits `screens/` to git** because:
- ✅ Tests work immediately after cloning (no setup required)
- ✅ Shows users what authored screens look like  
- ✅ CI/CD ready out of the box

**For your own projects**, consider the tradeoffs:

| Approach | Pros | Cons |
|----------|------|------|
| **Commit screens** | Reproducible tests, works in CI, version controlled | Binary PNGs in git, noisy diffs when UI changes |
| **Gitignore screens** | Cleaner repo, smaller PRs | Requires authoring step before tests run, not reproducible |

**Recommended gitignore** if you choose not to commit:
```gitignore
# Authored screen artifacts (re-generate with TM)
**/screens/**/templates/*.png
**/screens/**/blank.png  
**/screens/**/boxes*.png
**/screens/**/first-pass.json

# Keep these - they're your element definitions
# **/screens/**/index.json
# **/screens/generated.ts
```
