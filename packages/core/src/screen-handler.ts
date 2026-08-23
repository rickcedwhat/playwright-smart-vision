import type { Page } from '@playwright/test';
import type { ElementConfig, ElementResult } from './types.js';
import type { ScreenConfig } from './screen-config.js';
import type { ScreenHost, ScreenExtractor } from './screen-result.js';
import { ScreenResult } from './screen-result.js';
import { ScreenElement, VISIBLE_CONFIDENCE } from './element.js';
import { loadScreen } from './configure.js';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenHandlerOptions {
  /** Maximum number of times the handler fires. Default: Infinity. */
  times?: number;
  /** Skip the wait-until-gone poll after the handler returns. Default: false. */
  noWaitAfter?: boolean;
}

interface HandlerEntry {
  target: string;
  screenName: string;
  elementName: string | undefined;
  screenConfig: ScreenConfig;
  detectionConfig: ElementConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (matched: any) => Promise<void>;
  times: number;
  noWaitAfter: boolean;
  fireCount: number;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const handlers: HandlerEntry[] = [];
const activeTargets = new Set<string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a handler that fires when an authored screen is detected on any
 * live capture. The callback receives a bound, OCR-populated ScreenResult.
 */
export function addScreenHandler(
  target: string,
  fn: (matched: ScreenResult) => Promise<void>,
  options?: ScreenHandlerOptions,
): () => void;

/**
 * Register a handler that fires when a specific element within a screen is
 * detected on any live capture. Dotted target: `'screen-name.element-name'`.
 * The callback receives the matched ScreenElement.
 */
export function addScreenHandler(
  target: `${string}.${string}`,
  fn: (matched: ScreenElement) => Promise<void>,
  options?: ScreenHandlerOptions,
): () => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addScreenHandler(target: string, fn: (matched: any) => Promise<void>, options: ScreenHandlerOptions = {}): () => void {
  const dot = target.indexOf('.');
  const screenName = dot === -1 ? target : target.slice(0, dot);
  const elementName = dot === -1 ? undefined : target.slice(dot + 1);

  const screenConfig = loadScreen(screenName);

  let detectionConfig: ElementConfig | undefined;
  if (elementName) {
    detectionConfig = screenConfig.elementConfigs.find((c) => c.name === elementName);
    if (!detectionConfig) {
      throw new Error(`addScreenHandler: element "${elementName}" not found in screen "${screenName}"`);
    }
  } else {
    const ready = screenConfig.ready;
    const readyName =
      typeof ready === 'string' ? ready
      : Array.isArray(ready) ? ready[0]
      : ready && 'any' in ready ? ready.any[0]
      : undefined;
    detectionConfig = readyName
      ? screenConfig.elementConfigs.find((c) => c.name === readyName)
      : screenConfig.elementConfigs[0];
    if (!detectionConfig) {
      throw new Error(`addScreenHandler: screen "${screenName}" has no elements to detect`);
    }
  }

  const entry: HandlerEntry = {
    target,
    screenName,
    elementName,
    screenConfig,
    detectionConfig,
    fn,
    times: options.times ?? Infinity,
    noWaitAfter: options.noWaitAfter ?? false,
    fireCount: 0,
  };
  handlers.push(entry);
  return () => {
    const idx = handlers.indexOf(entry);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}

/** Remove all handlers registered for the given target (screen or element). */
export function removeScreenHandler(target: string): void {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]!.target === target) handlers.splice(i, 1);
  }
}

/** Remove all registered handlers (called by release()). */
export function clearScreenHandlers(): void {
  handlers.length = 0;
  activeTargets.clear();
}

// ---------------------------------------------------------------------------
// Detection + dispatch
// ---------------------------------------------------------------------------

/**
 * Check all registered handlers against an already-taken screenshot.
 * Called from ScreenResult.captureLive() after every live screenshot.
 */
export async function runHandlers(shot: string, host: ScreenHost, page: Page): Promise<void> {
  for (const entry of [...handlers]) {
    if (activeTargets.has(entry.target)) continue;
    if (entry.fireCount >= entry.times) continue;

    let located: ElementResult;
    try {
      located = await host.extractor.locateOnScreenshot(shot, entry.detectionConfig);
    } catch {
      continue;
    }
    if ((located.confidence ?? 0) < VISIBLE_CONFIDENCE) continue;

    activeTargets.add(entry.target);
    entry.fireCount++;
    try {
      const handlerHost: ScreenHost = {
        extractor: host.extractor,
        screen: entry.screenConfig,
        shotDir: host.shotDir,
        ...(host.unhover !== undefined && { unhover: host.unhover }),
      };

      let arg: ScreenResult | ScreenElement;
      if (entry.elementName) {
        const bound = ScreenResult.bind(page, host.extractor, entry.screenConfig, host.shotDir, {
          ...(host.unhover !== undefined && { unhover: host.unhover }),
        });
        arg = new ScreenElement(located, page, bound);
      } else {
        arg = await ScreenResult.fromShot(shot, page, handlerHost);
      }

      await entry.fn(arg);

      if (!entry.noWaitAfter) {
        await waitUntilGone(page, host.shotDir, entry.screenName, host.extractor, entry.detectionConfig);
      }
    } finally {
      activeTargets.delete(entry.target);
    }

    if (entry.fireCount >= entry.times) {
      const idx = handlers.indexOf(entry);
      if (idx !== -1) handlers.splice(idx, 1);
    }
  }
}

async function waitUntilGone(
  page: Page,
  shotDir: string,
  screenName: string,
  extractor: ScreenExtractor,
  detectionConfig: ElementConfig,
): Promise<void> {
  const pollShot = path.join(shotDir, `${screenName}-handler-gone.png`);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 150));
    try {
      await page.screenshot({ path: pollShot, timeout: 2_000 });
      const located = await extractor.locateOnScreenshot(pollShot, detectionConfig);
      if ((located.confidence ?? 0) < VISIBLE_CONFIDENCE) return;
    } catch {
      return;
    }
  }
}
