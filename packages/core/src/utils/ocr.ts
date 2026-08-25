import { createWorker } from 'tesseract.js';
import type { Worker } from 'tesseract.js';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = UPPER.toLowerCase();
const DIGITS = '0123456789';

export const CHARSET_PRESETS: Record<string, string> = {
  text: `${UPPER}${LOWER}${DIGITS} ./ -`,
  digits: `${DIGITS} / `,
  alnum: `${UPPER}${LOWER}${DIGITS}`,
  email: `${UPPER}${LOWER}${DIGITS}@._-`,
  vin: `${UPPER}${LOWER}${DIGITS}`,
};

/**
 * Expand a single range spec to a string of characters.
 * A three-character spec like 'A-Z' or 'À-ÿ' expands by Unicode codepoint.
 * Any other string is returned as-is (single char or multi-char literal).
 */
function expandRangeSpec(spec: string): string {
  if (spec.length === 3 && spec[1] === '-') {
    const start = spec.charCodeAt(0);
    const end = spec.charCodeAt(2);
    if (start > end) throw new Error(`Invalid charset range '${spec}': start must be ≤ end`);
    let out = '';
    for (let i = start; i <= end; i++) out += String.fromCharCode(i);
    return out;
  }
  return spec;
}

/**
 * Expand a Charset's only/exclude arrays into the flat string passed to
 * `tessedit_char_whitelist`. Throws if only is empty or exclude is provided
 * without only.
 */
export function charsetToWhitelist(charset: Charset): string {
  if (!charset.only || charset.only.length === 0) {
    throw new Error('Charset must include at least one entry in `only`');
  }
  const chars = new Set<string>();
  for (const spec of charset.only) {
    for (const ch of expandRangeSpec(spec)) chars.add(ch);
  }
  if (charset.exclude) {
    for (const spec of charset.exclude) {
      for (const ch of expandRangeSpec(spec)) chars.delete(ch);
    }
  }
  return [...chars].join('');
}

/** A named charset bundling a Tesseract character allowlist with expected OCR confusions. */
export interface Charset {
  /**
   * Characters to allow. Each entry is either a single character, a multi-character
   * literal, or a Unicode range like 'A-Z', '0-9', 'À-ÿ'.
   */
  only: string[];
  /**
   * Characters to remove from the only set. Same range notation as only.
   * Requires only — error if used alone.
   */
  exclude?: string[];
  /** Expected glyph → OCR glyphs that are acceptable in its place. */
  swaps?: OcrSwaps;
}

/** Global OCR strategy set by init(). */
export interface OcrStrategy {
  /**
   * Tesseract language pack to use for recognition. Default: 'eng'.
   * Use 'fra', 'deu', 'spa', etc. for apps with language-specific text patterns.
   * Changing this re-initializes the Tesseract worker.
   */
  language?: string;
  /** Named charsets available for use via element `charset` field or `infer` map. */
  charsets?: Record<string, Charset>;
  /** Fallback charset when an element has no explicit charset and name-inference finds nothing. */
  defaultCharset?: string;
  /** Map from element-name substring (case-insensitive) → charset name. Checked before built-in heuristics. */
  infer?: Record<string, string>;
  /** Global swaps applied when no element-level swaps are configured. */
  swaps?: OcrSwaps;
  /** Global overflow applied when no element-level overflow is configured. */
  overflow?: OcrOverflow;
  /** Global read mode applied when no element-level read is configured. */
  read?: FieldRead;
}

let globalOcrStrategy: OcrStrategy | undefined;

export function setOcrStrategy(strategy: OcrStrategy | undefined): void {
  const prevLanguage = globalOcrStrategy?.language ?? 'eng';
  const nextLanguage = strategy?.language ?? 'eng';
  globalOcrStrategy = strategy;
  if (sharedOCRUtil && prevLanguage !== nextLanguage) {
    void sharedOCRUtil.initialize(nextLanguage);
  }
}

