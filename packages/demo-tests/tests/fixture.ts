import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixture, init, Strategies } from '@rickcedwhat/playwright-smart-vision';

const screensRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'screens');

export const test = createFixture();
export { expect } from '@playwright/test';

test.use({
  storageRoot: screensRoot,
  ocrOverlay: true,
});

test.beforeEach(async ({ page }) => {
  await init({
    page,
    storage: { root: screensRoot },
    strategies: {
      actions: { fill: Strategies.Fill.clearAndType() },
    },
  });
});

test.setTimeout(180_000);
