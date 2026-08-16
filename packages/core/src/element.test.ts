import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScreenElement } from './element.js';
import { expectTimeout } from './ocr-step.js';
import type { ElementResult } from './types.js';
import type { LiveScreen, WaitForOptions, MatchOptions } from './element.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const zeroRect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * A mock LiveScreen whose elementResult cycles through `sequence` on each
 * ensureFresh() call. The last entry is held once the sequence is exhausted.
 */
function makeLiveScreen(sequence: Array<Partial<ElementResult>>): LiveScreen {
  let callCount = 0;
  return {
    async ensureFresh() { callCount++; },
    elementResult(name: string): ElementResult | undefined {
      const idx = Math.min(Math.max(callCount - 1, 0), sequence.length - 1);
      return { name, value: '', location: zeroRect, isEmpty: true, ...sequence[idx] };
    },
    matchOptions(_name: string, _part?: string): MatchOptions { return {}; },
    markDirty() {},
    async waitForElement(_name: string, _opts?: WaitForOptions) {},
    async paintOverlay() {},
    async hideOverlay() {},
  };
}

function makeElement(result: Partial<ElementResult>, live?: LiveScreen): ScreenElement {
  const full: ElementResult = { name: 'field', value: '', location: zeroRect, isEmpty: true, ...result };
  return new ScreenElement(full, undefined, live);
}

// ---------------------------------------------------------------------------
// expectTimeout
// ---------------------------------------------------------------------------

