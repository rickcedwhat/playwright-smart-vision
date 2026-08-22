import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as base } from '@playwright/test';
import type { Page, TestType } from '@playwright/test';
import type { ScreenConfig } from './screen-config.js';
import { loadScreen } from './configure.js';
import { FieldExtractor } from './field-extractor.js';
import { ScreenResult } from './screen-result.js';
import { cleanupOCR, getOCRUtil, setCharsetRegistry, setOcrStrategy, type Charset, type FieldRead, type OcrStrategy } from './utils/ocr.js';
import { ensureCvReady } from './utils/vision.js';

export interface BindOcrScreenOptions {
  shotDir?: string;
  overlay?: boolean;
  /**
   * Override `init({ unhoverBeforeCapture })` for this screen.
   * Default inherits global config (true when unset).
   */
  unhover?: boolean;
  /**
   * Override `init({ read })` for this screen.
   * Default inherits the init-level read mode.
   */
  read?: FieldRead;
}

/** Warm OCR + OpenCV (safe to call more than once). */
export async function ensureOcrRuntime(): Promise<void> {
  await Promise.all([getOCRUtil(), ensureCvReady()]);
}

/** New extractor for a Playwright fixture scope. */
export async function createOcrExtractor(): Promise<FieldExtractor> {
  await ensureOcrRuntime();
  return new FieldExtractor(await getOCRUtil(), !!process.env.OCR_DEBUG);
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
    ...(options.unhover !== undefined && { unhover: options.unhover }),
    ...(options.read !== undefined && { initRead: options.read }),
  });
}

// ─── init() state ────────────────────────────────────────────────────────────

export interface Strategies {
  charsets?: Record<string, Charset>;
  ocr?: OcrStrategy;
}

export { type OcrStrategy };

/** Runtime factories for strategy slots. */
export const Strategies = {
  Ocr: {
    /** Create an Ocr strategy with global charset defaults, name-inference, and swaps. */
    default(options: OcrStrategy): OcrStrategy {
      return options;
    },
  },
};

interface InitOptions {
  page: Page;
  storage?: { root: string };
  devtools?: boolean;
  unhoverBeforeCapture?: boolean;
  /** Environment-level read override. Wins over index.json; call site wins over this. */
  read?: FieldRead;
  strategies?: Strategies;
}

interface InitState {
  config: InitOptions;
  extractor: FieldExtractor;
  shotDir: string;
}

let initState: InitState | null = null;
let exitHandlerRegistered = false;

function defaultShotDir(): string {
  const dir = path.join(os.tmpdir(), 'smart-vision-shots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Warm OCR/CV, configure the page and storage root, and make `screen()` sync.
 * Idempotent — calling again with a new page updates the active page.
 *
 *   await init({ page, storage: { root: process.env.SCREENS_DIR } });
 *   const customerInfo = screen('customer-info');
 */
export async function init(options: InitOptions): Promise<void> {
  await ensureOcrRuntime();

  if (!initState) {
    const extractor = new FieldExtractor(await getOCRUtil(), !!process.env.OCR_DEBUG);
    initState = { config: options, extractor, shotDir: defaultShotDir() };
  } else {
    initState.config = { ...initState.config, ...options };
  }

  if (options.strategies?.charsets) {
    setCharsetRegistry(options.strategies.charsets);
  }
  if (options.strategies?.ocr !== undefined) {
    setOcrStrategy(options.strategies.ocr);
  }

  try {
    await options.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  } catch {
    // clipboard is optional until a field sets read: 'clipboard'
  }

  if (options.devtools) {
    const { injectDevtools } = await import('./devtools.js');
    await injectDevtools(options.page);
  }

  if (!exitHandlerRegistered) {
    exitHandlerRegistered = true;
    process.on('beforeExit', () => {
      void release();
    });
  }
}

/**
 * Bind a screen to the page set by `init()`.
 * Sync after `init()` has been called.
 *
 *   const customerInfo = screen('customer-info');
 *   await customerInfo.element('customerNumber').toHaveValue('SEA314535');
 */
export function screen(
  nameOrConfig: string | ScreenConfig,
  options: BindOcrScreenOptions = {},
): ScreenResult {
  if (!initState) {
    const name = typeof nameOrConfig === 'string' ? nameOrConfig : nameOrConfig.name;
    throw new Error(`screen('${name}'): call await init({ page, storage: { root } }) first`);
  }
  const config = typeof nameOrConfig === 'string' ? loadScreen(nameOrConfig) : nameOrConfig;
  const mergedOptions: BindOcrScreenOptions = { ...options };
  if (mergedOptions.unhover === undefined && initState.config.unhoverBeforeCapture !== undefined) {
    mergedOptions.unhover = initState.config.unhoverBeforeCapture;
  }
  if (mergedOptions.read === undefined && initState.config.read !== undefined) {
    mergedOptions.read = initState.config.read;
  }
  return bindOcrScreen(
    initState.config.page,
    config,
    initState.extractor,
    options.shotDir ?? initState.shotDir,
    mergedOptions,
  );
}

/** Release shared OCR/CV resources. Optional — registered automatically by init(). */
export async function release(): Promise<void> {
  initState?.extractor.cleanup();
  initState = null;
  setCharsetRegistry({});
  setOcrStrategy(undefined);
  await cleanupOCR();
}

/** @deprecated Use release() */
export const releaseOcrScreen = release;

// ─── createFixture() ─────────────────────────────────────────────────────────

export type ScreenFixture = (config: ScreenConfig | string) => ScreenResult;

interface ScreenFixtures {
  screen: ScreenFixture;
  ocrOverlay: boolean;
}

interface ScreenWorkerFixtures {
  _ocrReady: void;
}

/**
 * Create a Playwright test object with a `screen` fixture and an `ocrOverlay` option.
 *
 *   const test = createFixture();
 *   export { test };
 *
 *   test('my test', async ({ page, screen }) => {
 *     const login = screen(htmlLoginScreen);
 *     await login.element('username').fill('qawolf');
 *   });
 *
 *   // Enable overlay rendering for a test file:
 *   test.use({ ocrOverlay: true });
 */
export function createFixture(): TestType<ScreenFixtures, ScreenWorkerFixtures> {
  return base.extend<ScreenFixtures, ScreenWorkerFixtures>({
    _ocrReady: [
      async ({}, use) => {
        await ensureOcrRuntime();
        await use();
        await cleanupOCR();
      },
      { scope: 'worker' },
    ],

    ocrOverlay: [false, { option: true }],

    screen: async (
      { page, _ocrReady, ocrOverlay }: { page: Page; _ocrReady: void; ocrOverlay: boolean },
      use: (fn: ScreenFixture) => Promise<void>,
      testInfo: { outputPath: (...pathSegments: string[]) => string },
    ) => {
      void _ocrReady;
      try {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      } catch {
        // optional
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
  }) as unknown as TestType<ScreenFixtures, ScreenWorkerFixtures>;
}
