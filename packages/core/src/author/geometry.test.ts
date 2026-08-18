import { describe, it, expect } from 'vitest';
import {
  kebab,
  unionRects,
  insetRect,
  relativeToCrop,
  ocrRectFromBoxes,
  expandLeftForLabel,
  dedupeBoxes,
  numberBoxes,
} from './geometry.js';

describe('kebab', () => {
  it('converts camelCase to kebab-case', () => {
    expect(kebab('lastName')).toBe('last-name');
    expect(kebab('htmlLogin')).toBe('html-login');
  });
});

describe('unionRects / insetRect / relativeToCrop', () => {
  it('unions two rects', () => {
    expect(unionRects([
      { x: 10, y: 10, width: 10, height: 10 },
      { x: 20, y: 5, width: 10, height: 20 },
    ])).toEqual({ x: 10, y: 5, width: 20, height: 20 });
  });

  it('insets a rect', () => {
    expect(insetRect({ x: 0, y: 0, width: 10, height: 10 }, 2)).toEqual({
      x: 2, y: 2, width: 6, height: 6,
    });
  });

  it('shifts a rect into crop space', () => {
    expect(relativeToCrop(
      { x: 50, y: 60, width: 10, height: 8 },
      { x: 40, y: 50, width: 30, height: 20 },
    )).toEqual({ x: 10, y: 10, width: 10, height: 8 });
  });
});

describe('ocrRectFromBoxes', () => {
  it('is relative to the crop and trims dropdowns', () => {
    const crop = { x: 0, y: 0, width: 100, height: 20 };
    const box = { x: 10, y: 2, width: 80, height: 16 };
    expect(ocrRectFromBoxes(crop, [box], 'field', 2)).toEqual({
      x: 12, y: 4, width: 76, height: 12,
    });
    expect(ocrRectFromBoxes(crop, [box], 'dropdown', 2).width).toBe(60);
  });
});

describe('expandLeftForLabel', () => {
  it('extends left from the field boxes', () => {
    const boxes = [
      { id: 1, x: 10, y: 10, width: 40, height: 16 },
      { id: 2, x: 60, y: 10, width: 80, height: 16 },
    ];
    const crop = expandLeftForLabel(boxes, [boxes[1]!]);
    expect(crop.x).toBeLessThan(60);
    expect(crop.x + crop.width).toBeGreaterThan(60 + 80);
  });
});

describe('dedupeBoxes / numberBoxes', () => {
  it('drops overlapping duplicates and numbers survivors', () => {
    const numbered = numberBoxes(dedupeBoxes([
      { x: 0, y: 0, width: 20, height: 18 },
      { x: 1, y: 1, width: 20, height: 18 },
      { x: 100, y: 0, width: 20, height: 18 },
    ]));
    expect(numbered).toHaveLength(2);
    expect(numbered[0]?.id).toBe(1);
    expect(numbered[1]?.id).toBe(2);
  });
});
