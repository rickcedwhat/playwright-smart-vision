import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import { configure, resetGlobalConfig } from './configure.js';
import { UNHOVER_POINT, setUnhoverPoint, unhoverBeforeCapture } from './unhover.js';

function mockPage(move = vi.fn()) {
  return { mouse: { move } } as unknown as Page;
}

describe('unhoverBeforeCapture', () => {
  beforeEach(() => {
    resetGlobalConfig();
    setUnhoverPoint(undefined);
  });

  afterEach(() => {
    setUnhoverPoint(undefined);
  });

  it('moves to the neutral corner by default', async () => {
    const move = vi.fn();
    await unhoverBeforeCapture(mockPage(move));
    expect(move).toHaveBeenCalledWith(UNHOVER_POINT.x, UNHOVER_POINT.y);
  });

  it('skips when configure({ unhoverBeforeCapture: false })', async () => {
    await configure({ unhoverBeforeCapture: false });
    const move = vi.fn();
    await unhoverBeforeCapture(mockPage(move));
    expect(move).not.toHaveBeenCalled();
  });

  it('per-call false overrides configure true', async () => {
    await configure({ unhoverBeforeCapture: true });
    const move = vi.fn();
    await unhoverBeforeCapture(mockPage(move), false);
    expect(move).not.toHaveBeenCalled();
  });

  it('per-call true overrides configure false', async () => {
    await configure({ unhoverBeforeCapture: false });
    const move = vi.fn();
    await unhoverBeforeCapture(mockPage(move), true);
    expect(move).toHaveBeenCalledWith(UNHOVER_POINT.x, UNHOVER_POINT.y);
  });

  it('configure({ unhoverPoint }) moves to the configured point', async () => {
    await configure({ unhoverPoint: { x: 100, y: 200 } });
    const move = vi.fn();
    await unhoverBeforeCapture(mockPage(move));
    expect(move).toHaveBeenCalledWith(100, 200);
  });

  it('setUnhoverPoint moves to the configured point', async () => {
    setUnhoverPoint({ x: 50, y: 75 });
    const move = vi.fn();
    await unhoverBeforeCapture(mockPage(move));
    expect(move).toHaveBeenCalledWith(50, 75);
  });

  it('setUnhoverPoint takes priority over configure({ unhoverPoint })', async () => {
    await configure({ unhoverPoint: { x: 100, y: 200 } });
    setUnhoverPoint({ x: 10, y: 20 });
    const move = vi.fn();
    await unhoverBeforeCapture(mockPage(move));
    expect(move).toHaveBeenCalledWith(10, 20);
  });

  it('falls back to UNHOVER_POINT when setUnhoverPoint(undefined)', async () => {
    setUnhoverPoint({ x: 50, y: 75 });
    setUnhoverPoint(undefined);
    const move = vi.fn();
    await unhoverBeforeCapture(mockPage(move));
    expect(move).toHaveBeenCalledWith(UNHOVER_POINT.x, UNHOVER_POINT.y);
  });
});
