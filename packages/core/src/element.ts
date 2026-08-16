import type { ElementResult, Rect, ElementType } from './types.js';
import type { Page } from '@playwright/test';
import {
  ocrTextMatches,
  type FieldRead,
  type OcrOverflow,
  type OcrSwaps,
} from './utils/ocr.js';
import { ocrStep, attachOcrImage } from './ocr-step.js';

export const VISIBLE_CONFIDENCE = 0.7;

export type MatchOptions = {
  swaps?: OcrSwaps;
  overflow?: OcrOverflow;
  read?: FieldRead;
};

export type HaveTextOptions = {
  timeout?: number;
  /** Expected glyph → OCR glyphs allowed in its place, e.g. `{ '@': ['Q', 'C'], '5': 'S' }`. */
  swaps?: OcrSwaps;
  /** Clip handling. Prefer setting this on the screen config. */
  overflow?: OcrOverflow;
  overflowSlop?: number;
  /** Override config `read`. `clipboard` is click / select-all / copy. */
  read?: FieldRead;
};

export type WaitForOptions = {
  visible?: boolean;
  timeout?: number;
};

export type LiveScreen = {
  waitForElement(name: string, options?: WaitForOptions): Promise<void>;
  elementResult(name: string, partName?: string): ElementResult | undefined;
  matchOptions(name: string, partName?: string): MatchOptions;
  markDirty(): void;
  ensureFresh(): Promise<void>;
  paintOverlay(result: ElementResult, label?: string): Promise<void>;
  hideOverlay(): Promise<void>;
};

function formatExpected(expected: string | RegExp): string {
  return expected instanceof RegExp ? String(expected) : `"${expected}"`;
}

function formatSwaps(swaps: OcrSwaps): string {
  return Object.entries(swaps).map(([from, to]) => {
    const allowed = (typeof to === 'string' ? [to] : [...to]).join('|');
    return `${from}→${allowed}`;
  }).join(', ');
}

function formatMatchNote(match: MatchOptions): string {
  const bits: string[] = [];
  if (match.swaps && Object.keys(match.swaps).length) {
    bits.push(`allowed swaps: ${formatSwaps(match.swaps)}`);
  }
  if (match.overflow) bits.push(`overflow: ${match.overflow}`);
  if (match.read && match.read !== 'ocr') bits.push(`read: ${match.read}`);
  return bits.length ? ` (${bits.join('; ')})` : '';
}

/**
 * Playwright-style element wrapper with chainable assertions
 * Includes built-in retry logic similar to Playwright's auto-waiting
 */
export class ScreenElement {
  constructor(
    private result: ElementResult,
    private page?: Page,
    private live?: LiveScreen,
    private readonly parentName?: string,
  ) {}

  private get label(): string {
    return this.parentName ? `${this.parentName}.${this.result.name}` : this.result.name;
  }

  private get rootName(): string {
    return this.parentName ?? this.result.name;
  }

  private get partName(): string | undefined {
    return this.parentName ? this.result.name : undefined;
  }

  /**
   * Get the element's current value
   */
  value(): string {
    return this.result.value;
  }

  /**
   * OCR for one inner box on a shared-label row.
   */
  part(name: string): ScreenElement {
    const found = this.result.parts?.find((part) => part.name === name);
    if (!found) {
      const known = (this.result.parts || []).map((part) => part.name).join(', ') || 'none';
      throw new Error(
        `Part "${name}" not found on element "${this.result.name}" (parts: ${known})`,
      );
    }
    return new ScreenElement(found, this.page, this.live, this.parentName ?? this.result.name);
  }

  /**
   * Get the element's location on screen
   */
  location(): Rect {
    return this.result.location;
  }

  /**
   * Get the element's match confidence
   */
  confidence(): number | undefined {
    return this.result.confidence;
  }

  /**
   * Get the element's type
   */
  type(): ElementType | undefined {
    return this.result.type;
  }

  /**
   * Get the active variant (if element has variants)
   */
  variant(): string | undefined {
    return this.result.variant;
  }

  /**
   * Wait until this element's template matches the live screenshot.
   */
  async waitFor(options: WaitForOptions = {}): Promise<void> {
    const visible = options.visible !== false;
    return ocrStep(`element('${this.label}').waitFor({ visible: ${visible} })`, async () => {
      await this.waitUntil(options);
      await this.withOverlay();
    });
  }

