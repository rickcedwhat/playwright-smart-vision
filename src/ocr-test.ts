import { test as base } from '@playwright/test';
import fs from 'node:fs';
import { FieldExtractor } from './field-extractor.js';
import { ScreenResult } from './screen-result.js';
import type { ScreenConfig } from './screen-config.js';
import { getOCRUtil, cleanupOCR } from './utils/ocr.js';

export type OcrScreen = (screen: ScreenConfig) => ScreenResult;

export const test = base.extend<{ ocrScreen: OcrScreen; ocrOverlay: boolean }, { ocrReady: void }>({
  ocrReady: [async ({}, use) => {
    await getOCRUtil();
    await use();
    await cleanupOCR();
  }, { scope: 'worker' }],

  ocrOverlay: [false, { option: true }],

  ocrScreen: async ({ page, ocrReady, ocrOverlay }, use, testInfo) => {
    void ocrReady;
    try {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    } catch {
      // Clipboard read is optional until a field sets read: 'clipboard'.
    }
    const ocr = await getOCRUtil();
    const extractor = new FieldExtractor(ocr);
    const shotDir = testInfo.outputPath('ocr-shots');
    fs.mkdirSync(shotDir, { recursive: true });
    await use((screen) => ScreenResult.bind(page, extractor, screen, shotDir, { overlay: ocrOverlay }));
    extractor.cleanup();
  },
});

export { expect } from '@playwright/test';
