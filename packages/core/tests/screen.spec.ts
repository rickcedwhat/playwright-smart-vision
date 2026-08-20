import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { configure } from '../src/configure.js';
import { releaseOcrScreen, screen } from '../src/screen.js';

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
});
