import type { Page } from '@playwright/test';
import { getGlobalConfig } from './configure.js';

/** Neutral corner used to clear hover/highlight before OCR screenshots. */
export const UNHOVER_POINT = { x: 8, y: 8 } as const;

/**
 * Move the mouse off interactive content so template matching is not skewed by
 * hover highlights. Enabled by default; pass `false` or
 * `configure({ unhoverBeforeCapture: false })` to skip.
 */
export async function unhoverBeforeCapture(
  page: Page,
  override?: boolean,
): Promise<void> {
  const enabled = override ?? getGlobalConfig().unhoverBeforeCapture ?? true;
  if (!enabled) return;
  await page.mouse.move(UNHOVER_POINT.x, UNHOVER_POINT.y);
}
