import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
  cellRunsToRects,
  evenHorizontalSlices,
  expandLeftForLabel,
  findAlignedCells,
  insetRect,
  kebab,
  ocrRectFromBoxes,
  relativeToCrop,
  sliceRectHorizontal,
  unionRects,
  type DetectedBox,
} from './geometry.js';
import type { BoxesFile } from './detect.js';
import type { DetectedLabel } from './labels.js';
import { screenDir } from './storage.js';
import { writeScreenCatalog } from './catalog.js';

export interface FirstPassPart {
  name: string;
  type?: string;
  /** Detected box. Omit to split the parent field box left-to-right. */
  boxId?: number;
  /** Optional 0–1 span of the parent field union when boxId is omitted. */
  start?: number;
  end?: number;
  charset?: string;
  swaps?: Record<string, string | string[]>;
  overflow?: string;
  read?: string;
}

export interface FirstPassElement {
  name: string;
  type?: string;
  section?: string | null;
  boxIds: number[];
  /** Detected label ids to union into the crop (any side of the control). */
  labelIds?: number[];
  parts?: FirstPassPart[];
  charset?: string;
  swaps?: Record<string, string | string[]>;
  overflow?: string;
  /** How to read the value: `ocr` (default) or `clipboard`. */
  read?: string;
  options?: string[];
  /** If true and labelIds is empty, grow the crop left (legacy). Default is box-only. */
  includeLabel?: boolean;
}

export interface FirstPassSection {
  name: string;
  boxIds: number[];
}

export interface FirstPass {
  screen?: { name?: string; width?: number; height?: number };
  notes?: string[];
  unknowns?: string[];
  sections?: FirstPassSection[];
  elements: FirstPassElement[];
}

