import fs from 'node:fs';
import path from 'node:path';
import { getGlobalConfig } from '../configure.js';

export function storageRoot(): string {
  const root = getGlobalConfig().storage?.root;
  if (!root) {
    throw new Error('call configure({ storage: { root } }) first — in QA Wolf use process.env.TEAM_STORAGE_DIR');
  }
  return root;
}

export function screenDir(name: string): string {
  return path.join(storageRoot(), name);
}
