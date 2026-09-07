import { test, expect } from '@playwright/test';
import { injectDevtools } from '../src/devtools.js';
import { configure } from '../src/configure.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

  test('FAB button stays circular', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    const box = await page.locator('#__ocr-fab-btn').boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
  });

  test('FAB click opens the speed dial, not capture', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    await page.locator('#__ocr-fab').hover();
    await expect(page.locator('#__ocr-fab-capture')).toBeVisible();
    await expect(page.locator('#__ocr-fab-record')).toBeVisible();
    await expect(page.locator('#__ocr-modal-backdrop')).toHaveCount(0);
    await expect(page.locator('#__ocr-fab-overlay')).toBeDisabled();
  });

  test('record action writes a webm next to screens', async ({ page }) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-fab-rec-'));
    const screens = path.join(tmp, 'screens');
    fs.mkdirSync(screens);

    await configure({ storage: { root: screens }, devtools: true, page });
    await page.goto('/');
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      let n = 0;
      const paint = () => {
        ctx.fillStyle = n % 2 ? '#cc0000' : '#00aa00';
        ctx.fillRect(0, 0, 320, 180);
        n += 1;
      };
      paint();
      setInterval(paint, 40);
    });
    await page.locator('#__ocr-fab').hover();
    await page.locator('#__ocr-fab-record').click();
    await expect(page.locator('#__ocr-fab')).toHaveClass(/recording/);
    await page.waitForTimeout(1000);
    await page.locator('#__ocr-fab-btn').click();

    await expect(page.locator('#__ocr-toast')).toContainText('Saved:');
    const recRoot = path.join(tmp, 'recordings');
    const dirs = fs.readdirSync(recRoot).filter((name) => name.startsWith('recording-'));
    expect(dirs.length).toBe(1);
    const webm = path.join(recRoot, dirs[0], 'recording.webm');
    expect(fs.existsSync(webm)).toBe(true);
    expect(fs.statSync(webm).size).toBeGreaterThan(100);
    const meta = JSON.parse(fs.readFileSync(path.join(recRoot, dirs[0], 'metadata.json'), 'utf8'));
    expect(meta.file).toBe('recording.webm');
  });

  test('FAB plus click opens the speed dial without hover', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    await page.locator('#__ocr-fab-btn').dispatchEvent('click');
    await expect(page.locator('#__ocr-fab-capture')).toBeVisible();
    await expect(page.locator('#__ocr-modal-backdrop')).toHaveCount(0);
  });

  test('capture action opens the modal', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    await page.locator('#__ocr-fab').hover();
    await page.locator('#__ocr-fab-capture').click();

    await expect(page.locator('#__ocr-modal-backdrop')).toBeVisible();
    await expect(page.locator('#__ocr-name-input')).toBeVisible();
  });

  test('capture modal name input accepts typing', async ({ page }) => {
    await page.goto('/');
    await injectDevtools(page);

    await page.locator('#__ocr-fab').hover();
    await page.locator('#__ocr-fab-capture').click();

    const input = page.locator('#__ocr-name-input');
    await expect(input).toBeVisible();
    await input.fill('customer-info');
    await expect(input).toHaveValue('customer-info');
  });

  test('library modal lists screens and choosing one enables overlay', async ({ page }) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-fab-'));
    fs.mkdirSync(path.join(tmp, 'alpha'));
    fs.mkdirSync(path.join(tmp, 'beta'));
    fs.writeFileSync(path.join(tmp, 'alpha', 'blank.png'), TINY_PNG);
    fs.writeFileSync(path.join(tmp, 'beta', 'blank.png'), TINY_PNG);
    fs.writeFileSync(path.join(tmp, 'beta', 'index.json'), `${JSON.stringify({
      name: 'beta',
      sections: [],
      elements: [{ name: 'ok', filename: 'ok.png', type: 'button' }],
    })}\n`);

    await configure({ storage: { root: tmp }, devtools: true, page });
    await page.goto('/');
    await page.locator('#__ocr-fab').hover();
    await page.locator('#__ocr-fab-library').click();

    await expect(page.locator('#__ocr-library-backdrop')).toBeVisible();
    await expect(page.locator('#__ocr-library-list button[data-name="alpha"]')).toBeVisible();
    await expect(page.locator('#__ocr-library-list button[data-name="beta"]')).toBeVisible();

    await page.locator('#__ocr-library-list button[data-name="beta"]').click();
    await page.locator('#__ocr-library-choose').click();

    await expect(page.locator('#__ocr-library-backdrop')).toHaveCount(0);
    await expect(page.locator('#__ocr-fab-chip')).toHaveText('beta');
    await page.locator('#__ocr-fab').hover();
    await expect(page.locator('#__ocr-fab-overlay')).toBeEnabled();
  });
});