export interface AppliedSection {
  name: string;
  filename: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  labelIds?: number[];
  charset?: string;
  swaps?: Record<string, string | string[]>;
  overflow?: string;
  read?: string;
  options?: string[];
  section?: string;
  ocrRect?: { x: number; y: number; width: number; height: number };
  parts?: Array<{
    name: string;
    type?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    charset?: string;
    swaps?: Record<string, string | string[]>;
    overflow?: string;
    read?: string;
  }>;
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

function padRect(rect: { x: number; y: number; width: number; height: number }, pad: number) {
  return {
    x: Math.max(0, rect.x - pad),
    y: Math.max(0, rect.y - pad),
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

/** Union of assigned boxes + labels. Left-grow only when includeLabel is true and no labelIds. */
function cropForElement(
  el: FirstPassElement,
  boxes: DetectedBox[],
  fieldBoxes: DetectedBox[],
  labelRects: DetectedLabel[],
  png: { width: number; height: number; data: Buffer | Uint8Array },
  extraBoxes: DetectedBox[] = [],
) {
  const joined = [...fieldBoxes, ...labelRects, ...extraBoxes];
  if (!joined.length) return undefined;
  if (labelRects.length) return padRect(unionRects(joined), 4);
  if (el.includeLabel === true && fieldBoxes.length) {
    const grown = expandLeftForLabel(boxes, fieldBoxes, 8, 140, png);
    return extraBoxes.length ? unionRects([grown, ...extraBoxes]) : grown;
  }
  if (extraBoxes.length) return padRect(unionRects(joined), 2);
  return unionRects(fieldBoxes);
}

function toIndex(name: string, elements: AppliedElement[], sections: AppliedSection[]) {
  return {
    name,
    sections,
    elements,
  };
}

function columnMeans(png: { width: number; height: number; data: Buffer | Uint8Array }, rect: { x: number; y: number; width: number; height: number }): number[] {
  const y0 = Math.max(0, Math.round(rect.y) + 2);
  const y1 = Math.min(png.height, Math.round(rect.y + rect.height) - 2);
  const rows = Math.max(1, y1 - y0);
  const x0 = Math.round(rect.x);
  const width = Math.round(rect.width);
  const means: number[] = [];
  for (let dx = 0; dx < width; dx++) {
    const x = x0 + dx;
    if (x < 0 || x >= png.width) {
      means.push(0);
      continue;
    }
    let sum = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * png.width + x) * 4;
      sum += (png.data[i]! + png.data[i + 1]! + png.data[i + 2]!) / 3;
    }
    means.push(sum / rows);
  }
  return means;
}

function resolveParts(
  specs: FirstPassPart[],
  fieldBoxes: DetectedBox[],
  crop: { x: number; y: number; width: number; height: number },
  byId: Map<number, DetectedBox>,
  png?: { width: number; height: number; data: Buffer | Uint8Array },
  prevParts?: AppliedElement['parts'],
): NonNullable<AppliedElement['parts']> {
  if (!specs.length || !fieldBoxes.length) return [];
  const union = unionRects(fieldBoxes);
  const namesOnly = specs.every((part) => part.boxId == null);
  let cells: ReturnType<typeof cellRunsToRects> = [];
  if (namesOnly && png && specs.every((part) => part.start == null && part.end == null)) {
    const runs = findAlignedCells(columnMeans(png, union), specs.length);
    if (runs) cells = cellRunsToRects(union, runs);
  }
  const even = namesOnly && !cells.length
    ? evenHorizontalSlices(insetRect(union, 2), specs.length)
    : [];
  const prevByName = new Map((prevParts || []).map((part) => [part.name, part]));
  const out: NonNullable<AppliedElement['parts']> = [];
  for (let i = 0; i < specs.length; i++) {
    const part = specs[i]!;
    let rect;
    if (part.boxId != null) {
      const box = byId.get(part.boxId);
      if (!box) continue;
      rect = insetRect(box, 2);
    } else if (part.start != null && part.end != null) {
      rect = sliceRectHorizontal(insetRect(union, 2), part.start, part.end);
    } else if (cells[i]) {
      rect = cells[i]!;
    } else if (even[i]) {
      rect = even[i]!;
    } else {
      continue;
    }
    const prev = prevByName.get(part.name);
    const row: NonNullable<AppliedElement['parts']>[number] = {
      name: part.name,
      ...relativeToCrop(rect, crop),
    };
    const type = part.type ?? prev?.type;
    const charset = part.charset ?? prev?.charset;
    const swaps = part.swaps ?? prev?.swaps;
    const overflow = part.overflow ?? prev?.overflow;
    const read = part.read ?? prev?.read;
    if (type) row.type = type;
    if (charset) row.charset = charset;
    if (swaps) row.swaps = swaps;
    if (overflow) row.overflow = overflow;
    if (read) row.read = read;
    out.push(row);
  }
  return out;
}

function readPreviousIndex(dir: string): Map<string, AppliedElement> {
  const indexPath = path.join(dir, 'index.json');
  if (!fs.existsSync(indexPath)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { elements?: AppliedElement[] };
    return new Map((raw.elements || []).map((el) => [el.name, el]));
  } catch {
    return new Map();
  }
}

function pickOption<T>(next: T | undefined, prev: T | undefined): T | undefined {
  return next !== undefined ? next : prev;
}

/**
 * Turn first-pass.json (boxIds) into templates/ + index.json.
 * Pass `firstPass` to write that file first if you're generating it programmatically.
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
  const png = PNG.sync.read(blank);
  const boxesFile = JSON.parse(fs.readFileSync(boxesPath, 'utf8')) as BoxesFile;
  const { boxes } = boxesFile;
  const labels = boxesFile.labels || [];
  const pass = JSON.parse(fs.readFileSync(firstPassPath, 'utf8')) as FirstPass;
  const previous = readPreviousIndex(dir);
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const byLabel = new Map(labels.map((label) => [label.id, label]));
  const tmplDir = path.join(dir, 'templates');
  fs.rmSync(tmplDir, { recursive: true, force: true });
  fs.mkdirSync(tmplDir, { recursive: true });

  // Sections whose members should be merged into a single parent element with named parts.
  // A section is absorbed when it has at least one member element; the parent name is the
  // section name with the trailing "Section" suffix stripped.
  const membersBySection = new Map<string, FirstPassElement[]>();
  for (const el of pass.elements || []) {
    if (el.section) {
      const group = membersBySection.get(el.section) ?? [];
      group.push(el);
      membersBySection.set(el.section, group);
    }
  }
  const absorbedSections = new Set<string>();
  const syntheticElements: FirstPassElement[] = [];
  const usedParentNames = new Set<string>();
  for (const sec of pass.sections || []) {
    const members = membersBySection.get(sec.name);
    if (!members?.length) continue;
    absorbedSections.add(sec.name);
    const parentName = sec.name.replace(/Section$/, '') || sec.name;
    if (usedParentNames.has(parentName)) continue; // skip duplicates silently
    usedParentNames.add(parentName);
    const allLabelIds = [...new Set(members.flatMap((m) => m.labelIds ?? []))];
    syntheticElements.push({
      name: parentName,
      type: 'other',
      boxIds: sec.boxIds,
      labelIds: allLabelIds,
      parts: members.map((m) => ({
        name: m.name,
        ...(m.type ? { type: m.type } : {}),
        ...((m.boxIds ?? [])[0] != null ? { boxId: (m.boxIds ?? [])[0] } : {}),
      })),
    });
  }

  const indexSections: AppliedSection[] = [];
  const sectionFile = new Map<string, string>();
  const sectionBoxesByName = new Map<string, DetectedBox[]>();
  for (const sec of pass.sections || []) {
    if (absorbedSections.has(sec.name)) continue;
    const secBoxes = (sec.boxIds || []).map((id) => byId.get(id)).filter((b): b is DetectedBox => Boolean(b));
    if (!sec.name || !secBoxes.length) continue;
    const memberLabels = (pass.elements || [])
      .filter((el) => el.section === sec.name)
      .flatMap((el) => (el.labelIds || []).map((id) => byLabel.get(id)).filter((l): l is DetectedLabel => Boolean(l)));
    const union = unionRects([...secBoxes, ...memberLabels]);
    const crop = padRect(union, memberLabels.length ? 4 : 2);
    const filename = `section-${kebab(sec.name)}.png`;
    fs.writeFileSync(path.join(tmplDir, filename), cropPng(blank, crop.x, crop.y, crop.width, crop.height));
    indexSections.push({ name: sec.name, filename, ...crop });
    sectionFile.set(sec.name, filename);
    sectionBoxesByName.set(sec.name, secBoxes);
  }

  const allElements = [
    ...syntheticElements,
    ...(pass.elements || []).filter((el) => !el.section || !absorbedSections.has(el.section)),
  ];

  const elements: AppliedElement[] = [];
  for (const el of allElements) {
    const fieldBoxes = (el.boxIds || []).map((id) => byId.get(id)).filter((b): b is DetectedBox => Boolean(b));
    const labelRects = (el.labelIds || []).map((id) => byLabel.get(id)).filter((l): l is DetectedLabel => Boolean(l));
    const extraBoxes = el.section ? (sectionBoxesByName.get(el.section) || []) : [];
    const overlay = cropForElement(el, boxes, fieldBoxes, labelRects, png);
    const match = cropForElement(el, boxes, fieldBoxes, labelRects, png, extraBoxes);
    if (!match) continue;
    const filename = `${kebab(el.name)}.png`;
    fs.writeFileSync(path.join(tmplDir, filename), cropPng(blank, match.x, match.y, match.width, match.height));
    const prev = previous.get(el.name);
    const parts = resolveParts(el.parts || [], fieldBoxes, match, byId, png, prev?.parts);
    const shown = overlay || match;

    const applied: AppliedElement = {
      name: el.name,
      filename,
      type: el.type || 'field',
      x: shown.x,
      y: shown.y,
      width: shown.width,
      height: shown.height,
    };
    if (el.boxIds?.length) applied.boxIds = el.boxIds;
    if (el.labelIds?.length) applied.labelIds = el.labelIds;
    const charset = pickOption(el.charset, prev?.charset);
    const swaps = pickOption(el.swaps, prev?.swaps);
    const overflow = pickOption(el.overflow, prev?.overflow);
    const read = pickOption(el.read, prev?.read);
    if (charset) applied.charset = charset;
    if (swaps) applied.swaps = swaps;
    if (overflow) applied.overflow = overflow;
    if (read) applied.read = read;
    if (el.options?.length) applied.options = el.options;
    if (el.section) applied.section = sectionFile.get(el.section) || el.section;
    if (fieldBoxes.length && el.type !== 'other') applied.ocrRect = ocrRectFromBoxes(match, fieldBoxes, el.type || 'field');
    if (parts.length) applied.parts = parts;
    elements.push(applied);
  }

  const folder = pass.screen?.name || name;
  const indexPath = path.join(dir, 'index.json');
  fs.writeFileSync(indexPath, `${JSON.stringify(toIndex(folder, elements, indexSections), null, 2)}\n`);
  writeScreenCatalog();

  return { dir, indexPath, firstPassPath, elements };
}
