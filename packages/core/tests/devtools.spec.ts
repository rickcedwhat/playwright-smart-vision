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

    await expect(page.locator('#__ocr-fab')).toBeVisible();
  });

  test('FAB is visible via configure({ devtools, page }) after navigation', async ({ page }) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-test-'));
    await configure({ storage: { root: tmp }, devtools: true, page });

    await page.goto('/');
    await expect(page.locator('#__ocr-fab')).toBeVisible();
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

    await page.locator('#__ocr-fab-btn').click();
    await expect(page.locator('#__ocr-fab-menu')).toHaveClass(/open/);
  });

  test('Capture Screen menu item is hit-testable above the FAB button', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    await page.locator('#__ocr-fab-btn').click();
    const menu = page.locator('#__ocr-fab-menu');
    await expect(menu).toHaveClass(/open/);

    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('#__ocr-fab-menu')?.id ?? el?.id ?? null;
    }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
    expect(hit).toBe('__ocr-fab-menu');
  });

  test('FAB button stays circular', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    const box = await page.locator('#__ocr-fab-btn').boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
  });

  test('capture screen opens modal', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    await page.locator('#__ocr-fab-btn').click();
    await page.locator('#__ocr-capture-btn').click();

    await expect(page.locator('#__ocr-modal-backdrop')).toBeVisible();
    await expect(page.locator('#__ocr-name-input')).toBeVisible();
  });

  test('capture modal name input accepts typing', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    await page.locator('#__ocr-fab-btn').click();
    await page.locator('#__ocr-capture-btn').click();

    const input = page.locator('#__ocr-name-input');
    await expect(input).toBeVisible();
    await input.fill('customer-info');
    await expect(input).toHaveValue('customer-info');
  });
});
