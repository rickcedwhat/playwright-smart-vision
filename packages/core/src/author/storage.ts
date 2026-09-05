import fs from 'node:fs';
import path from 'node:path';
import { getGlobalConfig } from '../configure.js';

export function storageRoot(): string {
  const root = getGlobalConfig().storage?.root;
  if (!root) {
    throw new Error('call configure({ storage: { root } }) first — example: configure({ storage: { root: "./screens" } })');
  }
  return root;
}

export function screenDir(name: string): string {
  const parts = name.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === '.' || p === '..')) {
    throw new Error(`invalid screen name: ${JSON.stringify(name)}`);
  }
  return path.join(storageRoot(), ...parts);
}
