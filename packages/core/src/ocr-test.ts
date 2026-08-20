import { test as base } from '@playwright/test';
import fs from 'node:fs';
import { ScreenResult } from './screen-result.js';
import type { ScreenConfig } from './screen-config.js';
import { loadScreen, getGlobalConfig, configure } from './configure.js';
import { bindOcrScreen, createOcrExtractor, ensureOcrRuntime } from './screen.js';
import { cleanupOCR } from './utils/ocr.js';

export type OcrScreen = (screen: ScreenConfig | string) => ScreenResult;

export const test = base.extend<{ ocrScreen: OcrScreen; ocrOverlay: boolean }, { ocrReady: void }>({
  ocrReady: [async ({}, use) => {
    await ensureOcrRuntime();
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
    if (getGlobalConfig().devtools) {
      await configure({ devtools: true, page });
    }
    const extractor = await createOcrExtractor();
    const shotDir = testInfo.outputPath('ocr-shots');
    fs.mkdirSync(shotDir, { recursive: true });
    await use((screenArg) => {
      const config = typeof screenArg === 'string' ? loadScreen(screenArg) : screenArg;
      return bindOcrScreen(page, config, extractor, shotDir, { overlay: ocrOverlay });
    });
    extractor.cleanup();
  },
});

export { expect } from '@playwright/test';
