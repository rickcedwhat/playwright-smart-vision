// @ts-ignore - @techstark/opencv-js doesn't have complete type definitions
import cvModule from '@techstark/opencv-js';
import { PNG } from 'pngjs';

// The opencv-js package exports a Promise (WASM init), not the API directly.
// cv is set once ensureCvReady() resolves.
let cv: any = null;
const _cvInit = Promise.resolve(cvModule).then((resolved: any) => { cv = resolved; });

/** Await this before constructing a VisionUtil or calling any cv API. */
export async function ensureCvReady(): Promise<void> {
  await _cvInit;
}
import pixelmatch from 'pixelmatch';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MatchResult {
  location: Point;
  confidence: number;
  rect: Rect;
}

/**
 * Computer vision utilities for image processing, template matching, and alignment
 */
export class VisionUtil {
  /**
   * Load an image from a buffer into an OpenCV Mat
   */
  loadImage(buffer: Buffer): any {
    const png = PNG.sync.read(buffer);
    const mat = new cv.Mat(png.height, png.width, cv.CV_8UC4);
    mat.data.set(png.data);
    return mat;
  }

  /**
   * Convert a colored image to grayscale
   */
  toGrayscale(image: any): any {
    const gray = new cv.Mat();
    cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
    return gray;
  }

  /**
   * Perform template matching to find a template image within a larger image
   * Returns the best match location and confidence
   */
  matchTemplate(
    source: any,
    template: any,
    method: number = cv.TM_CCOEFF_NORMED
  ): MatchResult {
    const result = new cv.Mat();
    const mask = new cv.Mat();
    
    cv.matchTemplate(source, template, result, method, mask);
    
    const minMax = cv.minMaxLoc(result);
    const matchLoc = minMax.maxLoc;
    
    result.delete();
    mask.delete();
    
    return {
      location: { x: matchLoc.x, y: matchLoc.y },
      confidence: minMax.maxVal,
      rect: {
        x: matchLoc.x,
        y: matchLoc.y,
        width: template.cols,
        height: template.rows,
      },
    };
  }

  /**
   * Extract a region of interest (ROI) from an image
   */
  extractROI(image: any, rect: Rect): any {
    const roi = new cv.Rect(rect.x, rect.y, rect.width, rect.height);
    return image.roi(roi);
  }

  /**
   * Compare two images and count the number of different pixels
   * Returns the count and whether they're considered different
   */
  compareRegions(
    image1: any,
    image2: any,
    threshold = 80,
    minDiffPixels = 10
  ): { different: boolean; diffPixelCount: number; diffPercentage: number } {
    if (image1.rows !== image2.rows || image1.cols !== image2.cols) {
      return {
        different: true,
        diffPixelCount: -1,
        diffPercentage: 100,
      };
    }

    const diff = new cv.Mat();
    cv.absdiff(image1, image2, diff);
    
    cv.threshold(diff, diff, threshold, 255, cv.THRESH_BINARY);
    
    const diffPixelCount = cv.countNonZero(diff);
    const totalPixels = image1.rows * image1.cols;
    const diffPercentage = (diffPixelCount / totalPixels) * 100;
    
    diff.delete();
    
    return {
      different: diffPixelCount > minDiffPixels,
      diffPixelCount,
      diffPercentage,
    };
  }

  /**
   * Create a difference image highlighting where two images differ
   */
  createDiffImage(image1: any, image2: any, threshold = 80): any {
    const diff = new cv.Mat();
    cv.absdiff(image1, image2, diff);
    cv.threshold(diff, diff, threshold, 255, cv.THRESH_BINARY);
    return diff;
  }

  /**
   * Keep filled-form pixels that changed vs blank; paint unchanged pixels white.
   * Labels and box borders drop out so OCR reads only typed values.
   */
  isolateChangedForOcr(filled: any, blank: any, threshold = 50): any {
    if (filled.rows !== blank.rows || filled.cols !== blank.cols) {
      return filled.clone();
    }
    const diff = new cv.Mat();
    cv.absdiff(filled, blank, diff);
    const mask = new cv.Mat();
    cv.threshold(diff, mask, threshold, 255, cv.THRESH_BINARY);
    diff.delete();
    // White background; copy filled pixels only where they differ from blank.
    const white = new cv.Mat(filled.rows, filled.cols, filled.type(), new cv.Scalar(255, 255, 255, 255));
    filled.copyTo(white, mask);
    mask.delete();
    return white;
  }

