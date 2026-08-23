import { containedRatio, unionRects, type DetectedBox } from './geometry.js';

export interface DetectedLabel {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence?: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function cleanText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function centerInside(inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }): boolean {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}

function letterCount(text: string): number {
  return (cleanText(text).match(/[A-Za-z]/g) || []).length;
}

/** Join words that sit on one line with a small gap ("Customer" + "Number:"). */
export function clusterOcrWords(words: OcrWord[], maxGap = 16): OcrWord[] {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: OcrWord[][] = [];
  for (const word of sorted) {
    const group = groups[groups.length - 1];
    if (!group) {
      groups.push([word]);
      continue;
    }
    const prev = group[group.length - 1]!;
    const sameRow = word.y < prev.y + prev.height && word.y + word.height > prev.y;
    const gap = word.x - (prev.x + prev.width);
    if (sameRow && gap >= -3 && gap <= maxGap) group.push(word);
    else groups.push([word]);
  }
  return groups.map((group) => {
    const union = unionRects(group);
    return {
      text: cleanText(group.map((item) => item.text).join(' ')),
      confidence: Math.min(...group.map((item) => item.confidence)),
      x: union.x,
      y: union.y,
      width: union.width,
      height: union.height,
    };
  });
}

/**
 * Turn OCR words into label boxes the AI can join to controls, and collect any
 * text found inside control boxes (button/dropdown/tab labels on the blank form).
 */
export function labelsAndValuesFromOcr(
  words: OcrWord[],
  boxes: DetectedBox[],
): { labels: DetectedLabel[]; boxValues: Map<number, string> } {
  const usable = words.filter((word) => {
    if (word.width < 4 || word.height < 5 || word.height > 48) return false;
    const letters = letterCount(word.text);
    if (letters < 1) return false;
    const conf = word.confidence ?? 100;
    if (conf >= 30) return true;
    // Slashes in "New/Used/Other:" often come back as confidence 0.
    return letters >= 4 && word.width >= 24;
  });
  const clustered = clusterOcrWords(usable);
  const boxValues = new Map<number, string>();
  const kept = clustered.filter((label) => {
    const text = cleanText(label.text);
    if (letterCount(text) < 2 || text.length > 80) return false;
    if (/^\/?[A-Za-z]{1,2}\/?$/.test(text)) return false;
    if (label.width > 420) return false;
    const insideBox = boxes.find((box) => containedRatio(label, box) >= 0.55 || centerInside(label, box));
    if (insideBox) {
      // Only capture value when: the box is tall enough to be a real control, and the phrase
      // is not wider than the box (which would indicate a neighbouring label bleeding in).
      if (insideBox.height >= 18 && label.width <= insideBox.width * 1.5) {
        const prev = boxValues.get(insideBox.id);
        boxValues.set(insideBox.id, prev ? `${prev} ${text}` : text);
      }
      return false;
    }
    // Checkboxes often sit inside the caption bbox; only drop if a field/button is inside.
    if (boxes.some((box) => box.width >= 40 && containedRatio(box, label) >= 0.45)) return false;
    return true;
  });
  const labels = kept
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((label, i) => ({
      id: i + 1,
      x: Math.round(label.x),
      y: Math.round(label.y),
      width: Math.max(1, Math.round(label.width)),
      height: Math.max(1, Math.round(label.height)),
      text: cleanText(label.text),
      confidence: label.confidence,
    }));
  // Post-process accumulated values: drop noise and strip leading icon glyphs.
  for (const [id, text] of boxValues) {
    if (letterCount(text) < 3) { boxValues.delete(id); continue; }
    // Strip leading tokens that look like icon glyph misreads: ≤3 chars with no lowercase letters.
    const tokens = text.split(' ');
    while (tokens.length > 1 && tokens[0]!.length <= 3 && !/[a-z]/.test(tokens[0]!)) tokens.shift();
    const cleaned = tokens.join(' ');
    if (letterCount(cleaned) < 3) { boxValues.delete(id); continue; }
    boxValues.set(id, cleaned);
  }
  return { labels, boxValues };
}

/** Turn OCR words into label boxes the AI can join to controls. Drops chrome inside fields/buttons. */
export function labelsFromOcr(words: OcrWord[], boxes: DetectedBox[]): DetectedLabel[] {
  return labelsAndValuesFromOcr(words, boxes).labels;
}

export function tessBBox(bbox: { x0?: number; y0?: number; x1?: number; y1?: number; x?: number; y?: number; width?: number; height?: number } | undefined): OcrWord | null {
  if (!bbox) return null;
  let x: number;
  let y: number;
  let width: number;
  let height: number;
  if (bbox.x0 != null && bbox.y0 != null && bbox.x1 != null && bbox.y1 != null) {
    x = bbox.x0;
    y = bbox.y0;
    width = bbox.x1 - bbox.x0;
    height = bbox.y1 - bbox.y0;
  } else if (bbox.width != null && bbox.height != null && bbox.x != null && bbox.y != null) {
    x = bbox.x;
    y = bbox.y;
    width = bbox.width;
    height = bbox.height;
  } else {
    return null;
  }
  if (width < 1 || height < 1) return null;
  return { text: '', confidence: 0, x, y, width, height };
}
