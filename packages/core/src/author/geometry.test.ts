import { describe, it, expect } from 'vitest';
import {
  kebab,
  unionRects,
  insetRect,
  relativeToCrop,
  ocrRectFromBoxes,
  includeLabelForType,
  expandLeftForLabel,
  dedupeBoxes,
  dropNestedBoxes,
  splitMergedFields,
  numberBoxes,
  evenHorizontalSlices,
  findAlignedCells,
  findCellRow,
  splitRowGutters,
  sliceRectHorizontal,
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

describe('sliceRectHorizontal / evenHorizontalSlices', () => {
  it('splits a merged date box into thirds', () => {
    const box = { x: 640, y: 344, width: 81, height: 18 };
    const parts = evenHorizontalSlices(box, 3);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ x: 640, y: 344, width: 27, height: 18 });
    expect(parts[1]?.x).toBe(667);
    expect(parts[2]!.x + parts[2]!.width).toBe(721);
  });

  it('slices by explicit fractions', () => {
    expect(sliceRectHorizontal({ x: 10, y: 2, width: 100, height: 8 }, 0, 0.25)).toEqual({
      x: 10, y: 2, width: 25, height: 8,
    });
  });
});

describe('findAlignedCells', () => {
  it('picks the three white date cells and skips slash gutters', () => {
    const cols: number[] = [];
    const paint = (n: number, v: number) => {
      for (let i = 0; i < n; i++) cols.push(v);
    };
    paint(1, 38);
    paint(18, 238);
    paint(1, 39);
    paint(10, 228);
    paint(1, 39);
    paint(18, 238);
    paint(1, 38);
    paint(10, 228);
    paint(1, 39);
    paint(18, 238);
    paint(3, 38);
    const runs = findAlignedCells(cols, 3);
    expect(runs).toEqual([
      { start: 1, end: 19 },
      { start: 31, end: 49 },
      { start: 61, end: 79 },
    ]);
  });

  it('returns null when there is only one bright run', () => {
    expect(findAlignedCells(Array(80).fill(238), 3)).toBeNull();
  });
});

describe('findCellRow', () => {
  const paint = (cols: number[], n: number, v: number) => {
    for (let i = 0; i < n; i++) cols.push(v);
  };

  it('keeps unlike-width adjacent cells (sales agent id + name)', () => {
    const cols: number[] = [];
    paint(cols, 1, 38);
    paint(cols, 18, 238);
    paint(cols, 5, 38);
    paint(cols, 162, 238);
    paint(cols, 3, 38);
    expect(findCellRow(cols)).toEqual([
      { start: 1, end: 19 },
      { start: 24, end: 186 },
    ]);
  });

  it('keeps three similar date cells', () => {
    const cols: number[] = [];
    paint(cols, 1, 38);
    paint(cols, 18, 238);
    paint(cols, 12, 38);
    paint(cols, 18, 238);
    paint(cols, 12, 38);
    paint(cols, 18, 238);
    paint(cols, 3, 38);
    expect(findCellRow(cols)).toHaveLength(3);
  });

  it('returns null for a single empty field', () => {
    const cols: number[] = [];
    paint(cols, 1, 38);
    paint(cols, 242, 238);
    paint(cols, 3, 38);
    expect(findCellRow(cols)).toBeNull();
  });
});

