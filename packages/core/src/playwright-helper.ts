import type { Page, Locator } from '@playwright/test';
import { FieldExtractor } from './field-extractor.js';
import type { ElementConfig, ScreenComparison } from './field-extractor.js';
import { ScreenResult } from './screen-result.js';
import { getOCRUtil } from './utils/ocr.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ScreenTestOptions {
  blankScreenPath: string;
  elementConfigs: readonly ElementConfig[] | ElementConfig[];
  debug?: boolean | undefined;
}


// Re-export types for convenience
export type { ElementConfig, ElementResult, ScreenComparison } from './field-extractor.js';
export type { 
  ElementVariant, 
  CustomMatcherContext, 
  CustomMatcherResult, 
  CustomMatcherFunction 
} from './types.js';
export { ElementType } from './field-extractor.js';
export { ScreenResult } from './screen-result.js';
export { ScreenElement } from './element.js';
export type { HaveTextOptions, MatchOptions, WaitForOptions } from './element.js';
export { ocrTextMatches } from './utils/ocr.js';
export type { FieldRead, OcrOverflow, OcrSwaps } from './utils/ocr.js';
export { defineScreen, screenAssetsDir } from './screen-config.js';
export type { ScreenConfig } from './screen-config.js';
export { defineTypedScreen, TypedScreenResult } from './typed-screen.js';
export type { TypedScreenConfig } from './typed-screen.js';
export { test, expect } from './ocr-test.js';

/**
 * Helper class for integrating form OCR testing with Playwright
 * Designed for testing desktop apps via RDP where DOM access is not available
 */
export class PlaywrightFormTester {
  private page: Page;
  private screenshotDir: string;

  constructor(page: Page, screenshotDir = './test-screenshots') {
    this.page = page;
    this.screenshotDir = screenshotDir;
  }

  /**
   * Initialize the screenshot directory
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.screenshotDir, { recursive: true });
  }

  /**
   * Capture a screenshot of the current page or a specific element
   * This works for RDP-based testing where you don't have DOM access
   */
  async captureScreen(filename: string, element?: Locator): Promise<string> {
    const filepath = path.join(this.screenshotDir, filename);
    
    if (element) {
      await element.screenshot({ path: filepath });
    } else {
      await this.page.screenshot({ path: filepath, fullPage: true });
    }

    return filepath;
  }

  /**
   * Compare a filled screen screenshot against a blank template
   * Returns Playwright-style screen result with chainable assertions
   */
  async compareScreen(
    filledScreenshot: string,
    options: ScreenTestOptions
  ): Promise<ScreenResult> {
    const ocrUtil = await getOCRUtil();
    const extractor = new FieldExtractor(ocrUtil, options.debug);

    try {
      await extractor.loadForms(options.blankScreenPath, filledScreenshot);
      const comparison = await extractor.extractElements(options.elementConfigs);
      return new ScreenResult(comparison, this.page);
    } finally {
      extractor.cleanup();
    }
  }


  /**
   * Wait for a form to be stable (no animation/changes) before capturing
   * Useful for forms with loading states or animations
   */
  async waitForStableScreen(
    stabilityTimeMs = 1000,
    maxWaitMs = 10000
  ): Promise<void> {
    const tempDir = path.join(this.screenshotDir, 'temp');
    await fs.mkdir(tempDir, { recursive: true });

    const startTime = Date.now();
    let previousScreenshot: Buffer | null = null;

    while (Date.now() - startTime < maxWaitMs) {
      const screenshot = await this.page.screenshot();

      if (previousScreenshot) {
        const { PNG } = await import('pngjs');
        const img1 = PNG.sync.read(previousScreenshot);
        const img2 = PNG.sync.read(screenshot);

        if (img1.width === img2.width && img1.height === img2.height) {
          const pixelmatch = (await import('pixelmatch')).default;
          const diffImg = new (await import('pngjs')).PNG({
            width: img1.width,
            height: img1.height,
          });
          const diff = pixelmatch(
            img1.data,
            img2.data,
            diffImg.data,
            img1.width,
            img1.height,
            { threshold: 0.1 }
          );

          // If fewer than 100 pixels changed, consider it stable
          if (diff < 100) {
            await new Promise((resolve) => setTimeout(resolve, stabilityTimeMs));
            return;
          }
        }
      }

      previousScreenshot = screenshot;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`Screen did not stabilize within ${maxWaitMs}ms`);
  }

  /**
   * High-level test helper: Navigate, wait for stability, capture, and analyze
   * Returns Playwright-style screen result with chainable assertions
   */
  async testScreen(
    navigationCallback: () => Promise<void>,
    options: ScreenTestOptions
  ): Promise<ScreenResult> {
    await this.initialize();
    
    // Navigate to the screen
    await navigationCallback();
    
    // Wait for the screen to stabilize
    await this.waitForStableScreen();
    
    // Capture the filled screen
    const screenshotPath = await this.captureScreen(
      `filled-screen-${Date.now()}.png`
    );
    
    // Analyze the screen
    return await this.compareScreen(screenshotPath, options);
  }


  /**
   * Clean up temporary screenshots
   */
  async cleanup(): Promise<void> {
    try {
      const files = await fs.readdir(this.screenshotDir);
      for (const file of files) {
        if (file.startsWith('temp-') || file.includes('filled-form-')) {
          await fs.unlink(path.join(this.screenshotDir, file));
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Convenience function for quick UI element extraction from a screenshot
 * Returns Playwright-style screen result with chainable assertions
 */
export async function extractScreenElements(
  filledScreenPath: string,
  blankScreenPath: string,
  elementConfigs: ElementConfig[],
  debug = false
): Promise<ScreenResult> {
  const ocrUtil = await getOCRUtil();
  const extractor = new FieldExtractor(ocrUtil, debug);

  try {
    await extractor.loadForms(blankScreenPath, filledScreenPath);
    const comparison = await extractor.extractElements(elementConfigs);
    return new ScreenResult(comparison);
  } finally {
    extractor.cleanup();
  }
}

