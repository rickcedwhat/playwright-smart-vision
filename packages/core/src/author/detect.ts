import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { VisionUtil, ensureCvReady, getCv } from '../utils/vision.js';
import type { Rect } from '../utils/vision.js';
import {
  dedupeBoxes,
  dropNestedBoxes,
  numberBoxes,
  splitBoxGutters,
  splitMergedFields,
  unionRects,
  type BoxCluster,
  type DetectedBox,
} from './geometry.js';
import { labelsAndValuesFromOcr, type DetectedLabel } from './labels.js';
import { getOCRUtil } from '../utils/ocr.js';
import { screenDir } from './storage.js';

const MIN = 10;
const EMPTY_MEAN = 205;
const FILLED_EXTENT = 0.88;
const LABEL_SCALE = 2;
/** Room for a caption sitting just outside the outermost control. */
const LABEL_PAD = 72;

export interface BoxesFile {
  width: number;
  height: number;
  boxes: DetectedBox[];
  labels?: DetectedLabel[];
  clusters?: BoxCluster[];
}

export interface DetectScreenResult {
  dir: string;
  boxesPath: string;
  annotatedPath: string;
  width: number;
  height: number;
  boxes: DetectedBox[];
  labels: DetectedLabel[];
}

function columnMeansGray(gray: { rows: number; cols: number; data: Uint8Array }, rect: Rect): number[] {
  const y0 = Math.max(0, rect.y + 2);
  const y1 = Math.min(gray.rows, rect.y + rect.height - 2);
  const rowCount = Math.max(1, y1 - y0);
  const means: number[] = [];
  for (let dx = 0; dx < rect.width; dx++) {
    const x = rect.x + dx;
    if (x < 0 || x >= gray.cols) {
      means.push(0);
      continue;
    }
    let sum = 0;
    for (let y = y0; y < y1; y++) {
      sum += gray.data[y * gray.cols + x]!;
    }
    means.push(sum / rowCount);
  }
  return means;
}

function rowMeansGray(gray: { rows: number; cols: number; data: Uint8Array }, rect: Rect): number[] {
  const x0 = Math.max(0, rect.x);
  const x1 = Math.min(gray.cols, rect.x + rect.width);
  const colCount = Math.max(1, x1 - x0);
  const means: number[] = [];
  for (let dy = 0; dy < rect.height; dy++) {
    const y = rect.y + dy;
    if (y < 0 || y >= gray.rows) {
      means.push(0);
      continue;
    }
    let sum = 0;
    for (let x = x0; x < x1; x++) {
      sum += gray.data[y * gray.cols + x]!;
    }
    means.push(sum / colCount);
  }
  return means;
}

function keepRect(
  rect: Rect,
  mean: number,
  vertices: number,
  extent: number,
  imgW: number,
  imgH: number,
): boolean {
  if (rect.width < MIN || rect.height < MIN) return false;
  if (rect.width > imgW * 0.85 || rect.height > imgH * 0.85) return false;
  return mean >= EMPTY_MEAN || (vertices === 4 && extent >= FILLED_EXTENT);
}

export function detectBoxes(pngBuffer: Buffer): DetectedBox[] {
  const cv = getCv();
  const vision = new VisionUtil();
  const color = vision.loadImage(pngBuffer);
  const gray = vision.toGrayscale(color);
  const edges = new cv.Mat();
  cv.Canny(gray, edges, 40, 120);
  const kernel = cv.Mat.ones(2, 2, cv.CV_8U);
  const closed = new cv.Mat();
  cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const raw: Rect[] = [];
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const rect = cv.boundingRect(contour) as Rect;
    const peri = cv.arcLength(contour, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, 0.04 * peri, true);
    const area = cv.contourArea(contour);
    const extent = area / (rect.width * rect.height || 1);
    let mean = 0;
    if (rect.width >= 2 && rect.height >= 2 && rect.x + rect.width <= gray.cols && rect.y + rect.height <= gray.rows) {
      const roi = gray.roi(rect);
      mean = cv.mean(roi)[0] as number;
      roi.delete();
    }
    if (keepRect(rect, mean, approx.rows, extent, gray.cols, gray.rows)) {
      raw.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    approx.delete();
    contour.delete();
  }

  const split = raw.flatMap((box) => splitBoxGutters(box, columnMeansGray(gray, box), rowMeansGray(gray, box)) || [box]);
  const cells = split.filter((box) => box.height < 80);

  color.delete();
  gray.delete();
  edges.delete();
  closed.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  return numberBoxes(dedupeBoxes(dropNestedBoxes(splitMergedFields(cells))));
}

