import type { Page } from '@playwright/test';
import type { Rect } from './types.js';
import { ocrStep, expectTimeout } from './ocr-step.js';
import { getOCRUtil } from './utils/ocr.js';
import { unhoverBeforeCapture } from './unhover.js';
import { VISIBLE_CONFIDENCE } from './element.js';
import { getClickStrategy } from './strategies.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Text matching
// ---------------------------------------------------------------------------

export type TextQuery = string | RegExp;

/** Normalise a word for matching: lowercase, strip non-alphanumeric. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

export interface WordBox {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Group a flat list of word boxes into lines by y-center proximity (within 6px),
 * then sort each line left-to-right.
 */
function groupIntoLines(words: WordBox[]): WordBox[][] {
  const lines: WordBox[][] = [];
  for (const word of words) {
    const cy = word.y + word.height / 2;
    const line = lines.find((l) => l.some((w) => Math.abs(w.y + w.height / 2 - cy) <= 6));
    if (line) {
      line.push(word);
    } else {
      lines.push([word]);
    }
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Test a phrase (joined from a word window) against a query.
 * String query: normalised case-insensitive equality.
 * RegExp query: tested against the raw joined phrase.
 */
function phraseMatches(rawPhrase: string, query: TextQuery): boolean {
  if (query instanceof RegExp) return query.test(rawPhrase);
  return normalise(rawPhrase) === normalise(query);
}

/**
 * Union rect of a window of word boxes.
 */
function unionRect(window: WordBox[]): Rect {
  const x = window[0]!.x;
  const y = Math.min(...window.map((w) => w.y));
  const x2 = Math.max(...window.map((w) => w.x + w.width));
  const y2 = Math.max(...window.map((w) => w.y + w.height));
  return { x, y, width: x2 - x, height: y2 - y };
}

/** Average Tesseract confidence (0–100) → 0–1. */
function avgConfidence(window: WordBox[]): number {
  return window.reduce((s, w) => s + w.confidence, 0) / window.length / 100;
}

export interface TextMatch {
  location: Rect;
  confidence: number;
  text: string;
}

/**
 * Find all matches for a query in a flat list of word boxes.
 * For string queries, tries every consecutive window of N words (N = word count of query).
 * For regex queries, tries every window of 1–4 words.
 */
export function findAllMatches(words: WordBox[], query: TextQuery): TextMatch[] {
  const lines = groupIntoLines(words);
  const matches: TextMatch[] = [];

  const maxWindow = query instanceof RegExp
    ? 4
    : (typeof query === 'string' ? query.trim().split(/\s+/).length : 4);

  for (const line of lines) {
    for (let n = 1; n <= Math.min(maxWindow, line.length); n++) {
      for (let i = 0; i <= line.length - n; i++) {
        const window = line.slice(i, i + n);
        const rawPhrase = window.map((w) => w.text).join(' ');
        if (phraseMatches(rawPhrase, query)) {
          matches.push({
            location: unionRect(window),
            confidence: avgConfidence(window),
            text: rawPhrase,
          });
        }
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// TextElement
// ---------------------------------------------------------------------------

const TEXT_VISIBLE_CONFIDENCE = VISIBLE_CONFIDENCE;

/** OCR word extraction from the live page screenshot. */
export async function extractWords(page: Page, shotDir: string, screenName: string, unhover?: boolean): Promise<{ words: WordBox[] }> {
  fs.mkdirSync(shotDir, { recursive: true });
  const shotPath = path.join(shotDir, `${screenName}-text-live.png`);
  await unhoverBeforeCapture(page, unhover);
  const buf = await page.screenshot({ path: shotPath, timeout: 2_000 });
  const ocrUtil = await getOCRUtil();
  const words = await ocrUtil.extractPageWords(buf);
  return { words };
}

export type TextElementOptions = {
  timeout?: number;
};

/**
 * A lightweight element located by visible text via OCR.
 * Returned by `ScreenResult.getByText()` and `ScreenResult.getAllByText()`.
 * Supports click, visibility assertions, and text assertions.
 * Does not support fill/toHaveValue — use a registered element for inputs.
 */
export class TextElement {
  constructor(
    private match: TextMatch,
    private query: TextQuery,
    private page?: Page,
    private shotDir?: string,
    private screenName?: string,
    private unhover?: boolean,
  ) {}

  /** The bounding rect of the matched text in screen coordinates. */
  bounds(): Rect {
    return this.match.location;
  }

  /** The raw OCR text that was matched. */
  text(): string {
    return this.match.text;
  }

  /** Click the matched text region using the configured ClickStrategy. */
  async click(): Promise<void> {
    return ocrStep(`getByText(${formatQuery(this.query)}).click()`, async () => {
      if (!this.page) throw new Error('click() requires a live page');
      const { x, y } = getClickStrategy().getPoint(this.match.location);
      await this.page.mouse.click(x, y);
    });
  }

  /**
   * Assert the text is visible on screen.
   * When bound to a live page, polls until the text appears or timeout expires.
   */
  async toBeVisible(options?: TextElementOptions): Promise<void> {
    return ocrStep(`getByText(${formatQuery(this.query)}).toBeVisible()`, async () => {
      if (this.page) {
        await this.pollUntil(true, options?.timeout ?? expectTimeout());
      } else {
        if (this.match.confidence < TEXT_VISIBLE_CONFIDENCE) {
          throw new Error(
            `Text ${formatQuery(this.query)} not visible (confidence: ${this.match.confidence.toFixed(3)})`,
          );
        }
      }
    });
  }

  /**
   * Assert the text is not visible on screen.
   */
  async toBeHidden(options?: TextElementOptions): Promise<void> {
    return ocrStep(`getByText(${formatQuery(this.query)}).toBeHidden()`, async () => {
      if (this.page) {
        await this.pollUntil(false, options?.timeout ?? expectTimeout());
      } else {
        if (this.match.confidence >= TEXT_VISIBLE_CONFIDENCE) {
          throw new Error(`Text ${formatQuery(this.query)} is still visible`);
        }
      }
    });
  }

  /**
   * Assert the matched OCR text equals or matches expected.
   */
  async toHaveText(expected: string | RegExp, options?: TextElementOptions): Promise<void> {
    return ocrStep(`getByText(${formatQuery(this.query)}).toHaveText(${formatQuery(expected)})`, async () => {
      const check = () => {
        const actual = this.match.text;
        const ok = expected instanceof RegExp ? expected.test(actual) : normalise(actual) === normalise(expected);
        if (!ok) return `Expected text ${formatQuery(expected)}, got "${actual}"`;
        return undefined;
      };
      const first = check();
      if (first === undefined) return;
      if (!this.page || !this.shotDir) throw new Error(first);
      const deadline = Date.now() + (options?.timeout ?? expectTimeout());
      let lastErr = first;
      while (Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 150));
        const { words } = await extractWords(this.page!, this.shotDir!, this.screenName ?? 'screen', this.unhover);
        const found = findAllMatches(words, this.query);
        if (found[0]) this.match = found[0];
        const next = check();
        if (next === undefined) return;
        lastErr = next;
      }
      throw new Error(lastErr);
    });
  }

  /**
   * Wait until this text is visible on screen.
   * Equivalent to toBeVisible() — exists for ergonomic parity with ScreenElement.waitFor().
   */
  async waitFor(options?: TextElementOptions): Promise<void> {
    return this.toBeVisible(options);
  }

  private async pollUntil(wantVisible: boolean, timeout: number): Promise<void> {
    if (!this.page || !this.shotDir) {
      throw new Error('pollUntil requires a live page');
    }
    const deadline = Date.now() + timeout;
    let lastConf = this.match.confidence;
    const already = (wantVisible ? lastConf >= TEXT_VISIBLE_CONFIDENCE : lastConf < TEXT_VISIBLE_CONFIDENCE);
    if (already) return;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 150));
      try {
        const { words } = await extractWords(this.page, this.shotDir, this.screenName ?? 'screen', this.unhover);
        const found = findAllMatches(words, this.query);
        lastConf = found[0]?.confidence ?? 0;
        if (found[0]) this.match = found[0];
        const met = wantVisible ? lastConf >= TEXT_VISIBLE_CONFIDENCE : lastConf < TEXT_VISIBLE_CONFIDENCE;
        if (met) return;
      } catch {
        // navigation / partial screenshot
      }
    }
    const state = wantVisible ? 'visible' : 'hidden';
    throw new Error(
      `Text ${formatQuery(this.query)} not ${state} within ${timeout}ms (confidence: ${lastConf.toFixed(3)})`,
    );
  }
}

function formatQuery(q: string | RegExp): string {
  return q instanceof RegExp ? String(q) : `"${q}"`;
}
