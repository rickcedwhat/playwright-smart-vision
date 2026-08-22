import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import { Strategies, setClickStrategy, setFillStrategy, getClickStrategy, getFillStrategy } from './strategies.js';
import type { Rect } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rect: Rect = { x: 100, y: 200, width: 80, height: 40 };

function mockPage() {
  return {
    mouse: { click: vi.fn(), tripleclick: vi.fn() },
    keyboard: {
      press: vi.fn(),
      type: vi.fn(),
      insertText: vi.fn(),
    },
  } as unknown as Page;
}

// ---------------------------------------------------------------------------
// Strategies.Click
// ---------------------------------------------------------------------------

describe('Strategies.Click.center()', () => {
  it('returns the midpoint of the rect', () => {
    const pt = Strategies.Click.center().getPoint(rect);
    expect(pt).toEqual({ x: 140, y: 220 });
  });
});

describe('Strategies.Click.offset()', () => {
  it('{ x: 0, y: 0.5 } → left-center', () => {
    const pt = Strategies.Click.offset({ x: 0, y: 0.5 }).getPoint(rect);
    expect(pt).toEqual({ x: 100, y: 220 });
  });

  it('{ x: 1, y: 1 } → bottom-right corner', () => {
    const pt = Strategies.Click.offset({ x: 1, y: 1 }).getPoint(rect);
    expect(pt).toEqual({ x: 180, y: 240 });
  });

  it('{ x: 0.5, y: 0.5 } → same as center', () => {
    const pt = Strategies.Click.offset({ x: 0.5, y: 0.5 }).getPoint(rect);
    expect(pt).toEqual(Strategies.Click.center().getPoint(rect));
  });
});

describe('Strategies.Click.point(fn)', () => {
  it('delegates to the provided function', () => {
    const fn = vi.fn().mockReturnValue({ x: 10, y: 20 });
    const pt = Strategies.Click.point(fn).getPoint(rect);
    expect(fn).toHaveBeenCalledWith(rect);
    expect(pt).toEqual({ x: 10, y: 20 });
  });
});

// ---------------------------------------------------------------------------
// Strategies.Fill
// ---------------------------------------------------------------------------

describe('Strategies.Fill.selectAllType()', () => {
  it('click → Ctrl+A → Backspace → insertText', async () => {
    const page = mockPage();
    await Strategies.Fill.selectAllType().fill(page, rect, 'hello');
    expect(page.mouse.click).toHaveBeenCalledWith(140, 220);
    expect(page.keyboard.press).toHaveBeenCalledWith('ControlOrMeta+A');
    expect(page.keyboard.press).toHaveBeenCalledWith('Backspace');
    expect(page.keyboard.insertText).toHaveBeenCalledWith('hello');
    expect(page.keyboard.type).not.toHaveBeenCalled();
  });
});

describe('Strategies.Fill.tripleClickType()', () => {
  it('triple-click then insertText (no Ctrl+A)', async () => {
    const page = mockPage();
    await Strategies.Fill.tripleClickType().fill(page, rect, 'hello');
    expect(page.mouse.click).toHaveBeenCalledWith(140, 220, { clickCount: 3 });
    expect(page.keyboard.insertText).toHaveBeenCalledWith('hello');
    expect(page.keyboard.press).not.toHaveBeenCalled();
  });
});

describe('Strategies.Fill.clearAndType()', () => {
  it('click → Ctrl+A → Backspace → keyboard.type', async () => {
    const page = mockPage();
    await Strategies.Fill.clearAndType().fill(page, rect, 'hello');
    expect(page.mouse.click).toHaveBeenCalledWith(140, 220);
    expect(page.keyboard.press).toHaveBeenCalledWith('ControlOrMeta+A');
    expect(page.keyboard.press).toHaveBeenCalledWith('Backspace');
    expect(page.keyboard.type).toHaveBeenCalledWith('hello');
    expect(page.keyboard.insertText).not.toHaveBeenCalled();
  });
});

