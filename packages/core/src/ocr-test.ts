import { test as base } from '@playwright/test';
import fs from 'node:fs';
import { FieldExtractor } from './field-extractor.js';
import { ScreenResult } from './screen-result.js';
import type { ScreenConfig } from './screen-config.js';
import { loadScreen } from './configure.js';
import { getOCRUtil, cleanupOCR } from './utils/ocr.js';
import { ensureCvReady } from './utils/vision.js';

export type OcrScreen = (screen: ScreenConfig | string) => ScreenResult;

export const test = base.extend<{ ocrScreen: OcrScreen; ocrOverlay: boolean }, { ocrReady: void }>({
  ocrReady: [async ({}, use) => {
    await Promise.all([getOCRUtil(), ensureCvReady()]);
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
    const extractor = new FieldExtractor(ocr, !!process.env.OCR_DEBUG);
    const shotDir = testInfo.outputPath('ocr-shots');
    fs.mkdirSync(shotDir, { recursive: true });
    await use((screen) => {
      const config = typeof screen === 'string' ? loadScreen(screen) : screen;
      return ScreenResult.bind(page, extractor, config, shotDir, { overlay: ocrOverlay });
    });
    extractor.cleanup();
  },
});

export { expect } from '@playwright/test';
