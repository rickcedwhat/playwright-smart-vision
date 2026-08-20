import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from '@playwright/test';
import { configure, resetGlobalConfig } from './configure.js';
import { UNHOVER_POINT, unhoverBeforeCapture } from './unhover.js';

function mockPage(move = vi.fn()) {
  return { mouse: { move } } as unknown as Page;
}

describe('unhoverBeforeCapture', () => {
  beforeEach(() => {
    resetGlobalConfig();
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
});
