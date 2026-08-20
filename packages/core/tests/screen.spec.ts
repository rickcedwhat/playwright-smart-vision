import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { configure } from '../src/configure.js';
import { releaseOcrScreen, screen } from '../src/screen.js';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const loginBlank = path.join(testsDir, 'screens', 'html-login', 'blank.png');
const loginUsername = path.join(testsDir, 'screens', 'html-login', 'templates', 'username.png');

function writeMinimalScreen(root: string, name: string, element: string) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
  fs.copyFileSync(loginBlank, path.join(dir, 'blank.png'));
  fs.copyFileSync(loginUsername, path.join(dir, 'templates', `${element}.png`));
  fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify({
    name,
    sections: [],
    elements: [{ name: element, filename: `${element}.png`, type: 'icon' }],
  })}\n`);
}

test.describe('screen()', () => {
  test('binds a named screen when configure({ page }) was called', async ({ page }) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-screen-api-'));
    const dir = path.join(tmp, 'wolf01');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify({
      name: 'wolf01',
      sections: [],
      elements: [{ name: 'service', filename: 'service.png', type: 'button' }],
    })}\n`);

    await configure({ storage: { root: tmp }, page });
    await page.goto('/');

    const wolf01 = await screen('wolf01');
    expect(wolf01.element('service')).toBeTruthy();
    await releaseOcrScreen();
  });

  test('waitFor moves the mouse to the unhover corner before screenshot', async ({ page }) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-unhover-'));
    writeMinimalScreen(tmp, 'desktop', 'kill');

    const moves: Array<{ x: number; y: number }> = [];
    const original = page.mouse.move.bind(page.mouse);
    page.mouse.move = async (x: number, y: number, options?: Parameters<typeof page.mouse.move>[2]) => {
      moves.push({ x, y });
      return original(x, y, options);
    };

    await configure({ storage: { root: tmp }, page, unhoverBeforeCapture: true });
    await page.goto('/');
    const desktop = await screen('desktop');
    await desktop.waitFor({ timeout: 1_500 }).catch(() => {});
    expect(moves.some((m) => m.x === 8 && m.y === 8)).toBe(true);
    await releaseOcrScreen();
  });

  test('unhover: false skips the mouse move', async ({ page }) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-unhover-off-'));
    writeMinimalScreen(tmp, 'desktop', 'kill');

    const moves: Array<{ x: number; y: number }> = [];
    const original = page.mouse.move.bind(page.mouse);
    page.mouse.move = async (x: number, y: number, options?: Parameters<typeof page.mouse.move>[2]) => {
      moves.push({ x, y });
      return original(x, y, options);
    };

    await configure({ storage: { root: tmp }, page, unhoverBeforeCapture: false });
    await page.goto('/');
    const desktop = await screen('desktop');
    await desktop.waitFor({ timeout: 1_500 }).catch(() => {});
    expect(moves.some((m) => m.x === 8 && m.y === 8)).toBe(false);
    await releaseOcrScreen();
  });
});
