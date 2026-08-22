import { describe, it, expect, vi, afterEach } from 'vitest';
import { findAllMatches, TextElement } from './text-element.js';
import type { WordBox, TextMatch } from './text-element.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function word(text: string, x: number, y: number, w = 50, h = 16, conf = 90): WordBox {
  return { text, confidence: conf, x, y, width: w, height: h };
}

function match(text: string, conf = 0.9): TextMatch {
  return { location: { x: 0, y: 0, width: 50, height: 16 }, confidence: conf, text };
}

// ---------------------------------------------------------------------------
// findAllMatches — string queries
// ---------------------------------------------------------------------------

describe('findAllMatches — string', () => {
  it('matches a single word', () => {
    const words = [word('Hello', 0, 0), word('World', 60, 0)];
    const hits = findAllMatches(words, 'Hello');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toBe('Hello');
  });

  it('matches a two-word phrase', () => {
    const words = [word('Hello', 0, 0), word('World', 60, 0)];
    const hits = findAllMatches(words, 'Hello World');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toBe('Hello World');
  });

  it('is case-insensitive', () => {
    const words = [word('SUBMIT', 0, 0)];
    expect(findAllMatches(words, 'submit')).toHaveLength(1);
  });

  it('strips punctuation when comparing', () => {
    const words = [word('Done!', 0, 0)];
    expect(findAllMatches(words, 'Done')).toHaveLength(1);
  });

  it('does not match across lines (different y)', () => {
    // word at y=0 and y=30 — more than 6px apart, different lines
    const words = [word('Hello', 0, 0), word('World', 0, 30)];
    const hits = findAllMatches(words, 'Hello World');
    expect(hits).toHaveLength(0);
  });

  it('returns empty when no match', () => {
    const words = [word('Foo', 0, 0)];
    expect(findAllMatches(words, 'Bar')).toHaveLength(0);
  });

  it('confidence is average of word confidences / 100', () => {
    const words = [word('A', 0, 0, 50, 16, 80), word('B', 60, 0, 50, 16, 60)];
    const hits = findAllMatches(words, 'A B');
    expect(hits[0]!.confidence).toBeCloseTo(0.7);
  });

  it('location is bounding box of all matched words', () => {
    const words = [word('First', 10, 5, 40, 16), word('Last', 70, 3, 50, 20)];
    const hits = findAllMatches(words, 'First Last');
    const loc = hits[0]!.location;
    expect(loc.x).toBe(10);
    expect(loc.y).toBe(3);
    expect(loc.width).toBe(110); // (70+50) - 10
    expect(loc.height).toBe(20); // max(5+16, 3+20) - 3 = 23 - 3
  });
});

// ---------------------------------------------------------------------------
// findAllMatches — regex queries
// ---------------------------------------------------------------------------

describe('findAllMatches — regex', () => {
  it('matches a regex against a single word', () => {
    const words = [word('Order-12345', 0, 0)];
    const hits = findAllMatches(words, /Order-\d+/);
    expect(hits).toHaveLength(1);
  });

  it('matches a regex spanning two words', () => {
    const words = [word('Aug', 0, 0), word('22', 60, 0)];
    const hits = findAllMatches(words, /Aug \d+/);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toBe('Aug 22');
  });

  it('returns empty when regex does not match', () => {
    const words = [word('Foo', 0, 0)];
    expect(findAllMatches(words, /\d{4}/)).toHaveLength(0);
  });

  it('caps window size at 4 words for regex', () => {
    // 5-word line — a regex match on words 1-4 is fine, but not 1-5
    const ws = [
      word('a', 0, 0), word('b', 20, 0), word('c', 40, 0),
      word('d', 60, 0), word('e', 80, 0),
    ];
    const hits = findAllMatches(ws, /a b c d/);
    expect(hits).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findAllMatches — line grouping
// ---------------------------------------------------------------------------

describe('findAllMatches — line grouping', () => {
  it('groups words within 6px y-center into the same line', () => {
    const words = [word('A', 0, 0), word('B', 60, 4)]; // cy=8 and cy=12 → diff=4 ≤ 6
    const hits = findAllMatches(words, 'A B');
    expect(hits).toHaveLength(1);
  });

  it('does not group words more than 6px apart', () => {
    const words = [word('A', 0, 0), word('B', 0, 20)]; // cy=8 and cy=28 → diff=20
    const hits = findAllMatches(words, 'A B');
    expect(hits).toHaveLength(0);
  });

  it('groups a third word within 6px of a non-first group member', () => {
    // cy: A=8, B=10, C=16 — A and B join (|10-8|=2≤6); C is >6 from A but ≤6 from B
    const words = [word('A', 0, 0), word('B', 60, 2), word('C', 120, 8)];
    const hits = findAllMatches(words, 'A B C');
    expect(hits).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TextElement — static (no live page)
// ---------------------------------------------------------------------------

describe('TextElement (static, no page)', () => {
  it('bounds() returns match location', () => {
    const m = match('Submit');
    m.location = { x: 10, y: 20, width: 60, height: 18 };
    const el = new TextElement(m, 'Submit');
    expect(el.bounds()).toEqual({ x: 10, y: 20, width: 60, height: 18 });
  });

  it('text() returns raw matched text', () => {
    const el = new TextElement(match('Hello World'), 'Hello World');
    expect(el.text()).toBe('Hello World');
  });

  it('click() throws without a page', async () => {
    const el = new TextElement(match('Btn'), 'Btn');
    await expect(el.click()).rejects.toThrow('click() requires a live page');
  });

  it('toBeVisible() passes when confidence is high enough', async () => {
    const el = new TextElement(match('OK', 0.95), 'OK');
    await expect(el.toBeVisible()).resolves.toBeUndefined();
  });

  it('toBeVisible() throws when confidence is below threshold', async () => {
    const el = new TextElement(match('OK', 0.3), 'OK');
    await expect(el.toBeVisible()).rejects.toThrow(/not visible/i);
  });

  it('toBeHidden() passes when confidence is below threshold', async () => {
    const el = new TextElement(match('Gone', 0.3), 'Gone');
    await expect(el.toBeHidden()).resolves.toBeUndefined();
  });

  it('toBeHidden() throws when text is still visible', async () => {
    const el = new TextElement(match('Gone', 0.95), 'Gone');
    await expect(el.toBeHidden()).rejects.toThrow(/still visible/i);
  });

  it('toHaveText() passes when text matches string', async () => {
    const el = new TextElement(match('Submit'), 'Submit');
    await expect(el.toHaveText('Submit')).resolves.toBeUndefined();
  });

  it('toHaveText() passes when text matches regex', async () => {
    const el = new TextElement(match('Order-123'), /Order-\d+/);
    await expect(el.toHaveText(/Order-\d+/)).resolves.toBeUndefined();
  });

  it('toHaveText() throws on mismatch without page', async () => {
    const el = new TextElement(match('Foo'), 'Foo');
    await expect(el.toHaveText('Bar')).rejects.toThrow(/Expected text/i);
  });

  it('waitFor() delegates to toBeVisible()', async () => {
    const el = new TextElement(match('OK', 0.95), 'OK');
    await expect(el.waitFor()).resolves.toBeUndefined();
  });
});
