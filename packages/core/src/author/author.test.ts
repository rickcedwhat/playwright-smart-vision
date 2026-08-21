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
      labels: [
        { id: 1, x: 500, y: 149, width: 80, height: 16, text: 'Username:' },
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
    expect(result.elements[0]).toMatchObject({ x: 590, y: 147, width: 204, height: 22 });
    expect(result.elements[0]!.x + result.elements[0]!.width).toBe(590 + 204);
    expect(fs.existsSync(path.join(result.dir, 'index.json'))).toBe(true);
    for (const el of result.elements) {
      expect(fs.existsSync(path.join(result.dir, 'templates', el.filename))).toBe(true);
    }
    const screen = loadScreen(name);
    expect(screen.elementConfigs.map((e) => e.name)).toEqual(['username', 'password']);
  });

  it('applyScreen splits a merged box into named parts without extra boxIds', () => {
    const result = applyScreen(name, {
      screen: { name },
      elements: [
        {
          name: 'delivered',
          type: 'field',
          boxIds: [1],
          parts: [{ name: 'month' }, { name: 'day' }, { name: 'year' }],
        },
      ],
    });
    const delivered = result.elements.find((el) => el.name === 'delivered');
    expect(delivered?.parts?.map((p) => p.name)).toEqual(['month', 'day', 'year']);
    expect(delivered?.parts?.[0]?.width).toBeGreaterThan(0);
    expect(delivered?.parts?.[2]?.x).toBeGreaterThan(delivered!.parts![0]!.x);
  });

  it('applyScreen keeps button crops on the detected box', () => {
    const result = applyScreen(name, {
      screen: { name },
      elements: [
        { name: 'username', type: 'field', boxIds: [1] },
        { name: 'ok', type: 'button', boxIds: [2] },
      ],
    });
    const ok = result.elements.find((el) => el.name === 'ok');
    expect(ok).toMatchObject({ x: 590, y: 174, width: 204, height: 22 });
    const username = result.elements.find((el) => el.name === 'username');
    expect(username).toMatchObject({ x: 590, y: 147, width: 204, height: 22 });
  });

  it('applyScreen unions section boxes into the match crop and keeps overlay on the element', () => {
    const result = applyScreen(name, {
      screen: { name },
      sections: [{ name: 'pairSection', boxIds: [1, 2] }],
      elements: [
        { name: 'wide', type: 'dropdown', section: 'pairSection', boxIds: [1] },
        { name: 'narrow', type: 'field', section: 'pairSection', boxIds: [2] },
      ],
    });
    const wide = result.elements.find((el) => el.name === 'wide')!;
    const narrow = result.elements.find((el) => el.name === 'narrow')!;
    expect(wide).toMatchObject({ x: 590, y: 147, width: 204, height: 22 });
    expect(narrow).toMatchObject({ x: 590, y: 174, width: 204, height: 22 });
    expect(wide.section).toBe('section-pair-section.png');
    expect(narrow.section).toBe('section-pair-section.png');
    expect(wide.ocrRect!.y).toBeLessThan(10);
    expect(narrow.ocrRect!.y).toBeGreaterThan(20);
    const index = JSON.parse(fs.readFileSync(result.indexPath, 'utf8')) as {
      sections: Array<{ name: string; filename: string; x: number; y: number; width: number; height: number }>;
    };
    expect(index.sections[0]).toMatchObject({
      name: 'pairSection',
      filename: 'section-pair-section.png',
      x: 588,
      y: 145,
    });
    expect(index.sections[0]!.height).toBeGreaterThan(48);
  });

  it('applyScreen unions assigned labelIds into the crop', () => {
    const result = applyScreen(name, {
      screen: { name },
      elements: [
        { name: 'username', type: 'field', boxIds: [1], labelIds: [1] },
      ],
    });
    const username = result.elements[0]!;
    expect(username.x).toBeLessThan(500);
    expect(username.x + username.width).toBeGreaterThan(590 + 204);
    expect(username.labelIds).toEqual([1]);
  });

  it('applyScreen grows left only when includeLabel is true and labelIds are empty', () => {
    const result = applyScreen(name, {
      screen: { name },
      elements: [
        { name: 'username', type: 'field', boxIds: [1], includeLabel: true },
      ],
    });
    expect(result.elements[0]!.x).toBeLessThan(590);
    expect(result.elements[0]!.x + result.elements[0]!.width).toBeGreaterThan(590 + 204);
  });

  it('applyScreen writes swaps/read and preserves them across re-apply', () => {
    applyScreen(name, {
      screen: { name },
      elements: [
        {
          name: 'username',
          type: 'field',
          boxIds: [1],
          charset: 'alnum',
          read: 'clipboard',
          swaps: { '@': ['Q'] },
          overflow: 'end',
        },
        { name: 'password', type: 'field', boxIds: [2] },
      ],
    });
    const first = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    expect(first.elements[0]).toMatchObject({
      name: 'username',
      charset: 'alnum',
      read: 'clipboard',
      swaps: { '@': ['Q'] },
      overflow: 'end',
    });

    // Re-apply without options on first-pass — prior index options must stick.
    applyScreen(name, {
      screen: { name },
      elements: [
        { name: 'username', type: 'field', boxIds: [1] },
        { name: 'password', type: 'field', boxIds: [2] },
      ],
    });
    const second = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    expect(second.elements[0]).toMatchObject({
      charset: 'alnum',
      read: 'clipboard',
      swaps: { '@': ['Q'] },
      overflow: 'end',
    });
    const loaded = loadScreen(name).elementConfigs.find((el) => el.name === 'username');
    expect(loaded?.read).toBe('clipboard');
    expect(loaded?.swaps).toEqual({ '@': ['Q'] });
  });

  it('patchElementOptions updates first-pass and index without wiping crops', async () => {
    const { patchElementOptions } = await import('./options.js');
    applyScreen(name, {
      screen: { name },
      elements: [
        { name: 'username', type: 'field', boxIds: [1] },
        { name: 'password', type: 'field', boxIds: [2] },
      ],
    });
    const before = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    const result = patchElementOptions(name, 'username', {
      charset: 'email',
      read: 'clipboard',
      swaps: { '@': ['C', 'Q'] },
    });
    expect(result.index).toMatchObject({ charset: 'email', read: 'clipboard' });
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    expect(after.elements[0].filename).toBe(before.elements[0].filename);
    expect(after.elements[0].x).toBe(before.elements[0].x);
    const fp = JSON.parse(fs.readFileSync(path.join(dir, 'first-pass.json'), 'utf8'));
    expect(fp.elements[0]).toMatchObject({
      name: 'username',
      charset: 'email',
      read: 'clipboard',
      swaps: { '@': ['C', 'Q'] },
    });
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
    const src = writeScreenCatalog(dest);
    expect(src).toContain('"html-login"');
    expect(src).toContain('"username"');
    expect(src).toContain('type: "field"');
    expect(src).not.toContain('parts: []');
    expect(src).toContain('export type Screens');
    expect(src).toContain('export type PartName');
    expect(src).not.toMatch(/\bas const\b/);
    expect(src).toContain('export type ScreenName');
    expect(src).toContain('export type ElementName');
    expect(fs.readFileSync(dest, 'utf8')).toBe(src);
    expect(fs.readFileSync(path.join(root, 'generated.ts'), 'utf8')).toContain('"html-login"');
    expect(readScreenCatalog()['html-login']).toEqual(['username', 'password']);
  });

  it('rejects path traversal in screen names', () => {
    expect(() => applyScreen('..')).toThrow(/invalid screen name/);
    expect(() => applyScreen('../elsewhere')).toThrow(/invalid screen name/);
  });
});
