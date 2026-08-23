import type { Rect } from '../utils/vision.js';

export interface DetectedBox extends Rect {
  id: number;
  /** Text found inside the box on the blank screenshot (buttons, dropdowns, tabs). Absent when empty. */
  value?: string;
}

export interface BoxCluster {
  /** Box IDs that are spatially adjacent on the same visual row. */
  boxIds: number[];
}

export function kebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function unionRects(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function insetRect(rect: Rect, pad = 2): Rect {
  return {
    x: rect.x + pad,
    y: rect.y + pad,
    width: Math.max(1, rect.width - pad * 2),
    height: Math.max(1, rect.height - pad * 2),
  };
}

/** Move a screen-space rect into the crop's coordinate system. */
export function relativeToCrop(rect: Rect, crop: Rect): Rect {
  return {
    x: rect.x - crop.x,
    y: rect.y - crop.y,
    width: rect.width,
    height: rect.height,
  };
}

/** Slice a rect by horizontal fractions in [0, 1]. */
export function sliceRectHorizontal(rect: Rect, start: number, end: number): Rect {
  const left = rect.x + rect.width * start;
  const right = rect.x + rect.width * end;
  const x = Math.round(left);
  return {
    x,
    y: rect.y,
    width: Math.max(1, Math.round(right) - x),
    height: rect.height,
  };
}

export function evenHorizontalSlices(rect: Rect, count: number): Rect[] {
  const n = Math.max(1, count);
  return Array.from({ length: n }, (_, i) => sliceRectHorizontal(rect, i / n, (i + 1) / n));
}

/** Bright column runs inside a merged field (cells vs `/` gutters). */
export function findAlignedCells(
  columnMeans: number[],
  count: number,
  minWidth = 10,
  bright = 220,
): Array<{ start: number; end: number }> | null {
  if (count < 2 || columnMeans.length < count * minWidth) return null;
  const runs: Array<{ start: number; end: number }> = [];
  let start: number | null = null;
  for (let i = 0; i <= columnMeans.length; i++) {
    const on = i < columnMeans.length && columnMeans[i]! >= bright;
    if (on && start == null) start = i;
    if (!on && start != null) {
      if (i - start >= minWidth) runs.push({ start, end: i });
      start = null;
    }
  }
  if (runs.length < count) return null;
  const picked = [...runs]
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, count)
    .sort((a, b) => a.start - b.start);
  const widths = picked.map((run) => run.end - run.start);
  const maxW = Math.max(...widths);
  const minW = Math.min(...widths);
  if (minW < 1 || maxW > minW * 3) return null;
  return picked;
}

/** Bright cells in a row separated by dark gutters (dates, id + name). */
export function findCellRow(
  columnMeans: number[],
  minCount = 2,
  minWidth = 10,
  bright = 220,
): Array<{ start: number; end: number }> | null {
  const runs: Array<{ start: number; end: number }> = [];
  let start: number | null = null;
  for (let i = 0; i <= columnMeans.length; i++) {
    const on = i < columnMeans.length && columnMeans[i]! >= bright;
    if (on && start == null) start = i;
    if (!on && start != null) {
      if (i - start >= minWidth) runs.push({ start, end: i });
      start = null;
    }
  }
  if (runs.length < minCount || runs.length > 4) return null;
  return runs;
}

/** Short mid-gray bands between bright rows (repeating row gutters). */
export function findHairlineDividers(
  rowMeans: number[],
  midLo = 190,
  midHi = 225,
  bright = 248,
): number[] {
  const lines: number[] = [];
  let i = 0;
  while (i < rowMeans.length) {
    const value = rowMeans[i]!;
    if (value >= midLo && value <= midHi) {
      let j = i;
      while (j < rowMeans.length && rowMeans[j]! >= midLo && rowMeans[j]! <= midHi) j++;
      const len = j - i;
      const prevBright = i === 0 || rowMeans[i - 1]! >= bright;
      const nextBright = j >= rowMeans.length || rowMeans[j]! >= bright;
      if (len >= 2 && len <= 5 && prevBright && nextBright) {
        lines.push(i + Math.floor(len / 2));
      }
      i = j;
    } else {
      i++;
    }
  }
  return lines;
}

