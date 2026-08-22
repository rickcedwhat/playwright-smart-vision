import type { Page } from '@playwright/test';
import { getGlobalConfig } from './configure.js';

/** Neutral corner used to clear hover/highlight before OCR screenshots. */
export const UNHOVER_POINT = { x: 1, y: 1 } as const;

let globalUnhoverPoint: { x: number; y: number } | undefined;

/** Set by `init({ unhoverPoint })`. Pass `undefined` to clear. */
export function setUnhoverPoint(point: { x: number; y: number } | undefined): void {
  globalUnhoverPoint = point;
}

let globalUnhoverPoint: { x: number; y: number } | undefined;

/** Set by `init({ unhoverPoint })`. Pass `undefined` to clear. */
export function setUnhoverPoint(point: { x: number; y: number } | undefined): void {
  globalUnhoverPoint = point;
}

/**
 * Move the mouse off interactive content so template matching is not skewed by
 * hover highlights. Enabled by default; pass `false` or
 * `configure({ unhoverBeforeCapture: false })` to skip.
 *
 * The destination defaults to `UNHOVER_POINT` and can be overridden via
 * `init({ unhoverPoint })` or `configure({ unhoverPoint })`.
 */
export async function unhoverBeforeCapture(
  page: Page,
  override?: boolean,
): Promise<void> {
  const enabled = override ?? getGlobalConfig().unhoverBeforeCapture ?? true;
  if (!enabled) return;
  const point = globalUnhoverPoint ?? getGlobalConfig().unhoverPoint ?? UNHOVER_POINT;
  await page.mouse.move(point.x, point.y);
}
