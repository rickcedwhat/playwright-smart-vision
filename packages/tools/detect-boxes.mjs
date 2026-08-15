#!/usr/bin/env node
/**
 * Find empty input rectangles on a blank screenshot.
 * Writes boxes.json and boxes-annotated.png next to blank.png.
 *
 *   node tools/detect-boxes.mjs tests/screens/autosoft-customer-information
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cv from 'opencv.js';
import { PNG } from 'pngjs';
import { VisionUtil } from '@rickcedwhat/playwright-smart-vision/utils/vision';

const MIN_W = 14;
const MAX_W = 400;
const MIN_H = 12;
const MAX_H = 28;
const TARGET_H = 18;

export function detectBoxes(pngBuffer) {
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

  const raw = [];
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const rect = cv.boundingRect(contour);
    contour.delete();
    if (rect.width < MIN_W || rect.width > MAX_W) continue;
    if (rect.height < MIN_H || rect.height > MAX_H) continue;
    const roi = gray.roi(rect);
    const mean = cv.mean(roi)[0];
    roi.delete();
    if (mean < 205) continue;
    raw.push({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
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

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function score(box) {
  return -Math.abs(box.height - TARGET_H) * 10 + box.width * 0.01;
}

function dedupeBoxes(raw) {
  const sorted = [...raw].sort((a, b) => score(b) - score(a));
  const kept = [];
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

function numberBoxes(boxes) {
  return boxes.map((box, i) => ({ id: i + 1, ...box }));
}

export function annotateBoxes(pngBuffer, boxes) {
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

export function cropPng(pngBuffer, x, y, width, height) {
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

export function unionRects(rects) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function insetRect(rect, pad = 2) {
  return {
    x: rect.x + pad,
    y: rect.y + pad,
    width: Math.max(1, rect.width - pad * 2),
    height: Math.max(1, rect.height - pad * 2),
  };
}

/** Move a screen-space rect into the crop's coordinate system (same space as ocrRect). */
export function relativeToCrop(rect, crop) {
  return {
    x: rect.x - crop.x,
    y: rect.y - crop.y,
    width: rect.width,
    height: rect.height,
  };
}

/** Value box relative to the label crop. Dropdowns drop the spinner on the right. */
export function ocrRectFromBoxes(crop, fieldBoxes, type = 'field', pad = 2) {
  const union = unionRects(fieldBoxes);
  const rightTrim = type === 'dropdown' ? 16 : 0;
  return {
    x: union.x - crop.x + pad,
    y: union.y - crop.y + pad,
    width: Math.max(1, union.width - pad * 2 - rightTrim),
    height: Math.max(1, union.height - pad * 2),
  };
}

export function expandLeftForLabel(boxes, fieldBoxes, pad = 8, maxLabel = 140) {
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

function writeScreenBoxes(screenDir) {
  const blankPath = path.join(screenDir, 'blank.png');
  if (!fs.existsSync(blankPath)) {
    throw new Error(`No blank.png in ${screenDir}`);
  }
  const blank = fs.readFileSync(blankPath);
  const boxes = detectBoxes(blank);
  fs.writeFileSync(path.join(screenDir, 'boxes.json'), `${JSON.stringify({
    width: PNG.sync.read(blank).width,
    height: PNG.sync.read(blank).height,
    boxes,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(screenDir, 'boxes-annotated.png'), annotateBoxes(blank, boxes));
  return boxes;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const screenDir = path.resolve(process.argv[2] || 'tests/screens/autosoft-customer-information');
  const boxes = writeScreenBoxes(screenDir);
  console.log(`Wrote ${boxes.length} boxes in ${screenDir}`);
  for (const box of boxes) {
    console.log(`${String(box.id).padStart(3)}  ${box.x},${box.y} ${box.width}x${box.height}`);
  }
}
