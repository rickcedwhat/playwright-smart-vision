import type { ElementConfig, FieldPart, Rect, ScreenComparison, ElementType } from './types.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Home-dir settings written by the Template Manager for external image storage. */
export const SCREENS_SETTINGS_FILE = '.playwright-ocr-screens.json';

function expandHomeDir(raw: string): string {
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

function readExternalScreensRoot(): string | undefined {
  const fromEnv = process.env.OCR_SCREENS_DIR?.trim();
  if (fromEnv) return expandHomeDir(fromEnv);

  try {
    const file = path.join(os.homedir(), SCREENS_SETTINGS_FILE);
    if (!fs.existsSync(file)) return undefined;
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      storage?: string;
      screensDir?: string;
      imagesLocation?: string;
      imagesDir?: string;
    };
    if (data.imagesLocation === 'custom' && data.imagesDir?.trim()) {
      return expandHomeDir(data.imagesDir.trim());
    }
    if (data.storage === 'external' && data.screensDir?.trim()) {
      return expandHomeDir(data.screensDir.trim());
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Authoring sometimes stores parts in screen space; runtime wants crop-relative (like ocrRect). */
export function relativePartRect(part: Rect, crop: Rect): Rect {
  if (part.x >= crop.x && part.y >= crop.y) {
    return {
      x: part.x - crop.x,
      y: part.y - crop.y,
      width: part.width,
      height: part.height,
    };
  }
  return { x: part.x, y: part.y, width: part.width, height: part.height };
}

/**
 * Resolve where a screen's PNG assets live.
 * Uses OCR_SCREENS_DIR or ~/.playwright-ocr-screens.json when those images exist,
 * otherwise falls back to the in-repo screen folder (typically __dirname).
 */
export function screenAssetsDir(screenName: string, fallbackDir: string): string {
  const root = readExternalScreensRoot();
  if (root) {
    const dir = path.join(root, screenName);
    if (fs.existsSync(path.join(dir, 'blank.png'))) {
      return dir;
    }
  }
  return fallbackDir;
}

/**
 * Configuration for a single screen/page
 */
export interface ScreenConfig {
  /** Screen identifier (e.g., 'login', 'checkout') */
  name: string;
  
  /** Path to blank screenshot of this screen */
  blankScreenPath: string;
  
  /** UI elements to extract from this screen */
  elementConfigs: ElementConfig[];
  
  /** Optional: Base directory for relative paths */
  baseDir?: string | undefined;
  
  /** Optional: Enable debug output */
  debug?: boolean | undefined;

  /**
   * Which element(s) signal the screen is ready in screen.waitFor().
   * - string: one element must be visible
   * - string[]: all elements must be visible (checked sequentially)
   * - { any: string[] }: any one element must be visible
   * Defaults to the first element when omitted.
   */
  ready?: string | string[] | { any: string[] } | undefined;
}

/**
 * Helper to create a screen configuration
 * Automatically resolves paths relative to screen folder
 */
export function defineScreen(config: {
  name: string;
  baseDir: string;
  blankScreen?: string;
  elements: Array<{
    name: string;
    template?: string;  // For single-state elements
    variants?: Record<string, { template: string }>;  // For multi-state elements
    type?: ElementType;
    section?: string;  // Filename in templates/, locates a parent region first
    sectionTemplatePath?: string;
    options?: string[];
    ocrRect?: { x: number; y: number; width: number; height: number };
    charset?: string;
    swaps?: ElementConfig['swaps'];
    overflow?: ElementConfig['overflow'];
    read?: ElementConfig['read'];
    parts?: FieldPart[];
  }>;
  debug?: boolean;
  ready?: string | string[] | { any: string[] };
}): ScreenConfig {
  const blankScreenPath = path.join(
    config.baseDir, 
    config.blankScreen || 'blank.png'
  );
  
  const elementConfigs: ElementConfig[] = config.elements.map(el => {
    const elementConfig: ElementConfig = {
      name: el.name,
      type: el.type,
    };
    
    // Handle single template or variants
    if (el.template) {
      elementConfig.templatePath = path.join(config.baseDir, 'templates', el.template);
    } else if (el.variants) {
      elementConfig.variants = {};
      for (const [variantName, variantConfig] of Object.entries(el.variants)) {
        elementConfig.variants[variantName] = {
          template: path.join(config.baseDir, 'templates', variantConfig.template),
        };
      }
    }
    
    if (el.section) {
      elementConfig.sectionTemplatePath = path.join(config.baseDir, 'templates', el.section);
    } else if (el.sectionTemplatePath) {
      elementConfig.sectionTemplatePath = el.sectionTemplatePath;
    }
    if (el.options?.length) {
      elementConfig.options = el.options;
    }
    if (el.ocrRect) {
      elementConfig.ocrRect = el.ocrRect;
    }
    if (el.charset) {
      elementConfig.charset = el.charset;
    }
    if (el.swaps) {
      elementConfig.swaps = el.swaps;
    }
    if (el.overflow) {
      elementConfig.overflow = el.overflow;
    }
    if (el.read) {
      elementConfig.read = el.read;
    }
    if (el.parts?.length) {
      elementConfig.parts = el.parts;
    }
    
    return elementConfig;
  });
  
  const screenConfig: ScreenConfig = {
    name: config.name,
    blankScreenPath,
    elementConfigs,
  };
  
  if (config.baseDir) {
    screenConfig.baseDir = config.baseDir;
  }
  
  if (config.debug !== undefined) {
    screenConfig.debug = config.debug;
  }
  if (config.ready) {
    screenConfig.ready = config.ready;
  }
  
  const managerPath = [
    path.join(config.baseDir, 'index.json'),
    path.join(config.baseDir, 'manager.json'),
  ].find((p) => fs.existsSync(p));
  if (managerPath) {
    try {
      const manager = JSON.parse(fs.readFileSync(managerPath, 'utf8')) as {
        elements?: Array<{
          name?: string;
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          ocrRect?: ElementConfig['ocrRect'];
          options?: string[];
          charset?: string;
          parts?: Array<{ name?: string; x: number; y: number; width: number; height: number; charset?: string }>;
        }>;
      };
      const extra = new Map((manager.elements || []).map((row) => [row.name, row]));
      for (const el of elementConfigs) {
        const row = extra.get(el.name);
        if (!row) continue;
        if (!el.ocrRect && row.ocrRect) el.ocrRect = row.ocrRect;
        if (!el.options?.length && row.options?.length) el.options = row.options;
        if (!el.charset && row.charset) el.charset = row.charset;
        if (row.parts?.length) {
          const crop = {
            x: row.x ?? 0,
            y: row.y ?? 0,
            width: row.width ?? 0,
            height: row.height ?? 0,
          };
          if (!el.parts?.length) {
            el.parts = row.parts.map((part) => ({
              name: part.name ?? '',
              charset: part.charset,
              ...relativePartRect(part, crop),
            }));
          } else if (el.parts.length === row.parts.length) {
            // index.json positions override config.ts positions; names/extras from config.ts
            el.parts = el.parts.map((configPart, i) => ({
              ...configPart,
              ...relativePartRect(row.parts![i]!, crop),
            }));
          }
        }
      }
    } catch {
      // manager.json is optional authoring metadata
    }
  }

  return screenConfig;
}

/**
 * Type guard to check if a screen has specific elements
 */
export function hasElement(
  results: ScreenComparison,
  elementName: string
): boolean {
  return results.elements.some(e => e.name === elementName);
}

/**
 * Get element value from results
 */
export function getElementValue(
  results: ScreenComparison,
  elementName: string
): string | undefined {
  return results.elements.find(e => e.name === elementName)?.value;
}

/**
 * Check if element is filled/active
 */
export function isElementFilled(
  results: ScreenComparison,
  elementName: string
): boolean {
  const element = results.elements.find(e => e.name === elementName);
  return element ? !element.isEmpty : false;
}

/**
 * Get all filled elements
 */
export function getFilledElements(
  results: ScreenComparison
): Array<{ name: string; value: string }> {
  return results.elements
    .filter(e => !e.isEmpty)
    .map(e => ({ name: e.name, value: e.value }));
}