/** Slice a tall rect into rows when hairlines repeat. */
export function splitRowGutters(parent: Rect, rowMeans: number[]): Rect[] | null {
  const lines = findHairlineDividers(rowMeans);
  if (lines.length < 3) return null;
  const gaps = lines.slice(1).map((y, i) => y - lines[i]!);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
  if (median < 24 || median > 48) return null;
  if (gaps.some((gap) => gap < median * 0.75 || gap > median * 1.25)) return null;
  const bounds = [0, ...lines, parent.height];
  const rows: Rect[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const y0 = bounds[i]!;
    const height = bounds[i + 1]! - y0;
    if (height < 16) continue;
    rows.push({ x: parent.x, y: parent.y + y0, width: parent.width, height });
  }
  return rows.length >= 4 ? rows : null;
}

/** Split a rect on visible gutters: columns if short, rows if tall. */
export function splitBoxGutters(
  box: Rect,
  columnMeans: number[],
  rowMeans: number[],
): Rect[] | null {
  if (box.height <= 28 && box.width >= 48) {
    const runs = findCellRow(columnMeans);
    const span = runs ? runs.reduce((sum, run) => sum + (run.end - run.start), 0) : 0;
    if (runs && runs.length >= 2 && span >= box.width * 0.5) {
      return runs.map((run) => {
        const x = box.x + Math.max(0, run.start - 1);
        const right = box.x + Math.min(box.width, run.end + 1);
        return { x, y: box.y, width: Math.max(1, right - x), height: box.height };
      });
    }
  }
  if (box.height >= 80) return splitRowGutters(box, rowMeans);
  return null;
}

export function cellRunsToRects(
  parent: Rect,
  runs: Array<{ start: number; end: number }>,
  inset = 2,
): Rect[] {
  const y = parent.y + inset;
  const height = Math.max(1, parent.height - inset * 2);
  return runs.map((run) => ({
    x: parent.x + run.start,
    y,
    width: Math.max(1, run.end - run.start),
    height,
  }));
}

/** Value box relative to the match crop. Dropdowns drop the spinner on the right. */
export function ocrRectFromBoxes(
  crop: Rect,
  fieldBoxes: Rect[],
  type = 'field',
  pad = 2,
): Rect {
  const union = unionRects(fieldBoxes);
  const rightTrim = type === 'dropdown' ? 16 : 0;
  return {
    x: union.x - crop.x + pad,
    y: union.y - crop.y + pad,
    width: Math.max(1, union.width - pad * 2 - rightTrim),
    height: Math.max(1, union.height - pad * 2),
  };
}

/** Types that used to grow left by default. Apply now unions labelIds; includeLabel: true is the leftover. */
const LABEL_CROP_TYPES = new Set(['field', 'dropdown']);

export function includeLabelForType(type?: string, override?: boolean): boolean {
  if (override != null) return override;
  return LABEL_CROP_TYPES.has(type || 'field');
}

function columnMean(
  png: { width: number; height: number; data: Buffer | Uint8Array },
  x: number,
  y0: number,
  y1: number,
): number {
  const x0 = Math.round(x);
  if (x0 < 0 || x0 >= png.width) return 0;
  const top = Math.max(0, Math.round(y0));
  const bottom = Math.min(png.height, Math.round(y1));
  const rows = Math.max(1, bottom - top);
  let sum = 0;
  for (let y = top; y < bottom; y++) {
    const i = (y * png.width + x0) * 4;
    sum += (png.data[i]! + png.data[i + 1]! + png.data[i + 2]!) / 3;
  }
  return sum / rows;
}

/** First in-form x walking left from the field — stop before window chrome. */
export function formLeftEdge(
  png: { width: number; height: number; data: Buffer | Uint8Array },
  rect: Rect,
  dark = 40,
): number | null {
  const y0 = rect.y + 2;
  const y1 = rect.y + rect.height - 2;
  const start = Math.min(png.width - 1, Math.max(0, Math.round(rect.x) - 1));
  for (let x = start; x >= 0; x--) {
    if (columnMean(png, x, y0, y1) < dark) return x + 1;
  }
  return null;
}

