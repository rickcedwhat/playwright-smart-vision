import fs from 'node:fs';
import path from 'node:path';
import { storageRoot } from './storage.js';

function toCamelCase(s: string): string {
  // Strip leading/trailing hyphens, collapse consecutive hyphens, handle uppercase
  const camel = s
    .replace(/^-+|-+$/g, '')
    .replace(/-+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
  // Prefix with _ if result starts with a digit (invalid unquoted TS identifier)
  return /^\d/.test(camel) ? `_${camel}` : camel;
}

function readCharsets(): Record<string, unknown> {
  const charsetFile = path.join(path.dirname(storageRoot()), 'charsets.json');
  if (!fs.existsSync(charsetFile)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(charsetFile, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed file
  }
  return {};
}

export interface ScreenCatalog {
  [screen: string]: readonly string[];
}

export interface CatalogPart {
  name: string;
  type?: string;
}

export interface CatalogElement {
  name: string;
  type?: string;
  parts?: CatalogPart[];
}

interface CatalogScreen {
  name: string;
  elements: CatalogElement[];
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
        elements?: Array<{ name?: string; type?: string; parts?: Array<{ name?: string; type?: string }> }>;
      };
      const elements = (raw.elements ?? [])
        .filter((el) => Boolean(el.name))
        .map((el) => {
          const entry: CatalogElement = { name: el.name! };
          if (el.type) entry.type = el.type;
          const parts = (el.parts ?? []).filter((p) => Boolean(p.name));
          if (parts.length) {
            entry.parts = parts.map((p) => {
              const part: CatalogPart = { name: p.name! };
              if (p.type) part.type = p.type;
              return part;
            });
          }
          return entry;
        });
      out.push({ name: ent.name, elements });
    } catch {
      // skip unreadable index.json
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}


export function readScreenCatalog(): ScreenCatalog {
  const catalog: ScreenCatalog = {};
  for (const screen of listScreens(storageRoot())) {
    catalog[screen.name] = screen.elements.map((el) => el.name);
  }
  return catalog;
}

/** Generated catalog source. Does not touch the filesystem. */
export function screenCatalogSource(charsets?: Record<string, unknown>): string {
  const screens = listScreens(storageRoot());
  const resolvedCharsets = charsets ?? readCharsets();
  const charsetEntries = Object.entries(resolvedCharsets);

  const strategiesBody = charsetEntries.length
    ? `{\n  charsets: {\n${charsetEntries
        .map(([name, cs]) => `    ${JSON.stringify(name)}: ${JSON.stringify(cs)},`)
        .join('\n')}\n  },\n}`
    : '{}';

  const screensBody = screens
    .map((s) => {
      const key = toCamelCase(s.name);
      const elementsBody = s.elements.length
        ? s.elements
            .map((el) => {
              const typeStr = el.type ? `, type: ${JSON.stringify(el.type)}` : '';
              const partsStr = el.parts?.length
                ? `, parts: {${el.parts.map((p) => `${JSON.stringify(p.name)}: ${JSON.stringify(p.type ?? 'field')}`).join(', ')}}`
                : '';
              return `      ${JSON.stringify(el.name)}: { name: ${JSON.stringify(el.name)}${typeStr}${partsStr} },`;
            })
            .join('\n')
        : '';
      return `  ${key}: {\n    name: ${JSON.stringify(s.name)},\n    elements: {\n${elementsBody}\n    },\n  },`;
    })
    .join('\n');

  const ts = new Date().toISOString();
  return `// Generated ${ts} by TM v2 — do not edit, re-generated on every save.
/** @generated */
import type { Strategies } from '@rickcedwhat/playwright-smart-vision';

export const strategies = ${strategiesBody} satisfies Strategies;

export const screens = {
${screensBody}
} as const;

export type ScreenName = keyof typeof screens extends never
  ? string
  : (typeof screens)[keyof typeof screens]['name'];

type _ScreenKey<S extends ScreenName> = {
  [K in keyof typeof screens]: (typeof screens)[K]['name'] extends S ? K : never;
}[keyof typeof screens];

type _Screen<S extends ScreenName> = (typeof screens)[_ScreenKey<S>];

export type ElementName<S extends ScreenName> = keyof _Screen<S>['elements'] & string;

export type PartName<S extends ScreenName, E extends ElementName<S>> =
  _Screen<S>['elements'][E] extends { parts: infer P } ? keyof P & string : never;

export type PartType<S extends ScreenName, E extends ElementName<S>, P extends PartName<S, E>> =
  _Screen<S>['elements'][E] extends { parts: infer Parts }
    ? Parts extends Record<string, string>
      ? P extends keyof Parts
        ? Parts[P]
        : never
      : never
    : never;
`;
}

export function screenCatalogPath(): string {
  return path.join(storageRoot(), 'generated.ts');
}

/**
 * Write `{storage.root}/generated.ts` (or `destFile` if given).
 * QA Wolf: copy that file to `src/helpers/screens.generated.ts` after the flow.
 */
export function writeScreenCatalog(destFile?: string, charsets?: Record<string, unknown>): string {
  const source = screenCatalogSource(charsets);
  const dest = destFile || screenCatalogPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, source);
  return source;
}
