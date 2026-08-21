import { test, expect } from '@playwright/test';
import { ScreenElement } from '../src/element.js';
import type { ElementResult } from '../src/types.js';

function makeResult(overrides?: Partial<ElementResult>): ElementResult {
  return {
    name: 'testEl',
    location: { x: 100, y: 200, width: 80, height: 40 },
    confidence: 1,
    isEmpty: false,
    ...overrides,
  };
}

test.describe('ScreenElement actions', () => {
  test('hover() moves mouse to element center', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      (window as any).__lastMouseMove = null;
      document.addEventListener('mousemove', (e) => {
        (window as any).__lastMouseMove = { x: e.clientX, y: e.clientY };
      });
    });

    const result = makeResult();
    const el = new ScreenElement(result, page);
    await el.hover();

    const pos = await page.evaluate(() => (window as any).__lastMouseMove);
    expect(pos).not.toBeNull();
    // center of { x:100, y:200, width:80, height:40 } = (140, 220)
    expect(pos.x).toBe(140);
    expect(pos.y).toBe(220);
  });

  test('dblclick() fires dblclick event at element center', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      (window as any).__dblclickPos = null;
      document.addEventListener('dblclick', (e) => {
        (window as any).__dblclickPos = { x: e.clientX, y: e.clientY };
      });
    });

    const result = makeResult();
    const el = new ScreenElement(result, page);
    await el.dblclick();

    const pos = await page.evaluate(() => (window as any).__dblclickPos);
    expect(pos).not.toBeNull();
    expect(pos.x).toBe(140);
    expect(pos.y).toBe(220);
  });

  test('hover() uses ocrLocation when present', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      (window as any).__lastMouseMove = null;
      document.addEventListener('mousemove', (e) => {
        (window as any).__lastMouseMove = { x: e.clientX, y: e.clientY };
      });
    });

    const result = makeResult({ ocrLocation: { x: 50, y: 60, width: 60, height: 20 } });
    const el = new ScreenElement(result, page);
    await el.hover();

    const pos = await page.evaluate(() => (window as any).__lastMouseMove);
    // center of ocrLocation { x:50, y:60, width:60, height:20 } = (80, 70)
    expect(pos.x).toBe(80);
    expect(pos.y).toBe(70);
  });

  test('hover() throws when no page provided', async () => {
    const el = new ScreenElement(makeResult());
    await expect(el.hover()).rejects.toThrow('Page not provided');
  });

  test('dblclick() throws when no page provided', async () => {
    const el = new ScreenElement(makeResult());
    await expect(el.dblclick()).rejects.toThrow('Page not provided');
  });
});