/** Grow the crop left from the value box(es) to include the label. */
export function expandLeftForLabel(
  boxes: DetectedBox[],
  fieldBoxes: DetectedBox[],
  pad = 8,
  maxLabel = 140,
  png?: { width: number; height: number; data: Buffer | Uint8Array },
): Rect {
  const ids = new Set(fieldBoxes.map((box) => box.id));
  const union = unionRects(fieldBoxes);
  let leftLimit = union.x - maxLabel;
  const neighbor = boxes
    .filter((box) => !ids.has(box.id))
    .filter((box) => box.x + box.width <= union.x + 2)
    .filter((box) => box.y < union.y + union.height && box.y + box.height > union.y)
    .reduce((max, box) => Math.max(max, box.x + box.width), leftLimit);
  leftLimit = Math.max(leftLimit, neighbor);
  if (png) {
    const edge = formLeftEdge(png, union);
    if (edge != null) leftLimit = Math.max(leftLimit, edge);
  }
  const x = Math.max(0, Math.min(union.x - pad, Math.max(leftLimit + 4, union.x - maxLabel)));
  return {
    x,
    y: Math.max(0, union.y - 2),
    width: union.x + union.width - x + 2,
    height: union.height + 4,
  };
}

function overlapArea(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function score(box: Rect): number {
  return -Math.abs(box.height - 18) * 10 + box.width * 0.01;
}

export function containedRatio(inner: Rect, outer: Rect): number {
  const area = inner.width * inner.height;
  return area ? overlapArea(inner, outer) / area : 0;
}

/** Drop a container that already has inner cells. Keep the inners. */
export function splitMergedFields(boxes: Rect[], minKids = 2): Rect[] {
  const parents = boxes.filter((parent) => {
    const kids = boxes.filter((box) => box !== parent && containedRatio(box, parent) >= 0.7);
    if (kids.length < minKids || kids.length > 24) return false;
    const fieldKids = kids.filter((box) => box.height >= 12 && box.height <= 28 && box.width >= 14);
    if (parent.height <= 50 && parent.width >= parent.height * 8 && fieldKids.length >= 2) return true;
    const parentArea = parent.width * parent.height;
    const kidArea = kids.reduce((sum, box) => sum + box.width * box.height, 0);
    const maxKid = Math.max(...kids.map((box) => box.width * box.height));
    if (maxKid > parentArea * 0.85) return false;
    if (kidArea < parentArea * 0.35) return false;
    const union = unionRects(kids);
    return union.width >= parent.width * 0.5 || union.height >= parent.height * 0.5;
  });
  if (!parents.length) return boxes;
  const out: Rect[] = [];
  for (const box of boxes) {
    if (parents.includes(box)) continue;
    const parent = parents.find((p) => containedRatio(box, p) >= 0.7);
    if (parent) {
      const padX = Math.min(2, Math.max(0, box.x - parent.x));
      const padY = Math.min(2, Math.max(0, box.y - parent.y));
      out.push({
        x: box.x - padX,
        y: box.y - padY,
        width: box.width + padX * 2,
        height: box.height + padY * 2,
      });
    } else {
      out.push(box);
    }
  }
  return out;
}

/** Drop boxes that sit mostly inside a larger box (text scraps inside a button). */
export function dropNestedBoxes(boxes: Rect[], ratio = 0.7): Rect[] {
  const sorted = [...boxes].sort((a, b) => b.width * b.height - a.width * a.height);
  const kept: Rect[] = [];
  for (const box of sorted) {
    if (kept.some((outer) => containedRatio(box, outer) >= ratio)) continue;
    kept.push(box);
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function dedupeBoxes(raw: Rect[]): Rect[] {
  const sorted = [...raw].sort((a, b) => score(b) - score(a));
  const kept: Rect[] = [];
  for (const box of sorted) {
    const hit = kept.find((other) => {
      const overlap = overlapArea(box, other);
      const minArea = Math.min(box.width * box.height, other.width * other.height);
      return overlap > minArea * 0.55;
    });
    if (!hit) kept.push(box);
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function numberBoxes(boxes: Rect[]): DetectedBox[] {
  return boxes.map((box, i) => ({ id: i + 1, ...box }));
}
