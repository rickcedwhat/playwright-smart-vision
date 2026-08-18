import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configure, loadScreen } from '../configure.js';
import { applyScreen } from './apply.js';
import { writeScreenCatalog, readScreenCatalog } from './catalog.js';

const fixtureBlank = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tests/screens/html-login/blank.png',
);

describe('author apply + catalog', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-author-'));
  const name = 'html-login';
  const dir = path.join(root, name);

  beforeAll(async () => {
    await configure({ storage: { root } });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(fixtureBlank, path.join(dir, 'blank.png'));
    fs.writeFileSync(path.join(dir, 'boxes.json'), `${JSON.stringify({
      width: 1280,
      height: 800,
      boxes: [
        { id: 1, x: 590, y: 147, width: 204, height: 22 },
        { id: 2, x: 590, y: 174, width: 204, height: 22 },
      ],
    }, null, 2)}\n`);
  });

  it('applyScreen crops templates and writes index.json loadScreen can read', () => {
    const result = applyScreen(name, {
      screen: { name, width: 1280, height: 800 },
      notes: ['vitest'],
      unknowns: [],
      sections: [],
      elements: [
        { name: 'username', type: 'field', boxIds: [1] },
        { name: 'password', type: 'field', boxIds: [2] },
      ],
    });
    expect(result.elements.map((e) => e.name)).toEqual(['username', 'password']);
    expect(fs.existsSync(path.join(result.dir, 'index.json'))).toBe(true);
    for (const el of result.elements) {
      expect(fs.existsSync(path.join(result.dir, 'templates', el.filename))).toBe(true);
    }
    const screen = loadScreen(name);
    expect(screen.elementConfigs.map((e) => e.name)).toEqual(['username', 'password']);
  });

  it('writeScreenCatalog emits typed screen/element names', () => {
    applyScreen(name, {
      screen: { name },
      elements: [
        { name: 'username', type: 'field', boxIds: [1] },
        { name: 'password', type: 'field', boxIds: [2] },
      ],
    });
    const dest = path.join(root, 'screens.generated.ts');
    writeScreenCatalog(dest);
    const src = fs.readFileSync(dest, 'utf8');
    expect(src).toContain('"html-login"');
    expect(src).toContain('"username"');
    expect(readScreenCatalog()['html-login']).toEqual(['username', 'password']);
  });

  it('rejects path traversal in screen names', () => {
    expect(() => applyScreen('..')).toThrow(/invalid screen name/);
    expect(() => applyScreen('../elsewhere')).toThrow(/invalid screen name/);
  });
});
