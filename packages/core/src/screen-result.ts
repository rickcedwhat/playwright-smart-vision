import type { ElementConfig, ElementResult, ScreenComparison } from './types.js';
import type { ScreenConfig } from './screen-config.js';
import { ScreenElement, VISIBLE_CONFIDENCE, type MatchOptions, type WaitForOptions } from './element.js';
import { TextElement, findAllMatches, extractWords, type TextQuery, type TextElementOptions } from './text-element.js';
import type { Page } from '@playwright/test';
import { ocrStep, expectTimeout } from './ocr-step.js';
import { hideOcrOverlay, overlayBoxesFromResult, showOcrOverlay } from './ocr-overlay.js';
import { unhoverBeforeCapture } from './unhover.js';
import { resolveCharsetSwaps, getOcrStrategy, getOCRUtil, type FieldRead } from './utils/ocr.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runHandlers } from './screen-handler.js';

export type ScreenExtractor = {
  loadForms(blankFormPath: string, filledFormPath: string): Promise<void>;
  locateOnScreenshot(screenshotPath: string, config: ElementConfig): Promise<ElementResult>;
  extractElements?(
    configs: readonly ElementConfig[] | ElementConfig[],
  ): Promise<ScreenComparison>;
  extractFields?(
    configs: readonly ElementConfig[] | ElementConfig[],
  ): Promise<{
    fields: ElementResult[];
    totalFields: number;
    filledFields: number;
    emptyFields: number;
  }>;
};

export type ScreenHost = {
  extractor: ScreenExtractor;
  screen: ScreenConfig;
  shotDir: string;
  overlay?: boolean;
  /** Override global unhoverBeforeCapture for this bind. */
  unhover?: boolean;
  /** init()-level read override — wins over index.json, loses to call site. */
  initRead?: FieldRead;
};

async function extractComparison(
  extractor: ScreenExtractor,
  configs: readonly ElementConfig[] | ElementConfig[],
): Promise<ScreenComparison> {
  if (extractor.extractElements) {
    return extractor.extractElements(configs);
  }
  if (!extractor.extractFields) {
    throw new Error('Extractor must implement extractElements or extractFields');
  }
  const extracted = await extractor.extractFields(configs);
  return {
    elements: extracted.fields,
    totalElements: extracted.totalFields,
    filledElements: extracted.filledFields,
    emptyElements: extracted.emptyFields,
  };
}

/**
 * Playwright-style screen result wrapper
 * Provides chainable access to elements with assertions
 */
export class ScreenResult {
  private dirty = false;

  constructor(
    private comparison: ScreenComparison,
    private page?: Page,
    private host?: ScreenHost,
  ) {}

  /**
   * Construct a ScreenResult pre-populated from an already-taken screenshot.
   * Used by screen handler dispatch — avoids an extra screenshot round-trip.
   */
  static async fromShot(shot: string, page: Page, host: ScreenHost): Promise<ScreenResult> {
    await host.extractor.loadForms(host.screen.blankScreenPath, shot);
    const comparison = await extractComparison(host.extractor, host.screen.elementConfigs);
    return new ScreenResult(comparison, page, host);
  }

  /**
   * Bind a screen to a live page so element().waitFor / fill / click can screenshot and match.
   */
  static bind(
    page: Page,
    extractor: ScreenExtractor,
    screen: ScreenConfig,
    shotDir: string,
    options: { overlay?: boolean; unhover?: boolean; initRead?: FieldRead } = {},
  ): ScreenResult {
    return new ScreenResult({
      elements: [],
      totalElements: 0,
      filledElements: 0,
      emptyElements: 0,
    }, page, {
      extractor,
      screen,
      shotDir,
      ...(options.overlay !== undefined && { overlay: options.overlay }),
      ...(options.unhover !== undefined && { unhover: options.unhover }),
      ...(options.initRead !== undefined && { initRead: options.initRead }),
    });
  }

