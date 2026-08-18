import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
  expandLeftForLabel,
  insetRect,
  kebab,
  ocrRectFromBoxes,
  relativeToCrop,
  type DetectedBox,
} from './geometry.js';
import type { BoxesFile } from './detect.js';
import { screenDir } from './storage.js';

export interface FirstPassPart {
  name: string;
  boxId: number;
}

export interface FirstPassElement {
  name: string;
  type?: string;
  section?: string | null;
  boxIds: number[];
  parts?: FirstPassPart[];
  charset?: string;
  options?: string[];
}

export interface FirstPass {
  screen?: { name?: string; width?: number; height?: number };
  notes?: string[];
  unknowns?: string[];
  sections?: unknown[];
  elements: FirstPassElement[];
}

export interface AppliedElement {
  name: string;
  filename: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  boxIds?: number[];
  charset?: string;
  options?: string[];
  ocrRect?: { x: number; y: number; width: number; height: number };
  parts?: Array<{ name: string; x: number; y: number; width: number; height: number }>;
}

export interface ApplyScreenResult {
  dir: string;
  indexPath: string;
  firstPassPath: string;
  elements: AppliedElement[];
}

function cropPng(pngBuffer: Buffer, x: number, y: number, width: number, height: number): Buffer {
  const png = PNG.sync.read(pngBuffer);
  const sx = Math.max(0, Math.round(x));
  const sy = Math.max(0, Math.round(y));
  const sw = Math.max(1, Math.min(png.width - sx, Math.round(width)));
  const sh = Math.max(1, Math.min(png.height - sy, Math.round(height)));
  const out = new PNG({ width: sw, height: sh });
  for (let row = 0; row < sh; row++) {
    const src = ((sy + row) * png.width + sx) * 4;
    out.data.set(png.data.subarray(src, src + sw * 4), row * sw * 4);
  }
  return PNG.sync.write(out);
}

function toIndex(name: string, elements: AppliedElement[]) {
  return {
    name,
    sections: [],
    elements,
  };
}

/**
 * Turn first-pass.json (boxIds) into templates/ + index.json.
 * Pass `firstPass` to write that file first (QA Wolf AI can hand the object in).
 */
export function applyScreen(name: string, firstPass?: FirstPass): ApplyScreenResult {
  const dir = screenDir(name);
  const firstPassPath = path.join(dir, 'first-pass.json');
  if (firstPass) {
    fs.writeFileSync(firstPassPath, `${JSON.stringify(firstPass, null, 2)}\n`);
  }
  const blankPath = path.join(dir, 'blank.png');
  const boxesPath = path.join(dir, 'boxes.json');
  if (!fs.existsSync(blankPath)) {
    throw new Error(`applyScreen('${name}'): no blank.png at ${blankPath}`);
  }
  if (!fs.existsSync(boxesPath)) {
    throw new Error(`applyScreen('${name}'): no boxes.json — call detectScreen('${name}') first`);
  }
  if (!fs.existsSync(firstPassPath)) {
    throw new Error(`applyScreen('${name}'): no first-pass.json — pass the AI naming result as the second argument`);
  }

  const blank = fs.readFileSync(blankPath);
  const { boxes } = JSON.parse(fs.readFileSync(boxesPath, 'utf8')) as BoxesFile;
  const pass = JSON.parse(fs.readFileSync(firstPassPath, 'utf8')) as FirstPass;
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const tmplDir = path.join(dir, 'templates');
  fs.rmSync(tmplDir, { recursive: true, force: true });
  fs.mkdirSync(tmplDir, { recursive: true });

  const elements: AppliedElement[] = [];
  for (const el of pass.elements || []) {
    const fieldBoxes = (el.boxIds || []).map((id) => byId.get(id)).filter((b): b is DetectedBox => Boolean(b));
    const crop = fieldBoxes.length ? expandLeftForLabel(boxes, fieldBoxes) : undefined;
    if (!crop) continue;
    const filename = `${kebab(el.name)}.png`;
    fs.writeFileSync(path.join(tmplDir, filename), cropPng(blank, crop.x, crop.y, crop.width, crop.height));
    const parts = (el.parts || [])
      .map((part) => {
        const box = byId.get(part.boxId);
        if (!box) return null;
        return { name: part.name, ...relativeToCrop(insetRect(box, 2), crop) };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const applied: AppliedElement = {
      name: el.name,
      filename,
      type: el.type || 'field',
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
    };
    if (el.boxIds?.length) applied.boxIds = el.boxIds;
    if (el.charset) applied.charset = el.charset;
    if (el.options?.length) applied.options = el.options;
    if (fieldBoxes.length) applied.ocrRect = ocrRectFromBoxes(crop, fieldBoxes, el.type || 'field');
    if (parts.length) applied.parts = parts;
    elements.push(applied);
  }

  const folder = pass.screen?.name || name;
  const indexPath = path.join(dir, 'index.json');
  fs.writeFileSync(indexPath, `${JSON.stringify(toIndex(folder, elements), null, 2)}\n`);

  return { dir, indexPath, firstPassPath, elements };
}
