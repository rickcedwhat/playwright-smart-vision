import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ocrTextMatches, normalizeOcrText, charsetForField, charsetToWhitelist, setOcrStrategy, getOcrStrategy, resolveOcrCharset } from './ocr.js';

// ---------------------------------------------------------------------------
// ocrTextMatches
// ---------------------------------------------------------------------------

describe('ocrTextMatches — RegExp', () => {
  it('matches when the pattern tests true', () => {
    expect(ocrTextMatches('ABC123', /^ABC/)).toBe(true);
  });

  it('does not match when the pattern tests false', () => {
    expect(ocrTextMatches('XYZ', /^ABC/)).toBe(false);
  });
});

describe('ocrTextMatches — plain string (default: substring / swap-aware)', () => {
  it('matches an identical string', () => {
    expect(ocrTextMatches('hello', 'hello')).toBe(true);
  });

  it('matches when expected is a substring of actual', () => {
    expect(ocrTextMatches('hello world', 'hello')).toBe(true);
  });

  it('does not match unrelated strings', () => {
    expect(ocrTextMatches('world', 'hello')).toBe(false);
  });

  it('does not match when expected is longer than actual', () => {
    expect(ocrTextMatches('hi', 'hello')).toBe(false);
  });

  it('matches an empty expected against any actual', () => {
    expect(ocrTextMatches('anything', '')).toBe(true);
  });
});

describe('ocrTextMatches — swaps', () => {
  it('accepts an allowed swap glyph', () => {
    // OCR reads '@' as 'Q'
    expect(ocrTextMatches('USER Q EXAMPLE.COM', 'USER @ EXAMPLE.COM', { swaps: { '@': 'Q' } })).toBe(true);
  });

  it('accepts one of multiple allowed swap glyphs', () => {
    expect(ocrTextMatches('5NPDH4AE1DH', '5NPDH4AE1DH', { swaps: { '0': ['O', 'D'] } })).toBe(true);
    expect(ocrTextMatches('SNPDH4AE1DH', '5NPDH4AE1DH', { swaps: { '5': 'S' } })).toBe(true);
  });

  it('rejects a glyph that is not in the swap list', () => {
    expect(ocrTextMatches('USER Z EXAMPLE.COM', 'USER @ EXAMPLE.COM', { swaps: { '@': 'Q' } })).toBe(false);
  });

  it('falls back to substring match when no swap matches', () => {
    // no swaps needed — direct substring match wins
    expect(ocrTextMatches('HELLO WORLD', 'HELLO', {})).toBe(true);
  });
});

describe('ocrTextMatches — exact mode', () => {
  it('requires the full string to match char by char', () => {
    expect(ocrTextMatches('hello', 'hello', { exact: true })).toBe(true);
  });

  it('rejects a longer actual with trailing content', () => {
    expect(ocrTextMatches('hello world', 'hello', { exact: true })).toBe(false);
  });

  it('accepts exact match with swaps', () => {
    expect(ocrTextMatches('SNPDH', '5NPDH', { exact: true, swaps: { '5': 'S' } })).toBe(true);
  });

  it('rejects mismatched length even with swaps', () => {
    expect(ocrTextMatches('SN', '5NPDH', { exact: true, swaps: { '5': 'S' } })).toBe(false);
  });
});

describe('ocrTextMatches — overflow: end (value clips at the right)', () => {
  it('matches when actual is a left-anchored prefix of expected', () => {
    // Field shows "760 54" instead of "760 543 2987" (clipped at right)
    expect(ocrTextMatches('760 54', '760 543 2987', { overflow: 'end' })).toBe(true);
  });

  it('requires a minimum number of chars to be present', () => {
    // 'keep' for a 12-char expected = max(3, ceil(12*0.5)) = 6, so fewer than 6 leading chars fails
    expect(ocrTextMatches('76', '760 543 2987', { overflow: 'end' })).toBe(false);
  });

  it('rejects if the actual chars do not match the start of expected', () => {
    expect(ocrTextMatches('XXX 543', '760 543 2987', { overflow: 'end' })).toBe(false);
  });
});

describe('ocrTextMatches — overflow: start (value clips at the left)', () => {
  // minKeep for a 5-char expected = max(3, ceil(5*0.5)) = 3, so ≥3 suffix chars are required.
  it('matches when actual is a right-anchored suffix of expected', () => {
    expect(ocrTextMatches('LLO', 'HELLO', { overflow: 'start' })).toBe(true);
  });

  it('rejects if tail chars do not match end of expected', () => {
    expect(ocrTextMatches('XXX', 'HELLO', { overflow: 'start' })).toBe(false);
  });
});

