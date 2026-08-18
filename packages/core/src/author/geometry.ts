import type { Rect } from '../utils/vision.js';

export interface DetectedBox extends Rect {
  id: number;
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

/** Value box relative to the label crop. Dropdowns drop the spinner on the right. */
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

export function expandLeftForLabel(
  boxes: DetectedBox[],
  fieldBoxes: DetectedBox[],
  pad = 8,
  maxLabel = 140,
): Rect {
  const ids = new Set(fieldBoxes.map((box) => box.id));
  const union = unionRects(fieldBoxes);
  const leftLimit = boxes
    .filter((box) => !ids.has(box.id))
    .filter((box) => box.x + box.width <= union.x + 2)
    .filter((box) => box.y < union.y + union.height && box.y + box.height > union.y)
    .reduce((max, box) => Math.max(max, box.x + box.width), union.x - maxLabel);
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