export function annotateBoxes(pngBuffer: Buffer, boxes: DetectedBox[], labels: DetectedLabel[] = []): Buffer {
  const cv = getCv();
  const png = PNG.sync.read(pngBuffer);
  const mat = new cv.Mat(png.height, png.width, cv.CV_8UC4);
  mat.data.set(png.data);
  const boxColor = new cv.Scalar(220, 40, 40, 255);
  const boxText = new cv.Scalar(180, 0, 0, 255);
  const labelColor = new cv.Scalar(30, 140, 200, 255);
  const labelText = new cv.Scalar(20, 90, 150, 255);
  for (const box of boxes) {
    cv.rectangle(
      mat,
      new cv.Point(box.x, box.y),
      new cv.Point(box.x + box.width, box.y + box.height),
      boxColor,
      1,
    );
    cv.putText(
      mat,
      String(box.id),
      new cv.Point(box.x + 1, Math.max(10, box.y - 2)),
      cv.FONT_HERSHEY_SIMPLEX,
      0.35,
      boxText,
      1,
    );
  }
  for (const label of labels) {
    cv.rectangle(
      mat,
      new cv.Point(label.x, label.y),
      new cv.Point(label.x + label.width, label.y + label.height),
      labelColor,
      1,
    );
    cv.putText(
      mat,
      `L${label.id}`,
      new cv.Point(label.x + 1, Math.max(10, label.y - 2)),
      cv.FONT_HERSHEY_SIMPLEX,
      0.32,
      labelText,
      1,
    );
  }
  const out = new PNG({ width: png.width, height: png.height });
  out.data.set(mat.data);
  mat.delete();
  return PNG.sync.write(out);
}

