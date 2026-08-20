import type { ElementConfig, ElementResult, ScreenComparison } from './types.js';
import type { ScreenConfig } from './screen-config.js';
import { ScreenElement, VISIBLE_CONFIDENCE, type MatchOptions, type WaitForOptions } from './element.js';
import type { Page } from '@playwright/test';
import { ocrStep } from './ocr-step.js';
import { hideOcrOverlay, overlayBoxesFromResult, showOcrOverlay } from './ocr-overlay.js';
import { unhoverBeforeCapture } from './unhover.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
   * Bind a screen to a live page so element().waitFor / fill / click can screenshot and match.
   */
  static bind(
    page: Page,
    extractor: ScreenExtractor,
    screen: ScreenConfig,
    shotDir: string,
    options: { overlay?: boolean; unhover?: boolean } = {},
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
    const swaps = part?.swaps ?? config.swaps;
    const overflow = part?.overflow ?? config.overflow;
    const read = part?.read ?? config.read;
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