describe('expectTimeout', () => {
  it('returns the provided override unchanged', () => {
    expect(expectTimeout(0)).toBe(0);
    expect(expectTimeout(3_000)).toBe(3_000);
    expect(expectTimeout(10_000)).toBe(10_000);
  });

  it('returns 0 outside a Playwright test (test.info() throws)', () => {
    // In Vitest, Playwright's test.info() throws — expectTimeout() should catch that.
    expect(expectTimeout()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// retryAssertion — tested through toBeFilled / toBeEmpty / toHaveVariant
// ---------------------------------------------------------------------------

describe('retryAssertion — no live screen (single-shot always)', () => {
  it('passes immediately when condition holds', async () => {
    const el = makeElement({ isEmpty: false });
    await expect(el.toBeFilled()).resolves.toBeUndefined();
  });

  it('throws immediately when condition does not hold', async () => {
    const el = makeElement({ isEmpty: true });
    await expect(el.toBeFilled()).rejects.toThrow(/is not filled/);
  });

  it('does not retry even when a non-zero timeout is passed', async () => {
    // Without a LiveScreen, retryAssertion short-circuits after the first check.
    const el = makeElement({ isEmpty: true });
    await expect(el.toBeFilled({ timeout: 5_000 })).rejects.toThrow(/is not filled/);
  });
});

describe('retryAssertion — timeout: 0 (explicit single-shot)', () => {
  it('asserts once and passes', async () => {
    const live = makeLiveScreen([{ isEmpty: false }]);
    const el = makeElement({ isEmpty: true }, live);
    await expect(el.toBeFilled({ timeout: 0 })).resolves.toBeUndefined();
  });

  it('asserts once and throws — ensureFresh called exactly once', async () => {
    const live = makeLiveScreen([{ isEmpty: true }]);
    const spy = vi.spyOn(live, 'ensureFresh');
    const el = makeElement({ isEmpty: true }, live);
    await expect(el.toBeFilled({ timeout: 0 })).rejects.toThrow(/is not filled/);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('retryAssertion — live screen, passes on retry', () => {
  afterEach(() => vi.useRealTimers());

  it('toBeFilled: retries until the element becomes filled', async () => {
    vi.useFakeTimers();
    const live = makeLiveScreen([
      { isEmpty: true },   // first check: fails
      { isEmpty: false },  // after retry: passes
    ]);
    const el = makeElement({ isEmpty: true }, live);
    const p = el.toBeFilled({ timeout: 1_000 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });

  it('toBeEmpty: retries until the element becomes empty', async () => {
    vi.useFakeTimers();
    const live = makeLiveScreen([
      { isEmpty: false },  // first check: fails
      { isEmpty: true },   // after retry: passes
    ]);
    const el = makeElement({ isEmpty: false }, live);
    const p = el.toBeEmpty({ timeout: 1_000 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });

  it('toHaveVariant: retries until the variant matches', async () => {
    vi.useFakeTimers();
    const live = makeLiveScreen([
      { variant: 'enabled' },   // first check: wrong variant
      { variant: 'disabled' },  // after retry: matches
    ]);
    const el = makeElement({ variant: 'enabled' }, live);
    const p = el.toHaveVariant('disabled', { timeout: 1_000 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });

  it('toBeChecked: retries until the checkbox becomes checked', async () => {
    vi.useFakeTimers();
    const live = makeLiveScreen([
      { value: 'unchecked' },
      { value: 'checked' },
    ]);
    const el = makeElement({ value: 'unchecked' }, live);
    const p = el.toBeChecked({ timeout: 1_000 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });
});

describe('retryAssertion — live screen, times out', () => {
  afterEach(() => vi.useRealTimers());

  it('throws the last error message after timeout', async () => {
    vi.useFakeTimers();
    const live = makeLiveScreen([{ isEmpty: true }]); // never fills
    const el = makeElement({ isEmpty: true }, live);
    const rejection = el.toBeFilled({ timeout: 300 });
    // Attach .catch() before advancing timers to prevent unhandled-rejection warning.
    const caught = rejection.catch((e: Error) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/is not filled/);
  });

  it('throws with the correct variant in the error message', async () => {
    vi.useFakeTimers();
    const live = makeLiveScreen([{ variant: 'enabled' }]);
    const el = makeElement({ variant: 'enabled' }, live);
    const rejection = el.toHaveVariant('disabled', { timeout: 300 });
    const caught = rejection.catch((e: Error) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/disabled/);
    expect((err as Error).message).toMatch(/enabled/);
  });
});

// ---------------------------------------------------------------------------
// toHaveText / toHaveValue — assertion logic (no retry; timeout implicitly 0 outside test)
// ---------------------------------------------------------------------------

describe('toHaveText', () => {
  it('passes when actual contains expected substring', async () => {
    const el = makeElement({ value: 'HELLO WORLD' });
    await expect(el.toHaveText('HELLO')).resolves.toBeUndefined();
  });

  it('passes for a matching RegExp', async () => {
    const el = makeElement({ value: 'ABC123' });
    await expect(el.toHaveText(/^\w+\d+$/)).resolves.toBeUndefined();
  });

  it('throws when actual does not match', async () => {
    const el = makeElement({ value: 'WORLD' });
    await expect(el.toHaveText('HELLO')).rejects.toThrow(/does not have text/);
  });

  it('passes with a swap substitution', async () => {
    const el = makeElement({ value: 'USER Q EXAMPLE.COM' });
    await expect(
      el.toHaveText('USER @ EXAMPLE.COM', { swaps: { '@': 'Q' } }),
    ).resolves.toBeUndefined();
  });
});

describe('toHaveValue', () => {
  it('passes on exact match', async () => {
    const el = makeElement({ value: '760 543 2987' });
    await expect(el.toHaveValue('760 543 2987')).resolves.toBeUndefined();
  });

  it('throws when actual differs', async () => {
    const el = makeElement({ value: '760 543 2987' });
    await expect(el.toHaveValue('555 555 5555')).rejects.toThrow(/does not have value/);
  });

  it('throws when actual is only a substring of expected (exact by default)', async () => {
    const el = makeElement({ value: '760' });
    await expect(el.toHaveValue('760 543 2987')).rejects.toThrow(/does not have value/);
  });
});

// ---------------------------------------------------------------------------
// toBeChecked / toBeUnchecked — state assertions
// ---------------------------------------------------------------------------

describe('toBeChecked / toBeUnchecked', () => {
  it('toBeChecked passes when value is "checked"', async () => {
    const el = makeElement({ value: 'checked' });
    await expect(el.toBeChecked()).resolves.toBeUndefined();
  });

  it('toBeChecked throws when value is "unchecked"', async () => {
    const el = makeElement({ value: 'unchecked' });
    await expect(el.toBeChecked()).rejects.toThrow(/is not checked/);
  });

  it('toBeUnchecked passes when value is "unchecked"', async () => {
    const el = makeElement({ value: 'unchecked' });
    await expect(el.toBeUnchecked()).resolves.toBeUndefined();
  });

  it('toBeUnchecked throws when value is "checked"', async () => {
    const el = makeElement({ value: 'checked' });
    await expect(el.toBeUnchecked()).rejects.toThrow(/is not unchecked/);
  });
});