  /**
   * Get an element by name
   * Returns a ScreenElement with chainable assertions
   */
  element(name: string): ScreenElement {
    const found = this.comparison.elements.find(e => e.name === name);
    if (found) {
      return new ScreenElement(found, this.page, this.host ? this : undefined);
    }
    const config = this.host?.screen.elementConfigs.find(c => c.name === name);
    if (this.host && config) {
      const placeholder: ElementResult = {
        name,
        value: '',
        location: { x: 0, y: 0, width: 0, height: 0 },
        isEmpty: true,
      };
      if (config.type) placeholder.type = config.type;
      return new ScreenElement(placeholder, this.page, this);
    }
    throw new Error(`Element "${name}" not found in screen results`);
  }

  elementResult(name: string, partName?: string): ElementResult | undefined {
    const found = this.comparison.elements.find(e => e.name === name);
    if (!found) return undefined;
    if (!partName) return found;
    return found.parts?.find(part => part.name === partName);
  }

  matchOptions(name: string, partName?: string): MatchOptions {
    const config = this.host?.screen.elementConfigs.find(c => c.name === name);
    if (!config) return {};
    const part = partName ? config.parts?.find(row => row.name === partName) : undefined;
    const match: MatchOptions = {};
    // Resolution order: part > init() override > config (index.json) > Strategies.Ocr > (built-in defaults in element.ts)
    const strategy = getOcrStrategy();
    const swaps = part?.swaps ?? resolveCharsetSwaps(part?.charset) ?? config.swaps ?? resolveCharsetSwaps(config.charset) ?? strategy?.swaps;
    const overflow = part?.overflow ?? config.overflow ?? strategy?.overflow;
    const read = part?.read ?? this.host?.initRead ?? config.read ?? strategy?.read;
    if (swaps) match.swaps = swaps;
    if (overflow) match.overflow = overflow;
    if (read) match.read = read;
    return match;
  }

  markDirty(): void {
    this.dirty = true;
  }

  async ensureFresh(): Promise<void> {
    if (!this.host || !this.page) return;
    if (!this.dirty && this.comparison.elements.length) return;
    await this.refresh();
  }

  /**
   * Wait until this screen is showing, then OCR-extract every field.
   *
   * Behaviour is controlled by screen.ready:
   *   string        — one element must reach the visible threshold
   *   string[]      — all elements must reach the threshold (sequential)
   *   { any: [...] }— any one element must reach the threshold (single poll loop)
   */
  async waitFor(options: WaitForOptions = {}): Promise<void> {
    if (!this.host) {
      throw new Error('waitFor requires ScreenResult.bind(page, extractor, screen, shotDir)');
    }
    const ready = this.host.screen.ready ?? this.host.screen.elementConfigs[0]?.name;
    if (!ready) {
      throw new Error(`Screen "${this.host.screen.name}" has no elements to wait for`);
    }
    const visible = options.visible !== false;
    return ocrStep(`screen('${this.host.screen.name}').waitFor({ visible: ${visible} })`, async () => {
      let overlayName: string;
      if (typeof ready === 'string') {
        await this.waitForElement(ready, options);
        overlayName = ready;
      } else if (Array.isArray(ready)) {
        for (const name of ready) await this.waitForElement(name, options);
        overlayName = ready[0]!;
      } else {
        overlayName = await this.waitForAny(ready.any, options);
      }
      const result = this.elementResult(overlayName);
      if (!result) return;
      try {
        await this.paintOverlay(result, overlayName);
      } finally {
        await this.hideOverlay();
      }
    });
  }

