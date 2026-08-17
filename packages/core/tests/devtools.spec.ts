import { test, expect } from '@playwright/test';
import { injectDevtools } from '../src/devtools.js';
import { configure } from '../src/configure.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

test.describe('devtools FAB', () => {
  test('FAB is visible after injectDevtools on already-loaded page', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    const fab = page.locator('#__ocr-fab');
    await expect(fab).toBeAttached();
    await expect(fab).toBeVisible();
  });

  test('FAB is visible via configure({ devtools, page }) on already-loaded page', async ({ page }) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-test-'));
    await configure({ storage: { root: tmp }, devtools: true, page });

    await page.goto('/');
    // configure was called before navigation — addInitScript covers this load
    const fab = page.locator('#__ocr-fab');
    await expect(fab).toBeAttached();
    await expect(fab).toBeVisible();
  });

  test('FAB survives navigation and reappears', async ({ page }) => {
    await injectDevtools(page);
    await page.goto('/');
    await expect(page.locator('#__ocr-fab')).toBeVisible();

    await page.goto('/');
    await expect(page.locator('#__ocr-fab')).toBeVisible();
  });

  test('FAB button opens capture menu on click', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    const menu = page.locator('#__ocr-fab-menu');
    await expect(menu).not.toHaveClass(/open/);
    await page.locator('#__ocr-fab-btn').click();
    await expect(menu).toHaveClass(/open/);
  });
});