describe('Strategies.Fill.typeOnly()', () => {
  it('keyboard.type without any click or selection', async () => {
    const page = mockPage();
    await Strategies.Fill.typeOnly().fill(page, rect, 'hello');
    expect(page.keyboard.type).toHaveBeenCalledWith('hello');
    expect(page.mouse.click).not.toHaveBeenCalled();
    expect(page.keyboard.press).not.toHaveBeenCalled();
  });
});

describe('Strategies.Fill.charByChar()', () => {
  it('click then keyboard.type with delay', async () => {
    const page = mockPage();
    await Strategies.Fill.charByChar({ delay: 30 }).fill(page, rect, 'hi');
    expect(page.mouse.click).toHaveBeenCalledWith(140, 220);
    expect(page.keyboard.type).toHaveBeenCalledWith('hi', { delay: 30 });
  });
});

describe('Strategies.Fill.insertText()', () => {
  it('click then insertText without selection', async () => {
    const page = mockPage();
    await Strategies.Fill.insertText().fill(page, rect, 'hello');
    expect(page.mouse.click).toHaveBeenCalledWith(140, 220);
    expect(page.keyboard.insertText).toHaveBeenCalledWith('hello');
    expect(page.keyboard.press).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Strategies.Capture
// ---------------------------------------------------------------------------

describe('Strategies.Capture', () => {
  it('unhover() sets unhover:true with no point by default', () => {
    const cap = Strategies.Capture.unhover();
    expect(cap.unhover).toBe(true);
    expect(cap.unhoverPoint).toBeUndefined();
  });

  it('unhover({ point }) stores the point', () => {
    const cap = Strategies.Capture.unhover({ point: { x: 5, y: 10 } });
    expect(cap.unhover).toBe(true);
    expect(cap.unhoverPoint).toEqual({ x: 5, y: 10 });
  });

  it('noop() sets unhover:false', () => {
    expect(Strategies.Capture.noop().unhover).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Module-level state: setClickStrategy / setFillStrategy
// ---------------------------------------------------------------------------

describe('module-level strategy state', () => {
  afterEach(() => {
    setClickStrategy(undefined);
    setFillStrategy(undefined);
  });

  it('getClickStrategy() returns center by default', () => {
    const pt = getClickStrategy().getPoint(rect);
    expect(pt).toEqual({ x: 140, y: 220 });
  });

  it('setClickStrategy() overrides the default', () => {
    setClickStrategy(Strategies.Click.offset({ x: 0, y: 0 }));
    const pt = getClickStrategy().getPoint(rect);
    expect(pt).toEqual({ x: 100, y: 200 });
  });

  it('setClickStrategy(undefined) restores the default', () => {
    setClickStrategy(Strategies.Click.offset({ x: 0, y: 0 }));
    setClickStrategy(undefined);
    const pt = getClickStrategy().getPoint(rect);
    expect(pt).toEqual({ x: 140, y: 220 });
  });

  it('getFillStrategy() uses selectAllType by default', async () => {
    const page = mockPage();
    await getFillStrategy().fill(page, rect, 'x');
    expect(page.keyboard.press).toHaveBeenCalledWith('ControlOrMeta+A');
  });

  it('setFillStrategy() overrides the default', async () => {
    setFillStrategy(Strategies.Fill.typeOnly());
    const page = mockPage();
    await getFillStrategy().fill(page, rect, 'x');
    expect(page.keyboard.type).toHaveBeenCalledWith('x');
    expect(page.keyboard.press).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// presets sanity check
// ---------------------------------------------------------------------------

describe('presets', () => {
  beforeEach(() => { setFillStrategy(undefined); });
  afterEach(() => { setFillStrategy(undefined); });

  it('presets.guacamole.strategies.fill uses tripleClickType', async () => {
    const { presets } = await import('./presets.js');
    const page = mockPage();
    await presets.guacamole.strategies.fill.fill(page, rect, 'val');
    expect(page.mouse.click).toHaveBeenCalledWith(140, 220, { clickCount: 3 });
  });

  it('presets.rdp.strategies.fill uses charByChar with delay 30', async () => {
    const { presets } = await import('./presets.js');
    const page = mockPage();
    await presets.rdp.strategies.fill.fill(page, rect, 'val');
    expect(page.keyboard.type).toHaveBeenCalledWith('val', { delay: 30 });
  });
});