describe('ocrTextMatches — overflow: both (clipped on either side)', () => {
  // minKeep for a 5-char expected = 3, so ≥3 interior chars (after slop trim) are required.
  it('matches a middle slice of expected', () => {
    expect(ocrTextMatches('ELL', 'HELLO', { overflow: 'both' })).toBe(true);
  });

  it('rejects a string that does not appear in expected', () => {
    expect(ocrTextMatches('XYZ', 'HELLO', { overflow: 'both' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeOcrText
// ---------------------------------------------------------------------------

describe('normalizeOcrText', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeOcrText('  hello  ')).toBe('hello');
  });

  it('collapses newlines to a single space', () => {
    expect(normalizeOcrText('line1\nline2')).toBe('line1 line2');
  });

  it('collapses multiple newlines', () => {
    expect(normalizeOcrText('a\n\n\nb')).toBe('a b');
  });

  it('handles an empty string', () => {
    expect(normalizeOcrText('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// charsetForField
// ---------------------------------------------------------------------------

describe('charsetForField', () => {
  it('returns undefined for checkbox type', () => {
    expect(charsetForField('active', 'checkbox')).toBeUndefined();
  });

  it('returns email charset when name includes "email"', () => {
    const charset = charsetForField('email');
    expect(charset).toContain('@');
  });

  it('returns digits charset for phone fields', () => {
    const charset = charsetForField('homePhone');
    expect(charset).not.toContain('A');
  });

  it('returns digits charset for year fields', () => {
    const charset = charsetForField('year');
    expect(charset).not.toContain('A');
  });

  it('returns vin charset when name includes "vin"', () => {
    const charset = charsetForField('vin');
    expect(charset).toContain('A');
    expect(charset).toContain('0');
  });

  it('honours an explicit preset over the name heuristic', () => {
    const digits = charsetForField('email', '', 'digits');
    expect(digits).not.toContain('@');
  });

  it('returns text charset as the default', () => {
    const charset = charsetForField('customerNumber');
    expect(charset).toContain('A');
    expect(charset).toContain('0');
    expect(charset).toContain(' ');
  });
});

// ---------------------------------------------------------------------------
// setOcrStrategy / getOcrStrategy / resolveOcrCharset
// ---------------------------------------------------------------------------

describe('setOcrStrategy / getOcrStrategy', () => {
  beforeEach(() => setOcrStrategy(undefined));
  afterEach(() => setOcrStrategy(undefined));

  it('returns undefined when no strategy is set', () => {
    expect(getOcrStrategy()).toBeUndefined();
  });

  it('stores and returns the strategy', () => {
    const strategy = { defaultCharset: 'digits' };
    setOcrStrategy(strategy);
    expect(getOcrStrategy()).toBe(strategy);
  });

  it('clears the strategy when set to undefined', () => {
    setOcrStrategy({ defaultCharset: 'digits' });
    setOcrStrategy(undefined);
    expect(getOcrStrategy()).toBeUndefined();
  });
});

describe('resolveOcrCharset', () => {
  beforeEach(() => setOcrStrategy(undefined));
  afterEach(() => setOcrStrategy(undefined));

  it('returns undefined when no strategy is set', () => {
    expect(resolveOcrCharset('phoneNumber')).toBeUndefined();
  });

  it('returns defaultCharset when no infer map matches', () => {
    setOcrStrategy({ defaultCharset: 'alnum' });
    expect(resolveOcrCharset('customerName')).toBe('alnum');
  });

  it('returns undefined when strategy has neither infer nor defaultCharset', () => {
    setOcrStrategy({ swaps: { '@': 'Q' } });
    expect(resolveOcrCharset('email')).toBeUndefined();
  });

  it('matches infer map by substring (case-insensitive)', () => {
    setOcrStrategy({ infer: { phone: 'digits', email: 'email' } });
    expect(resolveOcrCharset('phoneNumber')).toBe('digits');
    expect(resolveOcrCharset('PHONE')).toBe('digits');
    expect(resolveOcrCharset('emailAddress')).toBe('email');
  });

  it('infer match takes priority over defaultCharset', () => {
    setOcrStrategy({ defaultCharset: 'text', infer: { vin: 'vin' } });
    expect(resolveOcrCharset('vehicleVin')).toBe('vin');
    expect(resolveOcrCharset('customerName')).toBe('text');
  });

  it('returns first matching infer key when multiple keys match', () => {
    setOcrStrategy({ infer: { phone: 'digits', phoneNumber: 'alnum' } });
    const result = resolveOcrCharset('phoneNumber');
    expect(['digits', 'alnum']).toContain(result);
  });
});

// ---------------------------------------------------------------------------
// charsetToWhitelist
// ---------------------------------------------------------------------------

describe('charsetToWhitelist', () => {
  it('expands a single uppercase range', () => {
    const wl = charsetToWhitelist({ only: ['A-Z'] });
    expect(wl).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });

  it('expands a digit range', () => {
    const wl = charsetToWhitelist({ only: ['0-9'] });
    expect(wl).toBe('0123456789');
  });

  it('includes literal single chars', () => {
    const wl = charsetToWhitelist({ only: ['@', '.', '_'] });
    expect([...wl].sort().join('')).toBe('.@_');
  });

  it('combines ranges and literals', () => {
    const wl = charsetToWhitelist({ only: ['A-C', '0', '@'] });
    expect([...wl].sort().join('')).toBe('0@ABC');
  });

  it('removes excluded chars from only', () => {
    const wl = charsetToWhitelist({ only: ['A-Z'], exclude: ['I', 'O', 'Q'] });
    expect(wl).not.toContain('I');
    expect(wl).not.toContain('O');
    expect(wl).not.toContain('Q');
    expect(wl.length).toBe(23);
  });

  it('exclude of a char not in only is a no-op', () => {
    const wl = charsetToWhitelist({ only: ['A-C'], exclude: ['Z'] });
    expect([...wl].sort().join('')).toBe('ABC');
  });

  it('expands a Unicode range (Latin-1 Supplement)', () => {
    const wl = charsetToWhitelist({ only: ['À-Â'] });
    expect(wl).toBe('ÀÁÂ');
  });

  it('throws when only is empty', () => {
    expect(() => charsetToWhitelist({ only: [] })).toThrow();
  });

  it('throws on invalid range where start > end', () => {
    expect(() => charsetToWhitelist({ only: ['Z-A'] })).toThrow();
  });
});