export function getOcrStrategy(): OcrStrategy | undefined {
  return globalOcrStrategy;
}

/**
 * Resolve a charset using Strategies.Ocr: checks `infer` map first (substring match),
 * then falls back to `defaultCharset`. Returns undefined when no strategy is set.
 */
export function resolveOcrCharset(elementName: string): string | undefined {
  if (!globalOcrStrategy) return undefined;
  const { infer, defaultCharset } = globalOcrStrategy;
  if (infer) {
    const lower = elementName.toLowerCase();
    for (const [substring, charset] of Object.entries(infer)) {
      if (lower.includes(substring.toLowerCase())) return charset;
    }
  }
  return defaultCharset;
}

/** Look up a named charset from the active OcrStrategy, or return undefined if not found. */
export function lookupCharset(name: string): Charset | undefined {
  return globalOcrStrategy?.charsets?.[name];
}

/**
 * Resolve the bundled swaps for a charset name string or inline Charset object.
 * Returns undefined if the name is not registered or the charset has no swaps.
 */
export function resolveCharsetSwaps(charset: string | Charset | undefined): OcrSwaps | undefined {
  if (!charset) return undefined;
  if (typeof charset === 'object') return charset.swaps;
  return lookupCharset(charset)?.swaps;
}

export function charsetForField(name = '', type = '', preset = 'auto'): string | undefined {
  if (type === 'checkbox') return undefined;
  if (preset && preset !== 'auto') {
    const custom = lookupCharset(preset);
    if (custom) return charsetToWhitelist(custom);
    if (CHARSET_PRESETS[preset]) return CHARSET_PRESETS[preset];
  }
  const key = `${name} ${type}`.toLowerCase();
  if (key.includes('email')) return CHARSET_PRESETS.email;
  if (key.includes('vin')) return CHARSET_PRESETS.vin;
  if (key.includes('contact') && key.includes('method')) return CHARSET_PRESETS.text;
  if (key.includes('phone') || key.includes('odometer') || key.includes('year') || key.includes('zip')) {
    return CHARSET_PRESETS.digits;
  }
  return CHARSET_PRESETS.text;
}

export function normalizeOcrText(text: string): string {
  return String(text ?? '').replace(/\n+/g, ' ').trim();
}

export function pickFromOptions(text: string, options?: string[]): string {
  if (!text || !options?.length) return text;
  const compact = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const tokens = (value: string) => value.toUpperCase().match(/[A-Z0-9]+/g) || [];
  const got = compact(text);
  const gotTokens = tokens(text);
  let best: string | null = null;
  let bestScore = 0;
  for (const option of options) {
    const want = compact(option);
    if (!want) continue;
    if (got === want) return option;
    let score = 0;
    const shorter = got.length < want.length ? got : want;
    const longer = got.length < want.length ? want : got;
    if (longer.includes(shorter)) score = shorter.length / longer.length;
    const wantTokens = tokens(option);
    if (gotTokens.length && gotTokens.length === wantTokens.length) {
      const prefixes = gotTokens.every((token, i) => {
        const w = wantTokens[i];
        return w !== undefined && (w.startsWith(token) || token.startsWith(w));
      });
      if (prefixes) score = Math.max(score, 0.55);
    }
    const initials = wantTokens.map((token) => token[0] ?? '').join('');
    if (initials && (got === initials || gotTokens.join('') === initials)) {
      score = Math.max(score, 0.6);
    }
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }
  return bestScore >= 0.4 ? best! : text;
}

/** Expected glyph → OCR glyphs allowed in its place. `{ '@': ['Q', 'C'], '5': 'S' }` */
export type OcrSwaps = Record<string, string | readonly string[]>;

/** How a field is allowed to clip when the value does not fit the box. */
export type OcrOverflow = 'start' | 'end' | 'both';

/** How to read a field's value. `clipboard` is click / select-all / copy. */
export type FieldRead = 'ocr' | 'clipboard';

