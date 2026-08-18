import fs from 'node:fs';
import path from 'node:path';
import { storageRoot } from './storage.js';

export interface ScreenCatalog {
  [screen: string]: readonly string[];
}

function listScreens(root: string): Array<{ name: string; elements: string[] }> {
  if (!fs.existsSync(root)) return [];
  const out: Array<{ name: string; elements: string[] }> = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const indexPath = path.join(root, ent.name, 'index.json');
    if (!fs.existsSync(indexPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
        elements?: Array<{ name?: string }>;
      };
      const elements = (raw.elements ?? []).map((el) => el.name).filter((n): n is string => Boolean(n));
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
    catalog[screen.name] = screen.elements;
  }
  return catalog;
}

/** Typed catalog helper source. Does not touch the filesystem. */
export function screenCatalogSource(): string {
  const screens = listScreens(storageRoot());
  const body = screens
    .map((s) => {
      const names = s.elements.map((n) => JSON.stringify(n)).join(', ');
      return `  ${JSON.stringify(s.name)}: [${names}] as const,`;
    })
    .join('\n');

  return `/** Generated catalog of FUSE screens. Update when authoring a screen. */
export const screens = {
${body}
} as const;

export type ScreenName = keyof typeof screens;
export type ElementName<S extends ScreenName> = (typeof screens)[S][number];
`;
}

/**
 * Write a typed catalog helper. For local/dev use only.
 * QA Wolf AI should write `src/helpers/screens.generated.ts` in the repo after the flow,
 * not call this from a flow (the flow runtime cannot write the git workspace).
 */
export function writeScreenCatalog(destFile: string): string {
  const source = screenCatalogSource();
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, source);
  return source;
}
