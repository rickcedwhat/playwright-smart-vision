#!/usr/bin/env node
/**
 * Open demo-app with the FAB so new screens land in ./screens.
 * Usage: pnpm --filter @playwright-smart-vision/demo-tests capture
 * (demo-app must be running: pnpm demo)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { configure } from '@rickcedwhat/playwright-smart-vision/configure';

const screensRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screens');

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--window-position=0,0'],
  });

  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  await configure({
    storage: { root: screensRoot },
    devtools: true,
    page,
  });

  await page.goto('http://localhost:3456');

  console.log('Canvas demo opened with the FAB.');
  console.log(`Captures save to: ${screensRoot}`);
  console.log('Author in Template Manager: pnpm tm');
  console.log('Press Ctrl+C when done\n');

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