function cropPngBuffer(pngBuffer: Buffer, x: number, y: number, width: number, height: number): Buffer {
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

function labelRoi(boxes: DetectedBox[], imgW: number, imgH: number): Rect {
  if (!boxes.length) return { x: 0, y: 0, width: imgW, height: imgH };
  const union = unionRects(boxes);
  const x = Math.max(0, union.x - LABEL_PAD);
  const y = Math.max(0, union.y - LABEL_PAD);
  const right = Math.min(imgW, union.x + union.width + LABEL_PAD);
  const bottom = Math.min(imgH, union.y + union.height + LABEL_PAD);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function scaleGrayPng(pngBuffer: Buffer, scale: number): Buffer {
  const cv = getCv();
  const vision = new VisionUtil();
  const color = vision.loadImage(pngBuffer);
  const gray = vision.toGrayscale(color);
  color.delete();
  const scaled = new cv.Mat();
  cv.resize(
    gray,
    scaled,
    new cv.Size(Math.max(1, gray.cols * scale), Math.max(1, gray.rows * scale)),
    0,
    0,
    cv.INTER_CUBIC,
  );
  gray.delete();
  const buf = vision.matToBuffer(scaled);
  scaled.delete();
  return buf;
}

async function detectLabelsAndValues(
  pngBuffer: Buffer,
  boxes: DetectedBox[],
): Promise<{ labels: DetectedLabel[]; boxValues: Map<number, string> }> {
  const png = PNG.sync.read(pngBuffer);
  const roi = labelRoi(boxes, png.width, png.height);
  const cropped = cropPngBuffer(pngBuffer, roi.x, roi.y, roi.width, roi.height);
  const scaled = scaleGrayPng(cropped, LABEL_SCALE);
  const ocr = await getOCRUtil();
  const words = await ocr.extractPageWords(scaled);
  const mapped = words.map((word) => ({
    ...word,
    x: word.x / LABEL_SCALE + roi.x,
    y: word.y / LABEL_SCALE + roi.y,
    width: word.width / LABEL_SCALE,
    height: word.height / LABEL_SCALE,
  }));
  return labelsAndValuesFromOcr(mapped, boxes);
}

/** Group boxes that share the same visual row and are closely adjacent (gap ≤ 8px). */
export function groupBoxClusters(boxes: DetectedBox[]): BoxCluster[] {
  const ROW_TOL = 10;
  const GAP_MAX = 8;
  const sorted = [...boxes].sort((a, b) => {
    const cy = (b: DetectedBox) => b.y + b.height / 2;
    return cy(a) - cy(b) || a.x - b.x;
  });
  const rows: DetectedBox[][] = [];
  for (const box of sorted) {
    const cy = box.y + box.height / 2;
    const row = rows.find((r) => {
      const rcy = r[0]!.y + r[0]!.height / 2;
      return Math.abs(cy - rcy) <= ROW_TOL;
    });
    if (row) row.push(box);
    else rows.push([box]);
  }
  const clusters: BoxCluster[] = [];
  for (const row of rows) {
    const byX = [...row].sort((a, b) => a.x - b.x);
    let run: DetectedBox[] = [byX[0]!];
    for (let i = 1; i < byX.length; i++) {
      const prev = run[run.length - 1]!;
      const gap = byX[i]!.x - (prev.x + prev.width);
      if (gap <= GAP_MAX) {
        run.push(byX[i]!);
      } else {
        if (run.length >= 2) clusters.push({ boxIds: run.map((b) => b.id) });
        run = [byX[i]!];
      }
    }
    if (run.length >= 2) clusters.push({ boxIds: run.map((b) => b.id) });
  }
  return clusters;
}

function writeDetectFiles(
  dir: string,
  blank: Buffer,
  meta: { width: number; height: number },
  boxes: DetectedBox[],
  labels: DetectedLabel[],
  clusters?: BoxCluster[],
): { boxesPath: string; annotatedPath: string } {
  const boxesPath = path.join(dir, 'boxes.json');
  const annotatedPath = path.join(dir, 'boxes-annotated.png');
  const payload: BoxesFile = { width: meta.width, height: meta.height, boxes, labels };
  if (clusters && clusters.length > 0) payload.clusters = clusters;
  fs.writeFileSync(boxesPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(annotatedPath, annotateBoxes(blank, boxes, labels));
  return { boxesPath, annotatedPath };
}

/**
 * Run OpenCV box detection + OCR labels on `{storage.root}/{name}/blank.png`.
 * Writes `boxes.json` and `boxes-annotated.png` next to the blank.
 */
export async function detectScreen(name: string): Promise<DetectScreenResult> {
  await ensureCvReady();
  const dir = screenDir(name);
  const blankPath = path.join(dir, 'blank.png');
  if (!fs.existsSync(blankPath)) {
    throw new Error(`detectScreen('${name}'): no blank.png at ${blankPath} — capture with saveScreen() or the eye FAB first`);
  }
  const blank = fs.readFileSync(blankPath);
  const meta = PNG.sync.read(blank);
  const boxes = detectBoxes(blank);
  const { labels, boxValues } = await detectLabelsAndValues(blank, boxes);
  for (const box of boxes) {
    const val = boxValues.get(box.id);
    if (val) box.value = val;
  }
  const clusters = groupBoxClusters(boxes);
  const { boxesPath, annotatedPath } = writeDetectFiles(dir, blank, meta, boxes, labels, clusters);
  return { dir, boxesPath, annotatedPath, width: meta.width, height: meta.height, boxes, labels };
}

/** Persist boxes (including hand-drawn) and rewrite boxes-annotated.png. Keeps existing labels. */
export async function writeBoxes(name: string, boxes: DetectedBox[]): Promise<DetectScreenResult> {
  await ensureCvReady();
  const dir = screenDir(name);
  const blankPath = path.join(dir, 'blank.png');
  if (!fs.existsSync(blankPath)) {
    throw new Error(`writeBoxes('${name}'): no blank.png at ${blankPath}`);
  }
  const blank = fs.readFileSync(blankPath);
  const meta = PNG.sync.read(blank);
  const clean = boxes
    .map((box) => ({
      id: Number(box.id),
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height)),
    }))
    .sort((a, b) => a.id - b.id);
  const boxesPath = path.join(dir, 'boxes.json');
  let labels: DetectedLabel[] = [];
  if (fs.existsSync(boxesPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(boxesPath, 'utf8')) as BoxesFile;
      labels = prev.labels || [];
    } catch {
      labels = [];
    }
  }
  const written = writeDetectFiles(dir, blank, meta, clean, labels);
  return {
    dir,
    boxesPath: written.boxesPath,
    annotatedPath: written.annotatedPath,
    width: meta.width,
    height: meta.height,
    boxes: clean,
    labels,
  };
}