const DEFAULT_OVERFLOW_SLOP = 2;

function allowedActuals(expectedChar: string, swaps?: OcrSwaps): Set<string> {
  const allowed = new Set<string>([expectedChar]);
  const extra = swaps?.[expectedChar];
  if (extra == null) return allowed;
  const values = typeof extra === 'string' ? [extra] : extra;
  for (const value of values) {
    for (const ch of value) allowed.add(ch);
  }
  return allowed;
}

function charsMatch(actual: string, expected: string, swaps?: OcrSwaps): boolean {
  const got = [...actual];
  const want = [...expected];
  if (got.length !== want.length) return false;
  return got.every((ch, i) => allowedActuals(want[i] ?? '', swaps).has(ch));
}

function charEq(actual: string, expected: string, swaps?: OcrSwaps): boolean {
  return allowedActuals(expected, swaps).has(actual);
}

function minKeep(wantLen: number): number {
  return Math.min(wantLen, Math.max(3, Math.ceil(wantLen * 0.5)));
}

function containsSlice(want: string[], slice: string[], swaps?: OcrSwaps): boolean {
  if (slice.length > want.length) return false;
  for (let i = 0; i <= want.length - slice.length; i++) {
    if (slice.every((ch, j) => charEq(ch, want[i + j] ?? '', swaps))) return true;
  }
  return false;
}

function overflowMatches(
  actual: string,
  expected: string,
  overflow: OcrOverflow,
  swaps?: OcrSwaps,
  slop = DEFAULT_OVERFLOW_SLOP,
): boolean {
  const got = [...actual];
  const want = [...expected];
  if (!want.length) return !got.length;
  const keep = minKeep(want.length);

  if (overflow === 'end') {
    let matched = 0;
    while (matched < got.length && matched < want.length && charEq(got[matched] ?? '', want[matched] ?? '', swaps)) {
      matched++;
    }
    return matched >= keep && (got.length - matched) <= slop;
  }

  if (overflow === 'start') {
    let matched = 0;
    while (
      matched < got.length
      && matched < want.length
      && charEq(got[got.length - 1 - matched] ?? '', want[want.length - 1 - matched] ?? '', swaps)
    ) {
      matched++;
    }
    return matched >= keep && (got.length - matched) <= slop;
  }

  for (let left = 0; left <= slop; left++) {
    for (let right = 0; right <= slop; right++) {
      if (left + right >= got.length) continue;
      const slice = got.slice(left, got.length - right);
      if (slice.length < keep) continue;
      if (containsSlice(want, slice, swaps)) return true;
    }
  }
  return false;
}

export function ocrTextMatches(
  actual: string,
  expected: string | RegExp,
  options: {
    swaps?: OcrSwaps;
    exact?: boolean;
    overflow?: OcrOverflow;
    overflowSlop?: number;
  } = {},
): boolean {
  if (expected instanceof RegExp) return expected.test(actual);
  if (options.overflow) {
    return overflowMatches(
      actual,
      expected,
      options.overflow,
      options.swaps,
      options.overflowSlop ?? DEFAULT_OVERFLOW_SLOP,
    );
  }
  if (options.exact) return charsMatch(actual, expected, options.swaps);
  if (actual.includes(expected)) return true;
  if (!options.swaps || !Object.keys(options.swaps).length) return false;
  const got = [...actual];
  const want = [...expected];
  if (want.length > got.length) return false;
  for (let i = 0; i <= got.length - want.length; i++) {
    if (charsMatch(got.slice(i, i + want.length).join(''), expected, options.swaps)) return true;
  }
  return false;
}

/**
 * OCR utility for extracting text from images using Tesseract.js
 */
export class OCRUtil {
  private worker: Worker | null = null;
  private language = 'eng';

  async initialize(language = 'eng'): Promise<void> {
    if (this.worker && this.language === language) return;
    await this.terminate();
    this.language = language;
    this.worker = await createWorker(language);
  }

