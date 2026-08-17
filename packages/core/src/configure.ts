import * as fs from 'fs';
import * as path from 'path';
import type { ScreenConfig } from './screen-config.js';
import type { ElementConfig, FieldPart } from './types.js';

interface StorageConfig {
  root: string;
}

let globalStorage: StorageConfig | undefined;

/**
 * Set the storage root where screen assets (index.json, blank.png, templates/) live.
 * Required before calling ocrScreen('screen-name').
 *
 * In QA Wolf: configure({ storage: { root: process.env.TEAM_STORAGE_DIR + '/ocr-screens/acme' } })
 * In regular dev: configure({ storage: { root: './tests/screens' } })
 */
export function configure(config: { storage?: StorageConfig }): void {
  if (config.storage) globalStorage = config.storage;
}

interface StorageElement {
  name: string;
  filename?: string;
  section?: string;
  type?: string;
  ocrRect?: { x: number; y: number; width: number; height: number };
  parts?: Array<{ name?: string; x: number; y: number; width: number; height: number; charset?: string }>;
  charset?: string;
  options?: string[];
  overflow?: string;
  swaps?: Record<string, string[]>;
  variants?: Record<string, { filename: string }>;
  animated?: boolean;
}

interface StorageIndex {
  name?: string;
  ready?: string | string[] | { any: string[] };
  elements: StorageElement[];
}

/**
 * Load a ScreenConfig by name from the configured storage root.
 * Reads {root}/{name}/index.json, blank.png, and templates/.
 */
export function loadScreen(name: string): ScreenConfig {
  if (!globalStorage) {
    throw new Error(
      `ocrScreen('${name}'): call configure({ storage: { root } }) before using string screen names`,
    );
  }
  const dir = path.join(globalStorage.root, name);
  const indexPath = path.join(dir, 'index.json');

  let raw: StorageIndex;
  try {
    raw = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as StorageIndex;
  } catch {
    throw new Error(`ocrScreen('${name}'): could not read ${indexPath}`);
  }

  const elementConfigs: ElementConfig[] = raw.elements.map((el) => {
    const cfg: ElementConfig = { name: el.name };

    if (el.type) cfg.type = el.type as ElementConfig['type'];
    if (el.filename) cfg.templatePath = path.join(dir, 'templates', el.filename);
    if (el.section) cfg.sectionTemplatePath = path.join(dir, 'templates', el.section);
    if (el.animated) cfg.animated = el.animated;
    if (el.ocrRect) cfg.ocrRect = el.ocrRect;
    if (el.charset) cfg.charset = el.charset;
    if (el.options?.length) cfg.options = el.options;
    if (el.overflow) cfg.overflow = el.overflow as ElementConfig['overflow'];
    if (el.swaps) cfg.swaps = el.swaps;
    if (el.parts?.length) {
      cfg.parts = el.parts.map((p): FieldPart => ({
        name: p.name ?? '',
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        charset: p.charset,
      }));
    }
    if (el.variants) {
      cfg.variants = Object.fromEntries(
        Object.entries(el.variants).map(([k, v]) => [
          k,
          { template: path.join(dir, 'templates', v.filename) },
        ]),
      );
    }

    return cfg;
  });

  return {
    name,
    blankScreenPath: path.join(dir, 'blank.png'),
    ready: raw.ready,
    elementConfigs,
  };
}
