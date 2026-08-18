import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configure } from '../src/configure.js';
import { detectScreen } from '../src/author/detect.js';

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
  expect(result.width).toBeGreaterThan(0);
});
