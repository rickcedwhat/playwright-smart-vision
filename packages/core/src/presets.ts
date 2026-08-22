import { Strategies } from './strategies.js';

/**
 * Environment presets — spread into `init()` to configure strategies for common runtimes.
 *
 *   await init({ page, storage: { root }, ...presets.guacamole });
 */
export const presets = {
  /**
   * Apache Guacamole / HTML5 remote desktop.
   * Triple-click select (Ctrl+A is unreliable over the protocol),
   * clipboard read for OCR, and common remote-font character swaps.
   */
  guacamole: {
    strategies: {
      fill: Strategies.Fill.tripleClickType(),
      ocr: Strategies.Ocr.default({
        read: 'clipboard' as const,
        swaps: {
          "'": ["'", '’'],
          '"': ['“', '”'],
        },
      }),
    },
  },

  /**
   * Windows RDP / remote desktop.
   * Char-by-char typing avoids clipboard paste issues over the protocol.
   */
  rdp: {
    strategies: {
      fill: Strategies.Fill.charByChar({ delay: 30 }),
    },
  },

  /**
   * Webview / embedded browser.
   * Uses the standard select-all-type recipe with insertText.
   */
  webview: {
    strategies: {
      fill: Strategies.Fill.selectAllType(),
    },
  },
} as const;

/**
 * Deep-merge two `init()` option objects, combining their `strategies` slots.
 * Useful when a preset and per-test options both configure strategies.
 *
 *   const opts = mergeInitOptions(presets.guacamole, { strategies: { click: Strategies.Click.offset({ x: 0.1, y: 0.5 }) } });
 */
export function mergeInitOptions<T extends { strategies?: object }>(
  base: T,
  overrides: Partial<T>,
): T {
  return {
    ...base,
    ...overrides,
    strategies: { ...base.strategies, ...overrides.strategies },
  } as T;
}
