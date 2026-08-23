import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addScreenHandler, removeScreenHandler, clearScreenHandlers, runHandlers } from './screen-handler.js';
import { ScreenResult } from './screen-result.js';
import { ScreenElement } from './element.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExtractor(confidence = 0.95) {
  return {
    loadForms: vi.fn().mockResolvedValue(undefined),
    locateOnScreenshot: vi.fn().mockResolvedValue({
      name: 'ok',
      value: '',
      location: { x: 10, y: 20, width: 80, height: 30 },
      confidence,
      isEmpty: true,
    }),
    extractElements: vi.fn().mockResolvedValue({
      elements: [{ name: 'ok', value: '', location: { x: 10, y: 20, width: 80, height: 30 }, isEmpty: false }],
      totalElements: 1,
      filledElements: 1,
      emptyElements: 0,
    }),
  };
}

function makeHost(extractor = makeExtractor()) {
  return {
    extractor,
    screen: {
      name: 'license-warning',
      blankScreenPath: '/tmp/blank.png',
      ready: 'ok',
      elementConfigs: [
        { name: 'ok', templatePath: '/tmp/ok.png' },
        { name: 'cancel', templatePath: '/tmp/cancel.png' },
      ],
    },
    shotDir: '/tmp/shots',
  };
}

function makePage() {
  return {
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
    mouse: { click: vi.fn() },
  } as unknown as import('@playwright/test').Page;
}

// Stub loadScreen so handlers can be added without touching disk
vi.mock('./configure.js', () => ({
  loadScreen: vi.fn((name: string) => ({
    name,
    blankScreenPath: `/tmp/${name}/blank.png`,
    ready: 'ok',
    elementConfigs: [
      { name: 'ok', templatePath: `/tmp/${name}/ok.png` },
      { name: 'dismiss-btn', templatePath: `/tmp/${name}/dismiss-btn.png` },
    ],
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('addScreenHandler / removeScreenHandler', () => {
  beforeEach(() => {
    clearScreenHandlers();
  });

  it('returns a cleanup function that removes the handler', async () => {
    const fn = vi.fn();
    const cleanup = addScreenHandler('license-warning', fn);
    cleanup();
    const host = makeHost();
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(fn).not.toHaveBeenCalled();
  });

  it('removeScreenHandler removes by target string', async () => {
    const fn = vi.fn();
    addScreenHandler('license-warning', fn);
    removeScreenHandler('license-warning');
    const host = makeHost();
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(fn).not.toHaveBeenCalled();
  });

  it('multiple handlers for the same target are independently removable', async () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const cleanup1 = addScreenHandler('license-warning', fn1, { noWaitAfter: true });
    addScreenHandler('license-warning', fn2, { noWaitAfter: true });
    cleanup1();
    const host = makeHost();
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledOnce();
  });
});

describe('runHandlers — screen form', () => {
  beforeEach(() => {
    clearScreenHandlers();
  });

  it('fires when detection confidence is above threshold', async () => {
    const fn = vi.fn();
    addScreenHandler('license-warning', fn, { noWaitAfter: true });
    const host = makeHost(makeExtractor(0.95));
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(fn).toHaveBeenCalledOnce();
  });

  it('does not fire when confidence is below threshold', async () => {
    const fn = vi.fn();
    addScreenHandler('license-warning', fn, { noWaitAfter: true });
    const host = makeHost(makeExtractor(0.3));
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(fn).not.toHaveBeenCalled();
  });

  it('passes a ScreenResult to the callback', async () => {
    let received: unknown;
    addScreenHandler('license-warning', async (s) => { received = s; }, { noWaitAfter: true });
    const host = makeHost();
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(received).toBeInstanceOf(ScreenResult);
  });

  it('respects times: 1 — fires once then removes itself', async () => {
    const fn = vi.fn();
    addScreenHandler('license-warning', fn, { times: 1, noWaitAfter: true });
    const host = makeHost();
    await runHandlers('/tmp/shot.png', host, makePage());
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(fn).toHaveBeenCalledOnce();
  });

  it('fires up to times: 2', async () => {
    const fn = vi.fn();
    addScreenHandler('license-warning', fn, { times: 2, noWaitAfter: true });
    const host = makeHost();
    await runHandlers('/tmp/shot.png', host, makePage());
    await runHandlers('/tmp/shot.png', host, makePage());
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not re-enter while the handler is active', async () => {
    const calls: string[] = [];
    addScreenHandler('license-warning', async () => {
      calls.push('enter');
      const host = makeHost();
      // simulate a nested runHandlers call (e.g. from a click inside the handler)
      await runHandlers('/tmp/shot.png', host, makePage());
      calls.push('exit');
    }, { noWaitAfter: true });
    const host = makeHost();
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(calls).toEqual(['enter', 'exit']);
  });
});

describe('runHandlers — dotted element form', () => {
  beforeEach(() => {
    clearScreenHandlers();
  });

  it('passes a ScreenElement to the callback', async () => {
    let received: unknown;
    addScreenHandler('license-warning.dismiss-btn', async (el) => { received = el; }, { noWaitAfter: true });
    const host = makeHost();
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(received).toBeInstanceOf(ScreenElement);
  });

  it('fires when detection confidence is above threshold', async () => {
    const fn = vi.fn();
    addScreenHandler('license-warning.dismiss-btn', fn, { noWaitAfter: true });
    const host = makeHost(makeExtractor(0.9));
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(fn).toHaveBeenCalledOnce();
  });

  it('does not fire when confidence is below threshold', async () => {
    const fn = vi.fn();
    addScreenHandler('license-warning.dismiss-btn', fn, { noWaitAfter: true });
    const host = makeHost(makeExtractor(0.2));
    await runHandlers('/tmp/shot.png', host, makePage());
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('noWaitAfter option', () => {
  beforeEach(() => {
    clearScreenHandlers();
  });

  it('skips the wait-until-gone poll when noWaitAfter is true', async () => {
    const fn = vi.fn();
    addScreenHandler('license-warning', fn, { noWaitAfter: true });
    const page = makePage();
    const host = makeHost();
    await runHandlers('/tmp/shot.png', host, page);
    expect(fn).toHaveBeenCalledOnce();
    // No page.screenshot call for the gone-poll (the mock extractor would keep returning high confidence)
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it('waits until gone when noWaitAfter is false — polls page.screenshot until low confidence', async () => {
    const fn = vi.fn();
    addScreenHandler('license-warning', fn); // noWaitAfter defaults to false
    const extractor = makeExtractor(0.95);
    // Detection returns high confidence; gone-poll returns low confidence on the first poll
    extractor.locateOnScreenshot
      .mockResolvedValueOnce({ name: 'ok', value: '', location: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.95, isEmpty: true }) // detection
      .mockResolvedValueOnce({ name: 'ok', value: '', location: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.1, isEmpty: true }); // gone-poll succeeds
    const host = makeHost(extractor);
    const page = makePage();
    await runHandlers('/tmp/shot.png', host, page);
    expect(fn).toHaveBeenCalledOnce();
    // page.screenshot should be called at least once for the gone-poll
    expect(page.screenshot).toHaveBeenCalled();
  });
});