  private ocrParams(options: { charset?: string; psm?: string; dpi?: string; whitelist?: boolean } = {}): Record<string, string> {
    const params: Record<string, string> = {
      tessedit_pageseg_mode: options.psm ?? '7',
      user_defined_dpi: options.dpi ?? '300',
      preserve_interword_spaces: '1',
    };
    if (options.whitelist === false) {
      // Empty string means "allow nothing" in Tesseract. Use a broad set so
      // a leftover field whitelist cannot stick, without blocking letters.
      params.tessedit_char_whitelist =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
        ` ~!@#$%^&*()-_=+[]{}|;:'",.<>/?\\\``;
    } else {
      params.tessedit_char_whitelist = options.charset
        || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@._- /';
    }
    return params;
  }

  private async ensureWorker(): Promise<Worker> {
    if (!this.worker) await this.initialize(this.language);
    if (!this.worker) throw new Error('OCR worker not initialized. Call initialize() first.');
    return this.worker;
  }

  /**
   * Extract text from an image buffer
   */
  async extractText(
    imageBuffer: Buffer,
    options: { charset?: string; psm?: string } = {},
  ): Promise<string> {
    const worker = await this.ensureWorker();
    await worker.setParameters(this.ocrParams(options));
    const { data } = await worker.recognize(imageBuffer);
    return normalizeOcrText(data.text);
  }

  /**
   * Extract text with confidence scores and bounding boxes
   */
  async extractDetailedText(imageBuffer: Buffer) {
    const worker = await this.ensureWorker();
    await worker.setParameters(this.ocrParams());
    const { data } = await worker.recognize(imageBuffer);
    return {
      text: data.text.trim(),
      confidence: data.confidence,
      words: (data as any).words?.map((word: any) => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox,
      })) || [],
      lines: (data as any).lines?.map((line: any) => ({
        text: line.text,
        confidence: line.confidence,
        bbox: line.bbox,
      })) || [],
    };
  }

  /**
   * Full-page word boxes for authoring (labels next to controls).
   * Sparse text mode, no charset whitelist.
   */
  async extractPageWords(imageBuffer: Buffer): Promise<Array<{
    text: string;
    confidence: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>> {
    const worker = await this.ensureWorker();
    await worker.setParameters(this.ocrParams({
      psm: '11',
      dpi: '96',
      whitelist: false,
    }));
    const { data } = await worker.recognize(imageBuffer, {}, { text: true, blocks: true });
    const words = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          for (const word of line.words || []) {
            const bbox = word.bbox;
            if (!bbox || bbox.x0 == null || bbox.y0 == null || bbox.x1 == null || bbox.y1 == null) continue;
            const width = bbox.x1 - bbox.x0;
            const height = bbox.y1 - bbox.y0;
            if (width < 3 || height < 5) continue;
            words.push({
              text: String(word.text || ''),
              confidence: Number(word.confidence) || 0,
              x: bbox.x0,
              y: bbox.y0,
              width,
              height,
            });
          }
        }
      }
    }
    return words;
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

// Singleton instance for reuse across tests
let sharedOCRUtil: OCRUtil | null = null;

/**
 * Get or create a shared OCR utility instance.
 * Uses `strategies.ocr.language` when set; falls back to 'eng'.
 */
export async function getOCRUtil(language?: string): Promise<OCRUtil> {
  const lang = language ?? globalOcrStrategy?.language ?? 'eng';
  if (!sharedOCRUtil) {
    sharedOCRUtil = new OCRUtil();
    await sharedOCRUtil.initialize(lang);
  }
  return sharedOCRUtil;
}

/**
 * Clean up the shared OCR utility
 */
export async function cleanupOCR(): Promise<void> {
  if (sharedOCRUtil) {
    await sharedOCRUtil.terminate();
    sharedOCRUtil = null;
  }
}