  /**
   * Assert element is filled/has content
   * @throws if element is empty after timeout
   */
  async toBeFilled(_options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toBeFilled()`, async () => {
      await this.live?.ensureFresh();
      this.syncResult();
      await this.attachTrace();
      if (this.result.isEmpty) {
        throw new Error(`Element "${this.label}" is not filled`);
      }
    });
  }

  /**
   * Assert element is empty/has no content
   * @throws if element is filled after timeout
   */
  async toBeEmpty(_options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toBeEmpty()`, async () => {
      await this.live?.ensureFresh();
      this.syncResult();
      await this.attachTrace();
      if (!this.result.isEmpty) {
        throw new Error(`Element "${this.label}" is not empty`);
      }
    });
  }

  /**
   * Assert element is visible (found with confidence > threshold).
   * When bound to a live page, waits until the template matches.
   */
  async toBeVisible(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toBeVisible()`, async () => {
      if (this.live && this.page) {
        await this.waitUntil(options?.timeout !== undefined
          ? { visible: true, timeout: options.timeout }
          : { visible: true });
      }
      this.syncResult();
      await this.attachTrace();
      if (!this.result.confidence || this.result.confidence < VISIBLE_CONFIDENCE) {
        throw new Error(
          `Element "${this.label}" is not visible (confidence: ${this.result.confidence})`,
        );
      }
    });
  }

  /**
   * Assert element has specific text/value
   * @throws if text doesn't match after timeout
   */
  async toHaveText(expected: string | RegExp, options?: HaveTextOptions): Promise<void> {
    return ocrStep(`element('${this.label}').toHaveText(${formatExpected(expected)})`, async () => {
      const match = this.resolvedMatch(options);
      const actual = await this.actualText(match, options?.timeout);
      await this.attachTrace();
      if (ocrTextMatches(actual, expected, {
        ...(match.swaps !== undefined && { swaps: match.swaps }),
        ...(match.overflow !== undefined && { overflow: match.overflow }),
        ...(options?.overflowSlop !== undefined && { overflowSlop: options.overflowSlop }),
      })) return;
      throw new Error(
        `Element "${this.label}" does not have text ${formatExpected(expected)}${formatMatchNote(match)}. Actual: "${actual}"`,
      );
    });
  }

  /**
   * Assert element has exact text/value
   * @throws if text doesn't match exactly after timeout
   */
  async toHaveValue(expected: string, options?: HaveTextOptions): Promise<void> {
    return ocrStep(`element('${this.label}').toHaveValue(${formatExpected(expected)})`, async () => {
      const match = this.resolvedMatch(options);
      const actual = await this.actualText(match, options?.timeout);
      await this.attachTrace();
      if (ocrTextMatches(actual, expected, {
        ...(match.swaps !== undefined && { swaps: match.swaps }),
        ...(match.overflow !== undefined && { overflow: match.overflow }),
        ...(options?.overflowSlop !== undefined && { overflowSlop: options.overflowSlop }),
        exact: !match.overflow,
      })) return;
      throw new Error(
        `Element "${this.label}" does not have value "${expected}"${formatMatchNote(match)}. Actual: "${actual}"`,
      );
    });
  }

  /**
   * Assert checkbox/toggle is checked
   * @throws if not checked after timeout
   */
  async toBeChecked(_options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toBeChecked()`, async () => {
      await this.live?.ensureFresh();
      this.syncResult();
      await this.attachTrace();
      if (this.result.value !== 'checked') {
        throw new Error(`Element "${this.label}" is not checked`);
      }
    });
  }

  /**
   * Assert checkbox/toggle is unchecked
   * @throws if checked after timeout
   */
  async toBeUnchecked(_options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toBeUnchecked()`, async () => {
      await this.live?.ensureFresh();
      this.syncResult();
      await this.attachTrace();
      if (this.result.value !== 'unchecked') {
        throw new Error(`Element "${this.label}" is not unchecked`);
      }
    });
  }

  /**
   * Assert element is in specific variant state
   * @throws if variant doesn't match after timeout
   */
  async toHaveVariant(expected: string, _options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toHaveVariant(${JSON.stringify(expected)})`, async () => {
      await this.live?.ensureFresh();
      this.syncResult();
      await this.attachTrace();
      const actual = this.result.variant;
      if (actual !== expected) {
        throw new Error(
          `Element "${this.label}" does not have variant "${expected}". Actual: "${actual || 'none'}"`,
        );
      }
    });
  }

  /**
   * Assert element matches with high confidence
   * @throws if confidence below threshold after timeout
   */
  async toHaveConfidence(threshold: number, _options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toHaveConfidence(${threshold})`, async () => {
      this.syncResult();
      await this.attachTrace();
      if (!this.result.confidence || this.result.confidence < threshold) {
        throw new Error(
          `Element "${this.label}" confidence ${this.result.confidence} is below ${threshold}`,
        );
      }
    });
  }

  /**
   * Click the element at its center
   * Requires page to be provided
   */
  async click(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').click()`, async () => {
      await this.ensureLocated(options?.timeout);
      await this.withOverlay(async () => {
        await this.clickRect(this.result.ocrLocation ?? this.result.location);
        this.live?.markDirty();
      });
    });
  }

  /**
   * Type text into the element.
   * Clicks the value box (ocrRect), not the label crop, then types.
   * Requires page to be provided
   */
  async fill(text: string, options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').fill(${JSON.stringify(text)})`, async () => {
      await this.ensureLocated(options?.timeout);
      await this.withOverlay(async () => {
        await this.clickRect(this.result.ocrLocation ?? this.result.location);
        await this.page!.keyboard.press('ControlOrMeta+A');
        await this.page!.keyboard.press('Backspace');
        await this.page!.keyboard.insertText(text);
        this.live?.markDirty();
      });
    });
  }

  private async clickRect(rect: Rect): Promise<void> {
    if (!this.page) {
      throw new Error('Page not provided. Cannot click element.');
    }
    await this.page.mouse.click(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
  }

  /**
   * Get custom metadata from custom matcher
   * Returns undefined if no metadata available
   */
  metadata(): Record<string, any> | undefined {
    return this.result.metadata;
  }

  /**
   * Get a specific metadata value
   */
  getMetadata<T = any>(key: string): T | undefined {
    return this.result.metadata?.[key] as T | undefined;
  }

  /**
   * Get element info for debugging
   */
  info(): ElementResult {
    return { ...this.result };
  }

  private syncResult(): void {
    if (!this.live) return;
    const latest = this.live.elementResult(this.rootName, this.partName);
    if (latest) this.result = latest;
  }

  private async highlight(): Promise<void> {
    await this.live?.paintOverlay(this.result, this.label);
  }

  private async withOverlay<T>(body?: () => Promise<T>): Promise<T | void> {
    try {
      await this.highlight();
      if (body) return await body();
    } finally {
      await this.live?.hideOverlay();
    }
  }

  private async attachTrace(): Promise<void> {
    await this.withOverlay(async () => {
      if (!this.result.traceImage) return;
      await attachOcrImage(
        this.result.traceName ?? `ocr:${this.label} → ${this.result.value || '(empty)'}`,
        this.result.traceImage,
      );
    });
  }

  private isLocated(): boolean {
    this.syncResult();
    return this.result.location.width > 0 && (this.result.confidence ?? 0) >= VISIBLE_CONFIDENCE;
  }

  private async ensureLocated(timeout?: number): Promise<void> {
    if (this.isLocated()) return;
    await this.waitUntil(timeout !== undefined ? { visible: true, timeout } : { visible: true });
  }

  private async waitUntil(options: WaitForOptions = {}): Promise<void> {
    if (!this.live) {
      throw new Error(
        `element('${this.label}').waitFor() requires ScreenResult.bind(page, extractor, screen, shotDir)`,
      );
    }
    await this.live.waitForElement(this.rootName, options);
    this.syncResult();
  }

  private resolvedMatch(options?: HaveTextOptions): MatchOptions {
    const fromConfig = this.live?.matchOptions(this.rootName, this.partName) ?? {};
    const match: MatchOptions = {};
    const swaps = options?.swaps ?? fromConfig.swaps;
    const overflow = options?.overflow ?? fromConfig.overflow;
    const read = options?.read ?? fromConfig.read;
    if (swaps) match.swaps = swaps;
    if (overflow) match.overflow = overflow;
    if (read) match.read = read;
    return match;
  }

  private async actualText(match: MatchOptions, timeout?: number): Promise<string> {
    if (match.read === 'clipboard') {
      await this.ensureLocated(timeout);
      return this.copyFromField();
    }
    await this.live?.ensureFresh();
    this.syncResult();
    return this.result.value;
  }

  private async copyFromField(): Promise<string> {
    if (!this.page) {
      throw new Error(`element('${this.label}') clipboard read requires a page`);
    }
    await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await this.highlight();
    await this.clickRect(this.result.ocrLocation ?? this.result.location);
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.press('ControlOrMeta+C');
    return this.page.evaluate(() => navigator.clipboard.readText());
  }
}
