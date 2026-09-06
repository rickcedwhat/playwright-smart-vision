# Demo tests

Consumer-style Playwright project for [`demo-app`](../demo-app). Template Manager screens live in `./screens`.

```bash
# From repo root
pnpm demo                                          # canvas app at :3456
pnpm tm                                            # TM against ./screens
pnpm --filter @playwright-smart-vision/demo-tests test:e2e
pnpm --filter @playwright-smart-vision/demo-tests capture
```

`SMART_VISION_SCREENS` is set to this package's `screens/` folder when you run `pnpm tm`.
