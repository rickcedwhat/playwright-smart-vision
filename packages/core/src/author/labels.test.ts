import { describe, expect, it } from 'vitest';
import { clusterOcrWords, labelsFromOcr } from './labels.js';

describe('clusterOcrWords', () => {
  it('joins adjacent words on one line', () => {
    const joined = clusterOcrWords([
      { text: 'Customer', confidence: 90, x: 10, y: 10, width: 60, height: 12 },
      { text: 'Number:', confidence: 88, x: 76, y: 10, width: 55, height: 12 },
    ]);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.text).toBe('Customer Number:');
    expect(joined[0]!.width).toBe(121);
  });

  it('does not join a word on the next row', () => {
    const joined = clusterOcrWords([
      { text: 'Name:', confidence: 90, x: 10, y: 10, width: 40, height: 12 },
      { text: 'Address:', confidence: 90, x: 10, y: 40, width: 50, height: 12 },
    ]);
    expect(joined.map((item) => item.text)).toEqual(['Name:', 'Address:']);
  });
});

describe('labelsFromOcr', () => {
  const field = { id: 1, x: 200, y: 10, width: 80, height: 18 };

  it('keeps a label sitting to the left of a field', () => {
    const labels = labelsFromOcr(
      [{ text: 'Email:', confidence: 90, x: 140, y: 12, width: 48, height: 12 }],
      [field],
    );
    expect(labels).toEqual([
      { id: 1, x: 140, y: 12, width: 48, height: 12, text: 'Email:', confidence: 90 },
    ]);
  });

  it('drops text that lives inside a button', () => {
    const button = { id: 2, x: 10, y: 10, width: 90, height: 28 };
    const labels = labelsFromOcr(
      [{ text: 'Save', confidence: 95, x: 30, y: 16, width: 40, height: 12 }],
      [button],
    );
    expect(labels).toEqual([]);
  });

  it('drops punctuation-only glyphs', () => {
    const labels = labelsFromOcr(
      [{ text: '/', confidence: 90, x: 10, y: 10, width: 8, height: 12 }],
      [field],
    );
    expect(labels).toEqual([]);
  });

  it('keeps a long low-confidence caption with slashes', () => {
    const checkbox = { id: 1, x: 324, y: 344, width: 14, height: 18 };
    const labels = labelsFromOcr(
      [
        { text: 'New/Used', confidence: 0, x: 227, y: 348, width: 54, height: 8 },
        { text: 'Other:', confidence: 0, x: 285, y: 348, width: 33, height: 8 },
      ],
      [checkbox],
    );
    expect(labels).toEqual([
      { id: 1, x: 227, y: 348, width: 91, height: 8, text: 'New/Used Other:', confidence: 0 },
    ]);
  });

  it('drops a single letter and a /dd/ date scrap', () => {
    expect(labelsFromOcr(
      [{ text: 'I', confidence: 90, x: 10, y: 10, width: 8, height: 12 }],
      [field],
    )).toEqual([]);
    expect(labelsFromOcr(
      [{ text: '/dd/', confidence: 90, x: 10, y: 40, width: 20, height: 10 }],
      [field],
    )).toEqual([]);
  });

  it('drops OCR scraps whose center sits inside a field', () => {
    const cell = { id: 4, x: 640, y: 344, width: 20, height: 18 };
    expect(labelsFromOcr(
      [{ text: '(Y/Y', confidence: 80, x: 640, y: 344, width: 18, height: 10 }],
      [cell],
    )).toEqual([]);
  });

  it('keeps a checkbox caption even when the box sits inside the label', () => {
    const checkbox = { id: 3, x: 70, y: 10, width: 15, height: 18 };
    const labels = labelsFromOcr(
      [{ text: 'Do Not Call:', confidence: 90, x: 10, y: 12, width: 80, height: 12 }],
      [checkbox],
    );
    expect(labels).toEqual([
      { id: 1, x: 10, y: 12, width: 80, height: 12, text: 'Do Not Call:', confidence: 90 },
    ]);
  });
});
