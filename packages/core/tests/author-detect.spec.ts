import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configure } from '../src/configure.js';
import { detectScreen, writeBoxes } from '../src/author/detect.js';
import { showAnnotated } from '../src/author/show.js';

const fixtureBlank = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'screens/html-login/blank.png',
);

test('detectScreen writes boxes.json and boxes-annotated.png', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-detect-'));
  const name = 'html-login';
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.copyFileSync(fixtureBlank, path.join(root, name, 'blank.png'));
  await configure({ storage: { root } });

  const result = await detectScreen(name);
  expect(fs.existsSync(result.boxesPath)).toBe(true);
  expect(fs.existsSync(result.annotatedPath)).toBe(true);
  expect(result.boxes.length).toBeGreaterThan(0);
  expect(Array.isArray(result.labels)).toBe(true);
  expect(result.width).toBeGreaterThan(0);
  const saved = JSON.parse(fs.readFileSync(result.boxesPath, 'utf8'));
  expect(saved.labels).toEqual(result.labels);
});

test('writeBoxes keeps given ids and does not re-run detect', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-write-boxes-'));
  const name = 'html-login';
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.copyFileSync(fixtureBlank, path.join(root, name, 'blank.png'));
  await configure({ storage: { root } });

  const result = await writeBoxes(name, [
    { id: 7, x: 10, y: 12, width: 40, height: 18 },
    { id: 3, x: 80, y: 12, width: 40, height: 18 },
  ]);
  expect(result.boxes.map((box) => box.id)).toEqual([3, 7]);
  const saved = JSON.parse(fs.readFileSync(result.boxesPath, 'utf8'));
  expect(saved.boxes.map((box) => box.id)).toEqual([3, 7]);
  expect(fs.existsSync(result.annotatedPath)).toBe(true);
});

test('showAnnotated puts the PNG on the page', async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-detect-'));
  const name = 'html-login';
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.copyFileSync(fixtureBlank, path.join(root, name, 'blank.png'));
  await configure({ storage: { root } });
  const result = await detectScreen(name);

  const viewer = await showAnnotated(page, result.annotatedPath);
  await expect(viewer.locator('img[alt="annotated boxes"]')).toBeVisible();
  expect(viewer).not.toBe(page);
  await viewer.close();
});