  private async waitForAny(names: string[], options: WaitForOptions): Promise<string> {
    if (!this.host || !this.page) {
      throw new Error('waitForAny requires ScreenResult.bind(...)');
    }
    const visible = options.visible !== false;
    const timeout = options.timeout ?? 15_000;
    const entries = names
      .map((name) => ({ name, config: this.host!.screen.elementConfigs.find((c) => c.name === name) }))
      .filter((e): e is { name: string; config: ElementConfig } => !!e.config);

    if (!entries.length) {
      throw new Error(
        `ready.any: none of [${names.join(', ')}] found in screen "${this.host.screen.name}"`,
      );
    }

    fs.mkdirSync(this.host.shotDir, { recursive: true });
    const shot = path.join(this.host.shotDir, `${this.host.screen.name}-live.png`);
    const deadline = Date.now() + timeout;
    let bestName = names[0];
    let bestConf = 0;

    while (Date.now() < deadline) {
      try {
        await this.captureLive(shot);
        for (const { name, config } of entries) {
          const located = await this.host.extractor.locateOnScreenshot(shot, config);
          const conf = located.confidence ?? 0;
          if (conf > bestConf) { bestConf = conf; bestName = name; }
          if ((conf >= VISIBLE_CONFIDENCE) === visible) {
            await this.loadExtracted(shot);
            this.dirty = false;
            return name;
          }
        }
      } catch {
        // navigation / partial screenshot
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    throw new Error(
      `None of [${names.join(', ')}] ${visible ? 'visible' : 'hidden'} within ${timeout}ms` +
      ` (best: "${bestName}" at ${bestConf.toFixed(3)})`,
    );
  }

  /**
   * Poll the live screenshot until this element's template is visible (or hidden).
   * On success, OCR-extracts every field on the screen.
   */
  async waitForElement(name: string, options: WaitForOptions = {}): Promise<void> {
    if (!this.host || !this.page) {
      throw new Error('waitFor requires ScreenResult.bind(page, extractor, screen, shotDir)');
    }
    const visible = options.visible !== false;
    const timeout = options.timeout ?? 15_000;
    const config = this.host.screen.elementConfigs.find(c => c.name === name);
    if (!config) {
      throw new Error(`Element "${name}" is not in screen "${this.host.screen.name}"`);
    }

    fs.mkdirSync(this.host.shotDir, { recursive: true });
    const shot = path.join(this.host.shotDir, `${this.host.screen.name}-live.png`);
    const deadline = Date.now() + timeout;
    let last = 0;

    while (Date.now() < deadline) {
      try {
        await this.captureLive(shot);
        const located = await this.host.extractor.locateOnScreenshot(shot, config);
        last = located.confidence ?? 0;
        if ((last >= VISIBLE_CONFIDENCE) === visible) {
          await this.loadExtracted(shot);
          this.dirty = false;
          return;
        }
      } catch {
        // Navigation and half-written screenshots are expected while waiting.
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    throw new Error(
      `Element "${name}" not ${visible ? 'visible' : 'hidden'} within ${timeout}ms (confidence: ${last.toFixed(3)})`,
    );
  }

  /**
   * Screenshot the live page and OCR-extract every field on this screen.
   */
  async refresh(): Promise<void> {
    if (!this.host || !this.page) {
      throw new Error('refresh requires ScreenResult.bind(page, extractor, screen, shotDir)');
    }
    return ocrStep(`screen('${this.host.screen.name}').refresh()`, async () => {
      fs.mkdirSync(this.host!.shotDir, { recursive: true });
      const shot = path.join(this.host!.shotDir, `${this.host!.screen.name}-live.png`);
      await this.captureLive(shot);
      await this.loadExtracted(shot);
      this.dirty = false;
    });
  }

  private async captureLive(shot: string): Promise<void> {
    await unhoverBeforeCapture(this.page!, this.host?.unhover);
    await this.page!.screenshot({ path: shot, timeout: 2_000 });
    if (this.host) await runHandlers(shot, this.host, this.page!);
  }

  private async loadExtracted(shot: string): Promise<void> {
    if (!this.host) {
      throw new Error('loadExtracted requires ScreenResult.bind(...)');
    }
    await this.host.extractor.loadForms(this.host.screen.blankScreenPath, shot);
    this.comparison = await extractComparison(this.host.extractor, this.host.screen.elementConfigs);
  }

  async paintOverlay(result: ElementResult, label?: string): Promise<void> {
    if (!this.page || !this.host?.overlay) return;
    await showOcrOverlay(this.page, overlayBoxesFromResult(result, label));
  }

  async hideOverlay(): Promise<void> {
    if (!this.page || !this.host?.overlay) return;
    await hideOcrOverlay(this.page);
  }

  // ---------------------------------------------------------------------------
  // Text locators
  // ---------------------------------------------------------------------------

  private async captureWords(): Promise<{ words: import('./text-element.js').WordBox[] }> {
    if (!this.host || !this.page) {
      throw new Error('getByText / toContainText requires ScreenResult.bind(page, ...)');
    }
    return extractWords(this.page, this.host.shotDir, this.host.screen.name, this.host.unhover);
  }

  /**
   * Find the first occurrence of text on screen via OCR.
   * Waits until the text is visible (by default).
   * Use for dynamic / ad-hoc content that is not registered in index.json —
   * dropdown options, toast messages, menu rows, table cells.
   *
   * @param query - Exact string (case-insensitive) or RegExp.
   * @param options.timeout - How long to wait for the text to appear (ms). Default 15 000.
   */
  async getByText(query: TextQuery, options?: TextElementOptions): Promise<TextElement> {
    return ocrStep(`screen.getByText(${String(query)})`, async () => {
      if (!this.host || !this.page) {
        throw new Error('getByText requires ScreenResult.bind(page, ...)');
      }
      const timeout = options?.timeout ?? 15_000;
      const deadline = Date.now() + timeout;
      while (true) {
        try {
          const { words: w } = await this.captureWords();
          const matches = findAllMatches(w, query);
          if (matches[0]) {
            return new TextElement(
              matches[0],
              query,
              this.page,
              this.host.shotDir,
              this.host.screen.name,
              this.host.unhover,
            );
          }
        } catch {
          // transient screenshot error (navigation, partial load) — retry
        }
        if (Date.now() >= deadline) break;
        await new Promise<void>((r) => setTimeout(r, 150));
      }
      throw new Error(`Text ${String(query)} not found within ${timeout}ms`);
    });
  }

  /**
   * Find all occurrences of text on screen via OCR.
   * Returns immediately with whatever matches are currently visible — no implicit wait.
   * Use for list rows, repeated badges, or any case where multiple matches are expected.
   */
  async getAllByText(query: TextQuery): Promise<TextElement[]> {
    return ocrStep(`screen.getAllByText(${String(query)})`, async () => {
      const { words } = await this.captureWords();
      const matches = findAllMatches(words, query);
      return matches.map((m) => new TextElement(
        m,
        query,
        this.page,
        this.host?.shotDir,
        this.host?.screen.name,
        this.host?.unhover,
      ));
    });
  }

  /**
   * Assert that the given text is visible anywhere on screen.
   * Useful for smoke-checking dynamic feedback without registering an element.
   *
   * @param query - Exact string (case-insensitive) or RegExp.
   * @param options.timeout - How long to poll (ms). Default: expectTimeout().
   */
  async toContainText(query: TextQuery, options?: TextElementOptions): Promise<void> {
    return ocrStep(`screen.toContainText(${String(query)})`, async () => {
      const timeout = options?.timeout ?? expectTimeout();
      const deadline = Date.now() + timeout;
      while (true) {
        try {
          const { words } = await this.captureWords();
          if (findAllMatches(words, query).some((m) => m.confidence >= VISIBLE_CONFIDENCE)) return;
        } catch {
          // transient screenshot error (navigation, partial load) — retry
        }
        if (Date.now() >= deadline) break;
        await new Promise<void>((r) => setTimeout(r, 150));
      }
      throw new Error(`Screen does not contain text ${String(query)} within ${timeout}ms`);
    });
  }

  /**
   * Get all elements
   */
  allElements(): ScreenElement[] {
    return this.comparison.elements.map(e => new ScreenElement(e, this.page, this.host ? this : undefined));
  }

  /**
   * Get all filled elements
   */
  filledElements(): ScreenElement[] {
    return this.comparison.elements
      .filter(e => !e.isEmpty)
      .map(e => new ScreenElement(e, this.page, this.host ? this : undefined));
  }

  /**
   * Get all empty elements
   */
  emptyElements(): ScreenElement[] {
    return this.comparison.elements
      .filter(e => e.isEmpty)
      .map(e => new ScreenElement(e, this.page, this.host ? this : undefined));
  }

  /**
   * Count total elements
   */
  count(): number {
    return this.comparison.totalElements;
  }

  /**
   * Count filled elements
   */
  filledCount(): number {
    return this.comparison.filledElements;
  }

  /**
   * Count empty elements
   */
  emptyCount(): number {
    return this.comparison.emptyElements;
  }

  /**
   * Check if element exists
   */
  hasElement(name: string): boolean {
    return this.comparison.elements.some(e => e.name === name)
      || Boolean(this.host?.screen.elementConfigs.some(c => c.name === name));
  }

  /**
   * Get raw comparison data
   */
  raw(): ScreenComparison {
    return { ...this.comparison };
  }
}
