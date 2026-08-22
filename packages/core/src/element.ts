import type { ElementResult, Rect, ElementType } from './types.js';
import type { Page } from '@playwright/test';
import {
  ocrTextMatches,
  resolveCharsetSwaps,
  type Charset,
  type FieldRead,
  type OcrOverflow,
  type OcrSwaps,
} from './utils/ocr.js';
import { ocrStep, expectTimeout } from './ocr-step.js';
import { getClickStrategy, getFillStrategy } from './strategies.js';

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
  /**
   * Charset to use for this assertion — name registered in `init()` or an inline `Charset` object.
   * Only the bundled `swaps` are applied at assertion time; `chars` has no effect here because
   * OCR extraction already ran. For `chars` to take effect, set `charset` on the element config.
   * Explicit `swaps` always win over `charset.swaps`.
   */
  charset?: string | Charset;
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

async function retryUntil(
  live: LiveScreen | undefined,
  sync: () => void,
  check: () => string | undefined,
  timeout: number,
): Promise<void> {
  await live?.ensureFresh();
  sync();
  const first = check();
  if (first === undefined) return;
  if (!live || timeout === 0) throw new Error(first);
  const deadline = Date.now() + timeout;
  let lastErr = first;
  while (Date.now() < deadline) {
    live.markDirty();
    await new Promise<void>((r) => setTimeout(r, 150));
    await live.ensureFresh();
    sync();
    const next = check();
    if (next === undefined) return;
    lastErr = next;
  }
  throw new Error(lastErr);
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
  async toBeFilled(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toBeFilled()`, async () => {
      try {
        await this.retryAssertion(
          () => this.result.isEmpty ? `Element "${this.label}" is not filled` : undefined,
          expectTimeout(options?.timeout),
        );
      } finally {
        await this.withOverlay();
      }
    });
  }

  /**
   * Assert element is empty/has no content
   * @throws if element is filled after timeout
   */
  async toBeEmpty(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toBeEmpty()`, async () => {
      try {
        await this.retryAssertion(
          () => !this.result.isEmpty ? `Element "${this.label}" is not empty` : undefined,
          expectTimeout(options?.timeout),
        );
      } finally {
        await this.withOverlay();
      }
    });
  }

  /** @internal — used by NegatedScreenElement in this module only */
  _internals() {
    const self = this;
    return {
      live: this.live,
      get result() { return self.result; },
      sync: () => this.syncResult(),
      overlay: (body?: () => Promise<void>) => this.withOverlay(body),
      label: this.label,
      resolvedMatch: (options?: HaveTextOptions) => this.resolvedMatch(options),
    };
  }

  get not(): NegatedScreenElement {
    return new NegatedScreenElement(this);
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
      await this.withOverlay();
      if (!this.result.confidence || this.result.confidence < VISIBLE_CONFIDENCE) {
        throw new Error(
          `Element "${this.label}" is not visible (confidence: ${this.result.confidence})`,
        );
      }
    });
  }

  /**
   * Assert element is hidden (confidence below visible threshold).
   * When bound to a live page, waits until the template is no longer visible.
   */
  async toBeHidden(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toBeHidden()`, async () => {
      if (this.live && this.page) {
        await this.waitUntil(options?.timeout !== undefined
          ? { visible: false, timeout: options.timeout }
          : { visible: false });
      }
      this.syncResult();
      await this.withOverlay();
      if (this.result.confidence && this.result.confidence >= VISIBLE_CONFIDENCE) {
        throw new Error(
          `Element "${this.label}" is not hidden (confidence: ${this.result.confidence})`,
        );
      }
    });
  }

  /**
   * Assert element has the "enabled" variant.
   */
  async toBeEnabled(options?: { timeout?: number }): Promise<void> {
    return this.toHaveVariant('enabled', options);
  }

  /**
   * Assert element has the "disabled" variant.
   */
  async toBeDisabled(options?: { timeout?: number }): Promise<void> {
    return this.toHaveVariant('disabled', options);
  }

  /**
   * Assert element value contains the given text as a substring.
   * Supports OCR swap substitutions via options or configured Strategies.Ocr.
   * @throws if actual value does not contain expected after timeout
   */
  async toContainText(expected: string, options?: HaveTextOptions): Promise<void> {
    return ocrStep(`element('${this.label}').toContainText(${formatExpected(expected)})`, async () => {
      const match = this.resolvedMatch(options);
      try {
        await this.retryAssertion(() => {
          const actual = this.result.value;
          return ocrTextMatches(actual, expected, { ...(match.swaps && { swaps: match.swaps }) })
            ? undefined
            : `Element "${this.label}" does not contain text "${expected}". Actual: "${actual}"`;
        }, expectTimeout(options?.timeout));
      } finally {
        await this.withOverlay();
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
      const matchOpts = {
        ...(match.swaps !== undefined && { swaps: match.swaps }),
        ...(match.overflow !== undefined && { overflow: match.overflow }),
        ...(options?.overflowSlop !== undefined && { overflowSlop: options.overflowSlop }),
      };
      if (match.read === 'clipboard') {
        await this.ensureLocated(options?.timeout);
        const actual = await this.copyFromField();
        try {
          if (!ocrTextMatches(actual, expected, matchOpts)) {
            throw new Error(`Element "${this.label}" does not have text ${formatExpected(expected)}${formatMatchNote(match)}. Actual: "${actual}"`);
          }
        } finally {
          await this.withOverlay();
        }
        return;
      }
      try {
        await this.retryAssertion(() => {
          const actual = this.result.value;
          return ocrTextMatches(actual, expected, matchOpts)
            ? undefined
            : `Element "${this.label}" does not have text ${formatExpected(expected)}${formatMatchNote(match)}. Actual: "${actual}"`;
        }, expectTimeout(options?.timeout));
      } finally {
        await this.withOverlay();
      }
    });
  }

  /**
   * Assert element has exact text/value
   * @throws if text doesn't match exactly after timeout
   */
  async toHaveValue(expected: string, options?: HaveTextOptions): Promise<void> {
    return ocrStep(`element('${this.label}').toHaveValue(${formatExpected(expected)})`, async () => {
      const match = this.resolvedMatch(options);
      const matchOpts = {
        ...(match.swaps !== undefined && { swaps: match.swaps }),
        ...(match.overflow !== undefined && { overflow: match.overflow }),
        ...(options?.overflowSlop !== undefined && { overflowSlop: options.overflowSlop }),
        exact: !match.overflow,
      };
      if (match.read === 'clipboard') {
        await this.ensureLocated(options?.timeout);
        const actual = await this.copyFromField();
        try {
          if (!ocrTextMatches(actual, expected, matchOpts)) {
            throw new Error(`Element "${this.label}" does not have value "${expected}"${formatMatchNote(match)}. Actual: "${actual}"`);
          }
        } finally {
          await this.withOverlay();
        }
        return;
      }
      try {
        await this.retryAssertion(() => {
          const actual = this.result.value;
          return ocrTextMatches(actual, expected, matchOpts)
            ? undefined
            : `Element "${this.label}" does not have value "${expected}"${formatMatchNote(match)}. Actual: "${actual}"`;
        }, expectTimeout(options?.timeout));
      } finally {
        await this.withOverlay();
      }
    });
  }

  /**
   * Assert checkbox/toggle is checked
   * @throws if not checked after timeout
   */
  async toBeChecked(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toBeChecked()`, async () => {
      try {
        await this.retryAssertion(
          () => this.result.value !== 'checked' ? `Element "${this.label}" is not checked` : undefined,
          expectTimeout(options?.timeout),
        );
      } finally {
        await this.withOverlay();
      }
    });
  }

  /**
   * Assert checkbox/toggle is unchecked
   * @throws if checked after timeout
   */
  async toBeUnchecked(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toBeUnchecked()`, async () => {
      try {
        await this.retryAssertion(
          () => this.result.value !== 'unchecked' ? `Element "${this.label}" is not unchecked` : undefined,
          expectTimeout(options?.timeout),
        );
      } finally {
        await this.withOverlay();
      }
    });
  }

  /**
   * Assert element is in specific variant state
   * @throws if variant doesn't match after timeout
   */
  async toHaveVariant(expected: string, options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toHaveVariant(${JSON.stringify(expected)})`, async () => {
      try {
        await this.retryAssertion(() => {
          const actual = this.result.variant;
          return actual !== expected
            ? `Element "${this.label}" does not have variant "${expected}". Actual: "${actual || 'none'}"`
            : undefined;
        }, expectTimeout(options?.timeout));
      } finally {
        await this.withOverlay();
      }
    });
  }

  /**
   * Assert element matches with high confidence
   * @throws if confidence below threshold after timeout
   */
  async toHaveConfidence(threshold: number, options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').toHaveConfidence(${threshold})`, async () => {
      try {
        await this.retryAssertion(() => {
          const conf = this.result.confidence;
          return !conf || conf < threshold
            ? `Element "${this.label}" confidence ${conf} is below ${threshold}`
            : undefined;
        }, expectTimeout(options?.timeout));
      } finally {
        await this.withOverlay();
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
        await getFillStrategy().fill(this.page!, this.result.ocrLocation ?? this.result.location, text);
        this.live?.markDirty();
      });
    });
  }

  async check(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').check()`, async () => {
      await this.ensureLocated(options?.timeout);
      if (this.result.value !== 'checked') {
        await this.withOverlay(async () => {
          await this.clickRect(this.result.ocrLocation ?? this.result.location);
          this.live?.markDirty();
        });
      }
    });
  }

  async uncheck(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').uncheck()`, async () => {
      await this.ensureLocated(options?.timeout);
      if (this.result.value !== 'unchecked') {
        await this.withOverlay(async () => {
          await this.clickRect(this.result.ocrLocation ?? this.result.location);
          this.live?.markDirty();
        });
      }
    });
  }

  async selectOption(value: string, options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').selectOption(${JSON.stringify(value)})`, async () => {
      await this.ensureLocated(options?.timeout);
      await this.withOverlay(async () => {
        await this.clickRect(this.result.ocrLocation ?? this.result.location);
        if (!this.page) throw new Error('Page not provided. Cannot select option.');
        await this.page.keyboard.type(value);
        await this.page.keyboard.press('Enter');
        this.live?.markDirty();
      });
    });
  }

  async dblclick(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').dblclick()`, async () => {
      await this.ensureLocated(options?.timeout);
      await this.withOverlay(async () => {
        const rect = this.result.ocrLocation ?? this.result.location;
        if (!this.page) throw new Error('Page not provided. Cannot double-click element.');
        await this.page.mouse.dblclick(rect.x + rect.width / 2, rect.y + rect.height / 2);
        this.live?.markDirty();
      });
    });
  }

  async hover(options?: { timeout?: number }): Promise<void> {
    return ocrStep(`element('${this.label}').hover()`, async () => {
      await this.ensureLocated(options?.timeout);
      const rect = this.result.ocrLocation ?? this.result.location;
      if (!this.page) throw new Error('Page not provided. Cannot hover element.');
      await this.page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    });
  }

  private async clickRect(rect: Rect): Promise<void> {
    if (!this.page) {
      throw new Error('Page not provided. Cannot click element.');
    }
    const { x, y } = getClickStrategy().getPoint(rect);
    await this.page.mouse.click(x, y);
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
    // Priority: explicit call-site swaps > call-site charset swaps > config swaps (which already
    // incorporates the element config's charset bundled swaps as a fallback).
    const callCharsetSwaps = options?.charset ? resolveCharsetSwaps(options.charset) : undefined;
    const swaps = options?.swaps ?? callCharsetSwaps ?? fromConfig.swaps;
    const overflow = options?.overflow ?? fromConfig.overflow;
    const read = options?.read ?? fromConfig.read;
    if (swaps) match.swaps = swaps;
    if (overflow) match.overflow = overflow;
    if (read) match.read = read;
    return match;
  }

  private async retryAssertion(check: () => string | undefined, timeout: number): Promise<void> {
    return retryUntil(this.live, () => this.syncResult(), check, timeout);
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

/**
 * Negated assertion façade returned by `ScreenElement.not`.
 * Each method is the logical inverse of the corresponding `ScreenElement` method.
 */
export class NegatedScreenElement {
  constructor(private readonly el: ScreenElement) {}

  async toBeFilled(options?: { timeout?: number }): Promise<void> {
    return this.el.toBeEmpty(options);
  }

  async toBeEmpty(options?: { timeout?: number }): Promise<void> {
    return this.el.toBeFilled(options);
  }

  async toBeVisible(options?: { timeout?: number }): Promise<void> {
    return this.el.toBeHidden(options);
  }

  async toBeHidden(options?: { timeout?: number }): Promise<void> {
    return this.el.toBeVisible(options);
  }

  async toBeChecked(options?: { timeout?: number }): Promise<void> {
    return this.el.toBeUnchecked(options);
  }

  async toBeUnchecked(options?: { timeout?: number }): Promise<void> {
    return this.el.toBeChecked(options);
  }

  async toBeEnabled(options?: { timeout?: number }): Promise<void> {
    return this.el.toBeDisabled(options);
  }

  async toBeDisabled(options?: { timeout?: number }): Promise<void> {
    return this.el.toBeEnabled(options);
  }

  async toHaveVariant(expected: string, options?: { timeout?: number }): Promise<void> {
    const i = this.el._internals();
    return ocrStep(`element('${i.label}').not.toHaveVariant(${JSON.stringify(expected)})`, async () => {
      try {
        await retryUntil(i.live, i.sync, () => {
          const actual = i.result.variant;
          return actual === expected
            ? `Element "${i.label}" still has variant "${expected}"`
            : undefined;
        }, expectTimeout(options?.timeout));
      } finally {
        await i.overlay();
      }
    });
  }

  async toContainText(expected: string, options?: HaveTextOptions): Promise<void> {
    const i = this.el._internals();
    const match = i.resolvedMatch(options);
    return ocrStep(`element('${i.label}').not.toContainText(${formatExpected(expected)})`, async () => {
      try {
        await retryUntil(i.live, i.sync, () => {
          const actual = i.result.value;
          return ocrTextMatches(actual, expected, { ...(match.swaps && { swaps: match.swaps }) })
            ? `Element "${i.label}" still contains text "${expected}". Actual: "${actual}"`
            : undefined;
        }, expectTimeout(options?.timeout));
      } finally {
        await i.overlay();
      }
    });
  }
}