describe('splitRowGutters', () => {
  const paint = (rows: number[], n: number, v: number) => {
    for (let i = 0; i < n; i++) rows.push(v);
  };

  it('slices a hairline-divided panel into one row per item', () => {
    const means: number[] = [];
    paint(means, 31, 255);
    for (let i = 0; i < 12; i++) {
      paint(means, 3, 209);
      paint(means, 31, 255);
    }
    const parent = { x: 168, y: 110, width: 218, height: means.length };
    const rows = splitRowGutters(parent, means);
    expect(rows).toHaveLength(13);
    expect(rows![0]).toMatchObject({ x: 168, y: 110, width: 218 });
    expect(rows![2]!.y - rows![1]!.y).toBe(34);
  });

  it('ignores a panel without repeating hairlines', () => {
    const means = Array(220).fill(243);
    expect(splitRowGutters({ x: 800, y: 320, width: 150, height: 220 }, means)).toBeNull();
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

describe('includeLabelForType / expandLeftForLabel', () => {
  it('includes labels for fields and dropdowns, not buttons', () => {
    expect(includeLabelForType('field')).toBe(true);
    expect(includeLabelForType('dropdown')).toBe(true);
    expect(includeLabelForType('button')).toBe(false);
    expect(includeLabelForType('icon')).toBe(false);
    expect(includeLabelForType('field', false)).toBe(false);
    expect(includeLabelForType('button', true)).toBe(true);
  });

  it('extends left from the field boxes', () => {
    const boxes = [
      { id: 1, x: 10, y: 10, width: 40, height: 16 },
      { id: 2, x: 60, y: 10, width: 80, height: 16 },
    ];
    const crop = expandLeftForLabel(boxes, [boxes[1]!]);
    expect(crop.x).toBeLessThan(60);
    expect(crop.x + crop.width).toBeGreaterThan(60 + 80);
  });

  it('does not walk left into dark window chrome', () => {
    const width = 200;
    const height = 40;
    const data = Buffer.alloc(width * height * 4, 245);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < 30; x++) {
        const i = (y * width + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
    const field = { id: 1, x: 80, y: 10, width: 50, height: 16 };
    const crop = expandLeftForLabel([], [field], 8, 140, { width, height, data });
    expect(crop.x).toBeGreaterThanOrEqual(30);
    expect(crop.x).toBeLessThan(80);
  });
});

describe('splitMergedFields', () => {
  it('drops the outer mm/dd/yy box and keeps inflated inner cells', () => {
    const parent = { x: 640, y: 384, width: 82, height: 18 };
    const kept = splitMergedFields([
      parent,
      { x: 642, y: 386, width: 18, height: 14 },
      { x: 672, y: 386, width: 18, height: 14 },
      { x: 702, y: 386, width: 18, height: 14 },
    ]);
    expect(kept).toEqual([
      { x: 640, y: 384, width: 22, height: 18 },
      { x: 670, y: 384, width: 22, height: 18 },
      { x: 700, y: 384, width: 22, height: 18 },
    ]);
  });

  it('keeps a single field that only has an inner inset', () => {
    const outer = { x: 785, y: 157, width: 22, height: 18 };
    const inner = { x: 787, y: 159, width: 18, height: 14 };
    expect(splitMergedFields([outer, inner])).toEqual([outer, inner]);
  });

  it('splits a wide control into unlike-width adjacent boxes (sales agent id + name)', () => {
    const parent = { x: 621, y: 217, width: 189, height: 18 };
    const left = { x: 623, y: 219, width: 18, height: 14 };
    const rest = { x: 646, y: 219, width: 160, height: 14 };
    expect(splitMergedFields([parent, left, rest])).toEqual([
      { x: 621, y: 217, width: 22, height: 18 },
      { x: 644, y: 217, width: 164, height: 18 },
    ]);
  });

  it('drops a wrapping panel and keeps the stacked buttons inside', () => {
    const panel = { x: 174, y: 58, width: 268, height: 520 };
    const buttons = Array.from({ length: 12 }, (_, i) => ({
      x: 178, y: 61 + i * 43, width: 261, height: 41,
    }));
    const kept = splitMergedFields([panel, ...buttons]);
    expect(kept).toHaveLength(12);
    expect(kept.some((box) => box.width === 268 && box.height === 520)).toBe(false);
    expect(kept.every((box) => box.height >= 41 && box.height <= 45)).toBe(true);
  });

  it('keeps a button that only contains small text scraps', () => {
    const button = { x: 178, y: 147, width: 261, height: 41 };
    const scraps = [
      { x: 200, y: 160, width: 40, height: 14 },
      { x: 250, y: 160, width: 40, height: 14 },
    ];
    expect(splitMergedFields([button, ...scraps])).toEqual([button, ...scraps]);
  });

  it('keeps a button that has a near-full inner inset plus a scrap', () => {
    const button = { x: 178, y: 147, width: 261, height: 41 };
    const inset = { x: 180, y: 149, width: 257, height: 37 };
    const scrap = { x: 200, y: 160, width: 40, height: 14 };
    expect(splitMergedFields([button, inset, scrap])).toEqual([button, inset, scrap]);
  });

  it('drops a short-wide header strip and keeps the inner fields', () => {
    const header = { x: 192, y: 89, width: 756, height: 38 };
    const fields = [
      { x: 331, y: 94, width: 76, height: 18 },
      { x: 466, y: 94, width: 70, height: 18 },
      { x: 588, y: 94, width: 147, height: 18 },
      { x: 917, y: 94, width: 14, height: 18 },
    ];
    const kept = splitMergedFields([header, ...fields]);
    expect(kept).toHaveLength(4);
    expect(kept.some((box) => box.width === 756)).toBe(false);
  });
});

describe('dropNestedBoxes', () => {
  it('keeps the outer button and drops inner text scraps', () => {
    const kept = dropNestedBoxes([
      { x: 200, y: 160, width: 40, height: 14 },
      { x: 178, y: 147, width: 261, height: 41 },
      { x: 180, y: 149, width: 257, height: 37 },
    ]);
    expect(kept).toEqual([{ x: 178, y: 147, width: 261, height: 41 }]);
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
