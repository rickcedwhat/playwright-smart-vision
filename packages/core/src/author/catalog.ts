import fs from 'node:fs';
import path from 'node:path';
import { storageRoot } from './storage.js';
import { ElementType } from '../types.js';

export interface ScreenCatalog {
  [screen: string]: readonly string[];
}

export interface CatalogElement {
  name: string;
  type: string;
  parts: string[];
  section?: string;
}

interface CatalogScreen {
  name: string;
  elements: CatalogElement[];
}

const ELEMENT_TYPES = new Set<string>(Object.values(ElementType));

function catalogType(raw: string | undefined): string {
  const type = raw || 'other';
  return ELEMENT_TYPES.has(type) ? type : 'other';
}

function listScreens(root: string): CatalogScreen[] {
  if (!fs.existsSync(root)) return [];
  const out: CatalogScreen[] = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const indexPath = path.join(root, ent.name, 'index.json');
    if (!fs.existsSync(indexPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
        sections?: Array<{ name?: string; filename?: string }>;
        elements?: Array<{
          name?: string;
          type?: string;
          section?: string;
          parts?: Array<{ name?: string }>;
        }>;
      };
      const sectionByFile = new Map(
        (raw.sections ?? [])
          .filter((sec): sec is { name: string; filename: string } => Boolean(sec.name && sec.filename))
          .map((sec) => [sec.filename, sec.name]),
      );
      const elements = (raw.elements ?? [])
        .filter((el): el is { name: string; type?: string; section?: string; parts?: Array<{ name?: string }> } => Boolean(el.name))
        .map((el) => {
          const item: CatalogElement = {
            name: el.name,
            type: catalogType(el.type),
            parts: (el.parts ?? []).map((part) => part.name).filter((n): n is string => Boolean(n)),
          };
          const section = el.section ? sectionByFile.get(el.section) || undefined : undefined;
          if (section) item.section = section;
          return item;
        });
      out.push({ name: ent.name, elements });
    } catch {
      // skip unreadable index.json
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function specFields(el: CatalogElement, join: '; ' | ', '): string {
  const bits = [`type: ${JSON.stringify(el.type)}`];
  if (el.parts.length) bits.push(`parts: [${el.parts.map((n) => JSON.stringify(n)).join(', ')}]`);
  if (el.section) bits.push(`section: ${JSON.stringify(el.section)}`);
  return `{ ${bits.join(join)} }`;
}

function screenTypeBody(screen: CatalogScreen): string {
  if (!screen.elements.length) return '    ';
  return screen.elements
    .map((el) => `    ${JSON.stringify(el.name)}: ${specFields(el, '; ')};`)
    .join('\n');
}

function screenValueBody(screen: CatalogScreen): string {
  if (!screen.elements.length) return '    ';
  return screen.elements
    .map((el) => `    ${JSON.stringify(el.name)}: ${specFields(el, ', ')},`)
    .join('\n');
}

export function readScreenCatalog(): ScreenCatalog {
  const catalog: ScreenCatalog = {};
  for (const screen of listScreens(storageRoot())) {
    catalog[screen.name] = screen.elements.map((el) => el.name);
  }
  return catalog;
}

/** Typed catalog helper source. Does not touch the filesystem. No `as` / `as const`. */
export function screenCatalogSource(): string {
  const screens = listScreens(storageRoot());
  const screensType = screens.length
    ? screens
        .map((s) => `  ${JSON.stringify(s.name)}: {\n${screenTypeBody(s)}\n  };`)
        .join('\n')
    : '  [screen: string]: never;';
  const screensValue = screens.length
    ? screens
        .map((s) => `  ${JSON.stringify(s.name)}: {\n${screenValueBody(s)}\n  },`)
        .join('\n')
    : '';

  return `/** Generated from screens/*/index.json. Copy to src/helpers/screens.generated.ts */
export type Screens = {
${screensType}
};

export type ScreenName = keyof Screens;
export type ElementName<S extends ScreenName> = keyof Screens[S] & string;
export type ElementType<S extends ScreenName, E extends ElementName<S>> = Screens[S][E]["type"];
export type PartName<S extends ScreenName, E extends ElementName<S>> =
  Screens[S][E] extends { parts: readonly (infer P)[] } ? P : never;

export const screens: Screens = {
${screensValue}
};
`;
}

export function screenCatalogPath(): string {
  return path.join(storageRoot(), 'generated.ts');
}

/**
 * Write `{storage.root}/generated.ts` (or `destFile` if given).
 * QA Wolf: copy that file to `src/helpers/screens.generated.ts` after the flow.
 */
export function writeScreenCatalog(destFile?: string): string {
  const source = screenCatalogSource();
  const dest = destFile || screenCatalogPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, source);
  return source;
}
