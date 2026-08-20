import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { ScreenConfig } from './screen-config.js';
import { getGlobalConfig, loadScreen } from './configure.js';
import { FieldExtractor } from './field-extractor.js';
import { ScreenResult } from './screen-result.js';
import { cleanupOCR, getOCRUtil } from './utils/ocr.js';
import { ensureCvReady } from './utils/vision.js';

export interface BindOcrScreenOptions {
  shotDir?: string;
  overlay?: boolean;
}

let sharedExtractor: FieldExtractor | null = null;
let defaultShotDir = '';

/** Warm OCR + OpenCV (safe to call more than once). */
export async function ensureOcrRuntime(): Promise<void> {
  await Promise.all([getOCRUtil(), ensureCvReady()]);
}

/** New extractor for a Playwright test worker/fixture scope. */
export async function createOcrExtractor(): Promise<FieldExtractor> {
  await ensureOcrRuntime();
  return new FieldExtractor(await getOCRUtil(), !!process.env.OCR_DEBUG);
}

function resolveShotDir(override?: string): string {
  if (override) return override;
  if (!defaultShotDir) {
    defaultShotDir = path.join(os.tmpdir(), 'smart-vision-shots');
    fs.mkdirSync(defaultShotDir, { recursive: true });
  }
  return defaultShotDir;
}

export function bindOcrScreen(
  page: Page,
  config: ScreenConfig,
  extractor: FieldExtractor,
  shotDir: string,
  options: BindOcrScreenOptions = {},
): ScreenResult {
  return ScreenResult.bind(page, extractor, config, shotDir, {
    ...(options.overlay !== undefined && { overlay: options.overlay }),
  });
}

async function sharedExtractorInstance(): Promise<FieldExtractor> {
  if (!sharedExtractor) {
    sharedExtractor = await createOcrExtractor();
  }
  return sharedExtractor;
}

/**
 * Bind a FUSE/catalog screen to the configured page (QA Wolf flows — no Playwright fixture).
 *
 *   await configure({ page, storage: { root: process.env.TEAM_STORAGE_DIR + '/screens' } });
 *   const customerInfo = await screen('customer-info');
 *   await customerInfo.element('customerNumber').toHaveValue(expected);
 */
export async function screen(
  name: string,
  options: BindOcrScreenOptions = {},
): Promise<ScreenResult> {
  const page = getGlobalConfig().page;
  if (!page) {
    throw new Error(`screen('${name}'): call configure({ page, storage: { root } }) first`);
  }
  const config = loadScreen(name);
  const extractor = await sharedExtractorInstance();
  return bindOcrScreen(page, config, extractor, resolveShotDir(options.shotDir), options);
}

/** Release shared OCR/CV resources when a flow finishes. */
export async function releaseOcrScreen(): Promise<void> {
  sharedExtractor?.cleanup();
  sharedExtractor = null;
  await cleanupOCR();
}
