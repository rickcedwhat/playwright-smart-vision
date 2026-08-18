import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { VisionUtil, ensureCvReady, getCv } from '../utils/vision.js';
import type { Rect } from '../utils/vision.js';
import { dedupeBoxes, numberBoxes, type DetectedBox } from './geometry.js';
import { screenDir } from './storage.js';

const MIN_W = 14;
const MAX_W = 400;
const MIN_H = 12;
const MAX_H = 28;

export interface BoxesFile {
  width: number;
  height: number;
  boxes: DetectedBox[];
}

export interface DetectScreenResult {
  dir: string;
  boxesPath: string;
  annotatedPath: string;
  width: number;
  height: number;
  boxes: DetectedBox[];
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
    contour.delete();
    if (rect.width < MIN_W || rect.width > MAX_W) continue;
    if (rect.height < MIN_H || rect.height > MAX_H) continue;
    const roi = gray.roi(rect);
    const mean = cv.mean(roi)[0] as number;
    roi.delete();
    if (mean < 205) continue;
    raw.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }

  color.delete();
  gray.delete();
  edges.delete();
  closed.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  return numberBoxes(dedupeBoxes(raw));
}

export function annotateBoxes(pngBuffer: Buffer, boxes: DetectedBox[]): Buffer {
  const cv = getCv();
  const png = PNG.sync.read(pngBuffer);
  const mat = new cv.Mat(png.height, png.width, cv.CV_8UC4);
  mat.data.set(png.data);
  const color = new cv.Scalar(220, 40, 40, 255);
  const textColor = new cv.Scalar(180, 0, 0, 255);
  for (const box of boxes) {
    cv.rectangle(
      mat,
      new cv.Point(box.x, box.y),
      new cv.Point(box.x + box.width, box.y + box.height),
      color,
      1,
    );
    cv.putText(
      mat,
      String(box.id),
      new cv.Point(box.x + 1, Math.max(10, box.y - 2)),
      cv.FONT_HERSHEY_SIMPLEX,
      0.35,
      textColor,
      1,
    );
  }
  const out = new PNG({ width: png.width, height: png.height });
  out.data.set(mat.data);
  mat.delete();
  return PNG.sync.write(out);
}

/**
 * Run OpenCV box detection on `{storage.root}/{name}/blank.png`.
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
  const boxesPath = path.join(dir, 'boxes.json');
  const annotatedPath = path.join(dir, 'boxes-annotated.png');
  const payload: BoxesFile = { width: meta.width, height: meta.height, boxes };
  fs.writeFileSync(boxesPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(annotatedPath, annotateBoxes(blank, boxes));
  return { dir, boxesPath, annotatedPath, width: meta.width, height: meta.height, boxes };
}
