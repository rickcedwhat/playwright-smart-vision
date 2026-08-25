import type { Locator, Page } from '@playwright/test';
import type { Rect } from './types.js';
import type { OcrStrategy } from './utils/ocr.js';
export type { OcrStrategy };

// ─── Strategy interfaces ──────────────────────────────────────────────────────

export interface ClickStrategy {
  /** Returns the point to click within the element's bounding rect. */
  getPoint(rect: Rect): { x: number; y: number };
}

export interface FillStrategy {
  /** Full fill sequence: focus, select, type. Owns all keyboard/mouse steps. */
  fill(page: Page, rect: Rect, text: string): Promise<void>;
}

export interface HoverStrategy {
  /** Full hover lifetime: move to the element, wait, done. */
  hover(page: Page, locator: Locator, rect: Rect): Promise<void>;
}

export interface DblClickStrategy {
  /** Full double-click lifetime. */
  dblclick(page: Page, rect: Rect): Promise<void>;
}

export interface CaptureStrategy {
  unhover: boolean;
  unhoverPoint?: { x: number; y: number };
}

// ─── Module-level state ───────────────────────────────────────────────────────

let globalClickStrategy: ClickStrategy | undefined;
let globalFillStrategy: FillStrategy | undefined;
let globalHoverStrategy: HoverStrategy | undefined;
let globalDblClickStrategy: DblClickStrategy | undefined;

export function setClickStrategy(s: ClickStrategy | undefined): void {
  globalClickStrategy = s;
}
export function setFillStrategy(s: FillStrategy | undefined): void {
  globalFillStrategy = s;
}
export function setHoverStrategy(s: HoverStrategy | undefined): void {
  globalHoverStrategy = s;
}
export function setDblClickStrategy(s: DblClickStrategy | undefined): void {
  globalDblClickStrategy = s;
}

export function getClickStrategy(): ClickStrategy {
  return globalClickStrategy ?? Strategies.Click.center();
}
export function getFillStrategy(): FillStrategy {
  return globalFillStrategy ?? Strategies.Fill.selectAllType();
}
export function getHoverStrategy(): HoverStrategy | undefined {
  return globalHoverStrategy;
}
export function getDblClickStrategy(): DblClickStrategy | undefined {
  return globalDblClickStrategy;
}

// ─── Strategies namespace ─────────────────────────────────────────────────────

export const Strategies = {
  Ocr: {
    /** Create an Ocr strategy with global charset defaults, name-inference, and swaps. */
    default(options: OcrStrategy): OcrStrategy {
      return options;
    },
  },

  Click: {
    /** Click the center of the element rect. Default behavior. */
    center(): ClickStrategy {
      return { getPoint: (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) };
    },

    /**
     * Click at a fractional offset within the element rect.
     * `{ x: 0, y: 0.5 }` → left-center; `{ x: 0.5, y: 0.5 }` → center.
     */
    offset(pct: { x: number; y: number }): ClickStrategy {
      return { getPoint: (r) => ({ x: r.x + r.width * pct.x, y: r.y + r.height * pct.y }) };
    },

    /** Click at a custom point derived from the rect. */
    point(fn: (rect: Rect) => { x: number; y: number }): ClickStrategy {
      return { getPoint: fn };
    },
  },

  Fill: {
    /** Click → Ctrl/Cmd+A → Backspace → insertText. Default behavior. */
    selectAllType(): FillStrategy {
      return {
        async fill(page, rect, text) {
          await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.press('Backspace');
          await page.keyboard.insertText(text);
        },
      };
    },

    /**
     * Triple-click (selects all in remote/Guacamole envs) → insertText.
     * Preferred over selectAllType for environments that don't relay Ctrl+A.
     */
    tripleClickType(): FillStrategy {
      return {
        async fill(page, rect, text) {
          await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2, { clickCount: 3 });
          await page.keyboard.insertText(text);
        },
      };
    },

    /** Click → Ctrl/Cmd+A → Backspace → keyboard.type (slower, fires key events). */
    clearAndType(): FillStrategy {
      return {
        async fill(page, rect, text) {
          await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.press('Backspace');
          await page.keyboard.type(text);
        },
      };
    },

    /** Type into the currently focused element without clicking or clearing. */
    typeOnly(): FillStrategy {
      return {
        async fill(page, _rect, text) {
          await page.keyboard.type(text);
        },
      };
    },

    /**
     * Click to focus, then type one character at a time with a delay.
     * Use in environments where rapid key events are dropped.
     */
    charByChar(options: { delay: number }): FillStrategy {
      return {
        async fill(page, rect, text) {
          await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
          await page.keyboard.type(text, { delay: options.delay });
        },
      };
    },

    /** Click to focus, then use insertText without selecting/clearing first. */
    insertText(): FillStrategy {
      return {
        async fill(page, rect, text) {
          await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
          await page.keyboard.insertText(text);
        },
      };
    },
  },

  Hover: {
    /**
     * Hover over the element for `ms` milliseconds, then resolve.
     * Use in environments where hover-triggered UI needs time to appear
     * (tooltips, dropdowns) before the next action.
     */
    withDelay(ms: number): HoverStrategy {
      return {
        async hover(page, locator, rect) {
          await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
          await page.waitForTimeout(ms);
        },
      };
    },

    /** Hover over the element with no additional delay. */
    default(): HoverStrategy {
      return {
        async hover(page, _locator, rect) {
          await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
        },
      };
    },
  },

  DblClick: {
    /** Double-click the center of the element rect. Default behavior. */
    default(): DblClickStrategy {
      return {
        async dblclick(page, rect) {
          await page.mouse.dblclick(rect.x + rect.width / 2, rect.y + rect.height / 2);
        },
      };
    },

    /**
     * Double-click with a delay between the two clicks.
     * Use in remote desktop environments where rapid clicks may not register.
     */
    withDelay(ms: number): DblClickStrategy {
      return {
        async dblclick(page, rect) {
          await page.mouse.dblclick(rect.x + rect.width / 2, rect.y + rect.height / 2, { delay: ms });
        },
      };
    },
  },

  Capture: {
    /** Move the mouse to a neutral corner before OCR screenshots. Default behavior. */
    unhover(options?: { point?: { x: number; y: number } }): CaptureStrategy {
      return { unhover: true, ...(options?.point !== undefined && { unhoverPoint: options.point }) };
    },

    /** Skip the unhover mouse move before capture. */
    noop(): CaptureStrategy {
      return { unhover: false };
    },
  },
};