  /**
   * Count pixels darker than `limit` (after converting color crops to gray).
   */
  countDarkPixels(image: any, limit = 200): number {
    let gray = image;
    let allocatedGray = false;
    if (image.channels() > 1) {
      gray = this.toGrayscale(image);
      allocatedGray = true;
    }
    let dark = 0;
    const data = gray.data;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < limit) dark += 1;
    }
    if (allocatedGray) gray.delete();
    return dark;
  }

  hasEnoughInk(image: any, minPixels = 8): boolean {
    return this.countDarkPixels(image) >= minPixels;
  }

  /**
   * Whether a checkbox crop looks checked.
   * Ignores the box border (inset) and looks for ink in the interior, so an
   * empty box is unchecked without a second template or a blank-screenshot match.
   */
  checkboxChecked(
    image: any,
    options: { inset?: number; darkLimit?: number; minInk?: number } = {},
  ): boolean {
    const inset = options.inset ?? 2;
    const darkLimit = options.darkLimit ?? 180;
    const minInk = options.minInk ?? 6;
    const padX = Math.min(inset, Math.max(0, Math.floor(image.cols / 4)));
    const padY = Math.min(inset, Math.max(0, Math.floor(image.rows / 4)));
    const width = image.cols - padX * 2;
    const height = image.rows - padY * 2;
    if (width < 2 || height < 2) {
      return this.countDarkPixels(image, darkLimit) >= minInk;
    }
    const inner = this.extractROI(image, { x: padX, y: padY, width, height });
    const dark = this.countDarkPixels(inner, darkLimit);
    inner.delete();
    return dark >= minInk;
  }

  ocrPrepOptions(
    image: any,
    options: { charset?: string; scale?: number } = {},
  ): { scale: number; threshold?: number } {
    const rows = image.rows ?? 0;
    // Fixed 200 on short crops turns @ into C. Otsu at 3× keeps the ring.
    let scale = 3;
    let threshold: number | undefined;
    if (options.charset?.includes('@')) {
      scale = 3;
    } else if (rows <= 24) {
      scale = 3;
      threshold = 200;
    }
    if (options.scale && options.scale >= 2 && options.scale <= 8) scale = options.scale;
    return threshold == null ? { scale } : { scale, threshold };
  }

  /**
   * Upscale, pad, and binarize a crop so Tesseract can read 18px UI text.
   * Short crops use a fixed threshold — Otsu on tiny digits fattens 0 into 8.
   */
  prepareForOcr(image: any, scale?: number, options: { threshold?: number; charset?: string } = {}): any {
    let gray = image;
    let allocatedGray = false;
    if (image.channels() > 1) {
      gray = this.toGrayscale(image);
      allocatedGray = true;
    }

    const auto = this.ocrPrepOptions(gray, options);
    const usedScale = scale ?? auto.scale;
    const threshold = options.threshold ?? auto.threshold;

    const scaled = new cv.Mat();
    cv.resize(
      gray,
      scaled,
      new cv.Size(Math.max(1, gray.cols * usedScale), Math.max(1, gray.rows * usedScale)),
      0,
      0,
      cv.INTER_CUBIC,
    );
    if (allocatedGray) gray.delete();

    const padded = new cv.Mat();
    cv.copyMakeBorder(scaled, padded, 8, 8, 8, 8, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
    scaled.delete();

    const binary = new cv.Mat();
    if (typeof threshold === 'number') {
      cv.threshold(padded, binary, threshold, 255, cv.THRESH_BINARY);
    } else {
      cv.threshold(padded, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    }
    padded.delete();
    return binary;
  }

  /**
   * Draw labeled rectangles on a clone of the screenshot (RGBA or gray).
   */
  annotateRects(
    image: any,
    boxes: Array<{
      rect: Rect;
      label?: string;
      color?: [number, number, number, number];
    }>,
  ): any {
    const out = image.clone();
    for (const box of boxes) {
      if (!box.rect.width || !box.rect.height) continue;
      const [r, g, b, a] = box.color ?? [75, 200, 120, 255];
      const color = new cv.Scalar(r, g, b, a);
      cv.rectangle(
        out,
        new cv.Point(Math.round(box.rect.x), Math.round(box.rect.y)),
        new cv.Point(
          Math.round(box.rect.x + box.rect.width),
          Math.round(box.rect.y + box.rect.height),
        ),
        color,
        2,
      );
      if (!box.label) continue;
      cv.putText(
        out,
        box.label,
        new cv.Point(Math.round(box.rect.x) + 2, Math.max(14, Math.round(box.rect.y) - 4)),
        cv.FONT_HERSHEY_SIMPLEX,
        0.45,
        color,
        1,
      );
    }
    return out;
  }

  /**
   * Align two images using feature detection and homography
   * This corrects for rotation, skew, and perspective differences
   */
  alignImages(filledForm: any, blankForm: any): any {
    if (filledForm.rows === blankForm.rows && filledForm.cols === blankForm.cols) {
      return filledForm.clone();
    }

    if (typeof cv.SIFT !== 'function') {
      throw new Error(
        'Filled and blank screenshots differ in size, and this OpenCV build cannot align them. Capture both at the same resolution.',
      );
    }

    // Detect SIFT features
    const sift = new cv.SIFT();
    
    const filledKeypoints = new cv.KeyPointVector();
    const filledDescriptors = new cv.Mat();
    sift.detectAndCompute(filledForm, new cv.Mat(), filledKeypoints, filledDescriptors);
    
    const blankKeypoints = new cv.KeyPointVector();
    const blankDescriptors = new cv.Mat();
    sift.detectAndCompute(blankForm, new cv.Mat(), blankKeypoints, blankDescriptors);
    
    // Match features using FLANN-based matcher
    const matcher = new cv.BFMatcher(cv.NORM_L2, false);
    const matches = new cv.DMatchVectorVector();
    matcher.knnMatch(filledDescriptors, blankDescriptors, matches, 2);
    
    // Filter matches using Lowe's ratio test
    const goodMatches: any[] = [];
    const ratioThresh = 0.7;
    
    for (let i = 0; i < matches.size(); i++) {
      const match = matches.get(i);
      if (match.size() >= 2) {
        const m1 = match.get(0);
        const m2 = match.get(1);
        if (m1.distance < ratioThresh * m2.distance) {
          goodMatches.push(m1);
        }
      }
    }
    
    // Extract point correspondences
    const filledPoints: number[] = [];
    const blankPoints: number[] = [];
    
    for (const match of goodMatches) {
      const filledPt = filledKeypoints.get(match.queryIdx).pt;
      const blankPt = blankKeypoints.get(match.trainIdx).pt;
      filledPoints.push(filledPt.x, filledPt.y);
      blankPoints.push(blankPt.x, blankPt.y);
    }
    
    // Find homography
    const filledMat = cv.matFromArray(
      goodMatches.length,
      1,
      cv.CV_32FC2,
      filledPoints
    );
    const blankMat = cv.matFromArray(
      goodMatches.length,
      1,
      cv.CV_32FC2,
      blankPoints
    );
    
    const homography = cv.findHomography(filledMat, blankMat, cv.RANSAC, 5.0);
    
    // Warp the filled form to align with blank
    const aligned = new cv.Mat();
    cv.warpPerspective(
      filledForm,
      aligned,
      homography,
      new cv.Size(blankForm.cols, blankForm.rows)
    );
    
    // Clean up
    filledKeypoints.delete();
    filledDescriptors.delete();
    blankKeypoints.delete();
    blankDescriptors.delete();
    matches.delete();
    filledMat.delete();
    blankMat.delete();
    homography.delete();
    
    return aligned;
  }

  /**
   * Convert a cv.Mat to a PNG buffer
   */
  matToBuffer(mat: any): Buffer {
    const width = mat.cols;
    const height = mat.rows;
    const png = new PNG({ width, height });
    const src = mat.data as Uint8Array;
    const pixels = width * height;

    if (src.length >= pixels * 4) {
      png.data.set(src.subarray(0, pixels * 4));
    } else if (src.length >= pixels * 3) {
      for (let i = 0; i < pixels; i++) {
        png.data[i * 4] = src[i * 3] ?? 0;
        png.data[i * 4 + 1] = src[i * 3 + 1] ?? 0;
        png.data[i * 4 + 2] = src[i * 3 + 2] ?? 0;
        png.data[i * 4 + 3] = 255;
      }
    } else {
      for (let i = 0; i < pixels; i++) {
        const value = src[i] ?? 0;
        png.data[i * 4] = value;
        png.data[i * 4 + 1] = value;
        png.data[i * 4 + 2] = value;
        png.data[i * 4 + 3] = 255;
      }
    }

    return PNG.sync.write(png);
  }

  /**
   * Use pixelmatch for fast pixel-level comparison
   * Returns the number of mismatched pixels
   */
  pixelMatch(
    img1: Buffer,
    img2: Buffer,
    options: {
      threshold?: number;
      includeAA?: boolean;
    } = {}
  ): { mismatchedPixels: number; diffBuffer: Buffer | null } {
    const png1 = PNG.sync.read(img1);
    const png2 = PNG.sync.read(img2);
    
    if (png1.width !== png2.width || png1.height !== png2.height) {
      throw new Error('Images must have the same dimensions');
    }
    
    const diff = new PNG({ width: png1.width, height: png1.height });
    
    const mismatchedPixels = pixelmatch(
      png1.data,
      png2.data,
      diff.data,
      png1.width,
      png1.height,
      {
        threshold: options.threshold ?? 0.1,
        includeAA: options.includeAA ?? false,
      }
    );
    
    return {
      mismatchedPixels,
      diffBuffer: PNG.sync.write(diff),
    };
  }
}
