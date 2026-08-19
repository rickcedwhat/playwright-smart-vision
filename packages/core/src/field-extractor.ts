import { VisionUtil } from './utils/vision.js';
import type { Rect, MatchResult } from './utils/vision.js';
import { OCRUtil, charsetForField, pickFromOptions } from './utils/ocr.js';
import * as fs from 'fs/promises';
import { ElementType } from './types.js';
import type { ElementConfig, ElementResult, ScreenComparison } from './types.js';
export { ElementType };
export type { ElementConfig, ElementResult, ScreenComparison };

function offsetRect(
  base: Rect,
  inner: Rect | undefined,
  maxWidth: number,
  maxHeight: number,
): Rect {
  if (!inner) return base;
  const x = Math.max(0, Math.round(base.x + inner.x));
  const y = Math.max(0, Math.round(base.y + inner.y));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(inner.width), maxWidth - x)),
    height: Math.max(1, Math.min(Math.round(inner.height), maxHeight - y)),
  };
}

function addOrigin(rect: Rect, origin: Rect | undefined): Rect {
  if (!origin) return rect;
  return { ...rect, x: rect.x + origin.x, y: rect.y + origin.y };
}

/** Expand a label-needle match to the full template size, clamped to the image. */
function templateRectAt(match: MatchResult, template: { cols: number; rows: number }, image: { cols: number; rows: number }): Rect {
  const x = Math.max(0, Math.round(match.rect.x));
  const y = Math.max(0, Math.round(match.rect.y));
  return {
    x,
    y,
    width: Math.max(1, Math.min(template.cols, image.cols - x)),
    height: Math.max(1, Math.min(template.rows, image.rows - y)),
  };
}



/**
 * Extracts UI element values from filled screens by comparing them to blank templates
 * 
 * @deprecated Class name is outdated. Functionality remains the same but considers renaming to ElementExtractor.
 */
export class FieldExtractor {
  private visionUtil: VisionUtil;
  private ocrUtil: OCRUtil;
  private blankForm: any | null = null;
  private filledForm: any | null = null;
  private blankColor: any | null = null;
  private filledColor: any | null = null;
  private debug: boolean;

  constructor(ocrUtil: OCRUtil, debug = false) {
    this.visionUtil = new VisionUtil();
    this.ocrUtil = ocrUtil;
    this.debug = debug;
  }

  /**
   * Load blank and live screenshots.
   * Blank is the whole screen; widgets on it can move. Do not warp the live
   * shot onto blank — match each template on both images independently.
   */
  async loadForms(blankFormPath: string, filledFormPath: string): Promise<void> {
    this.cleanup();
    const blankBuffer = await fs.readFile(blankFormPath);
    const filledBuffer = await fs.readFile(filledFormPath);

    const blankImage = this.visionUtil.loadImage(blankBuffer);
    const filledImage = this.visionUtil.loadImage(filledBuffer);

    this.blankColor = blankImage;
    this.filledColor = filledImage;
    this.blankForm = this.visionUtil.toGrayscale(blankImage);
    this.filledForm = this.visionUtil.toGrayscale(filledImage);

    if (this.debug) {
      console.log('Blank screenshot size:', this.blankForm.size());
      console.log('Live screenshot size:', this.filledForm.size());
    }
  }

  /**
   * Extract values from multiple UI elements
   */
  async extractElements(
    elementConfigs: readonly ElementConfig[] | ElementConfig[],
    options: { ocrThreshold?: number } = {},
  ): Promise<ScreenComparison> {
    if (!this.blankForm || !this.filledForm) {
      throw new Error('Forms not loaded. Call loadForms() first.');
    }

    const results: ElementResult[] = [];

    for (const config of elementConfigs) {
      const result = await this.extractElement(config, options);
      results.push(result);
    }

    const filledElements = results.filter((r) => !r.isEmpty).length;
    const emptyElements = results.filter((r) => r.isEmpty).length;

    return {
      elements: results,
      totalElements: results.length,
      filledElements,
      emptyElements,
    };
  }


  /**
   * Extract a single UI element value.
   * Match the template on blank (empty control) and on the live screenshot
   * (label needle so typed text does not tank confidence), then OCR the pair
   * of crops. Locations are live-screenshot coordinates for click/fill.
   */
  async extractElement(
    config: ElementConfig,
    options: { ocrThreshold?: number } = {},
  ): Promise<ElementResult> {
    if (!this.blankForm || !this.filledForm) {
      throw new Error('Forms not loaded. Call loadForms() first.');
    }

    if (config.customMatcher) {
      return await this.extractWithCustomMatcher(config);
    }

    let templatePath = config.templatePath;
    let activeVariant: string | undefined;

    if (!templatePath && config.variants) {
      const variantEntries = Object.entries(config.variants);
      if (variantEntries.length === 1) {
        const first = variantEntries[0];
        if (first) { templatePath = first[1].template; activeVariant = first[0]; }
      } else if (variantEntries.length > 1) {
        let bestConfidence = -1;
        for (const [name, variant] of variantEntries) {
          const buf = await fs.readFile(variant.template);
          const tmpl = this.visionUtil.toGrayscale(this.visionUtil.loadImage(buf));
          const needle = this.labelNeedle(tmpl, config);
          const match = this.visionUtil.matchTemplate(this.filledForm!, needle);
          if (needle !== tmpl) needle.delete();
          tmpl.delete();
          if (match.confidence > bestConfidence) {
            bestConfidence = match.confidence;
            activeVariant = name;
            templatePath = variant.template;
          }
        }
      }
    }

    if (!templatePath) {
      throw new Error(`Element "${config.name}" has no templatePath or variants`);
    }

    const templateBuffer = await fs.readFile(templatePath);
    const template = this.visionUtil.toGrayscale(
      this.visionUtil.loadImage(templateBuffer)
    );

    const located = await this.locateOnBoth(template, config);
    const blankRect = located.blankRect;
    const filledRect = located.filledRect;

    const readRect = offsetRect(filledRect, config.ocrRect, this.filledForm.cols, this.filledForm.rows);
    const blankReadRect = offsetRect(blankRect, config.ocrRect, this.blankForm.cols, this.blankForm.rows);
    const filledROI = this.visionUtil.extractROI(this.filledForm, readRect);
    const blankROI = this.visionUtil.extractROI(this.blankForm, blankReadRect);

    const threshold = config.animated ? 60 : 80;
    const minDiffPixels = config.animated ? 5 : 10;
    
    const comparison = this.visionUtil.compareRegions(
      filledROI, 
      blankROI, 
      threshold, 
      minDiffPixels
    );

    if (this.debug) {
      console.log(`Element "${config.name}" blank match:`, blankRect, located.blankConfidence);
      console.log(`Element "${config.name}" live match:`, filledRect, located.filledConfidence);
      console.log(
        `Field "${config.name}" diff pixels:`,
        comparison.diffPixelCount,
        `(${comparison.diffPercentage.toFixed(2)}%)`
      );
    }

    let value = '';
    let isEmpty = !comparison.different;
    let parts: ElementResult[] | undefined;
    let traceImage: Buffer | undefined;
    let traceName: string | undefined;
    const isCheckbox = config.type === 'checkbox' || config.isCheckbox;

    if (isCheckbox) {
      if (config.ocrRect) {
        value = this.visionUtil.checkboxChecked(filledROI) ? 'checked' : 'unchecked';
      } else {
        const vsTemplate = this.visionUtil.compareRegions(filledROI, template, threshold, minDiffPixels);
        value = vsTemplate.different ? 'checked' : 'unchecked';
      }
      traceImage = this.visionUtil.matToBuffer(filledROI);
      traceName = `checkbox:${config.name} → ${value}`;
      isEmpty = false;
    } else if (config.animated) {
      value = comparison.different ? 'visible' : 'hidden';
      isEmpty = !comparison.different;
    } else if (config.parts?.length) {
      const ocrThreshold = options.ocrThreshold ?? 50;
      parts = [];
      for (const part of config.parts) {
        const relative = { x: part.x, y: part.y, width: part.width, height: part.height };
        const filledPart = offsetRect(filledRect, relative, this.filledForm.cols, this.filledForm.rows);
        const blankPart = offsetRect(blankRect, relative, this.blankForm.cols, this.blankForm.rows);
        const read = await this.readChangedText(
          filledPart,
          blankPart,
          part.name,
          config.type,
          part.charset || config.charset,
          undefined,
          ocrThreshold,
        );
        parts.push({
          name: part.name,
          value: read.value,
          confidence: located.filledConfidence,
          location: filledPart,
          ocrLocation: filledPart,
          isEmpty: read.isEmpty,
          type: config.type,
          traceImage: read.traceImage,
          traceName: read.traceName,
        });
      }
      value = parts.map((part) => part.value).filter((text) => text.trim()).join(' ');
      isEmpty = parts.every((part) => part.isEmpty);
    } else {
      const ocrThreshold = options.ocrThreshold ?? 50;
      const read = await this.readChangedText(
        readRect,
        blankReadRect,
        config.name,
        config.type,
        config.charset,
        config.options,
        ocrThreshold,
      );
      value = read.value;
      isEmpty = read.isEmpty;
      traceImage = read.traceImage;
      traceName = read.traceName;
    }

    filledROI.delete();
    blankROI.delete();
    template.delete();
    located.cleanup();

    return {
      name: config.name,
      value,
      confidence: located.filledConfidence,
      location: filledRect,
      ocrLocation: readRect,
      blankLocation: blankRect,
      isEmpty,
      type: config.type,
      variant: activeVariant,
      parts,
      traceImage,
      traceName,
    };
  }

  /**
   * Match a field template on blank and on the live screenshot independently.
   * Java POC aligned scanned forms then cropped at blank coords; here the blank
   * is a full screen and windows can move, so each image gets its own match.
   */
  private async locateOnBoth(
    template: any,
    config: ElementConfig,
  ): Promise<{
    blankRect: Rect;
    filledRect: Rect;
    blankConfidence: number;
    filledConfidence: number;
    cleanup: () => void;
  }> {
    let sourceBlank = this.blankForm!;
    let sourceFilled = this.filledForm!;
    let blankOrigin: Rect | undefined;
    let filledOrigin: Rect | undefined;
    const toDelete: any[] = [];

    if (config.sectionTemplatePath) {
      const sectionTemplate = this.visionUtil.toGrayscale(
        this.visionUtil.loadImage(await fs.readFile(config.sectionTemplatePath)),
      );
      const blankSection = this.visionUtil.matchTemplate(this.blankForm!, sectionTemplate);
      const filledSection = this.visionUtil.matchTemplate(this.filledForm!, sectionTemplate);
      sectionTemplate.delete();
      // Search the element inside the matched section crop (dropdown+field strip, not full-width-below).
      const blankSectionRect = blankSection.rect;
      const filledSectionRect = filledSection.rect;
      const sectionBlank = this.visionUtil.extractROI(this.blankForm!, blankSectionRect);
      const sectionFilled = this.visionUtil.extractROI(this.filledForm!, filledSectionRect);
      if (sectionBlank.rows >= template.rows && sectionBlank.cols >= template.cols
        && sectionFilled.rows >= template.rows && sectionFilled.cols >= template.cols) {
        sourceBlank = sectionBlank;
        sourceFilled = sectionFilled;
        blankOrigin = blankSectionRect;
        filledOrigin = filledSectionRect;
      } else {
        sectionBlank.delete();
        sectionFilled.delete();
      }
    }

    const needle = this.labelNeedle(template, config);
    const blankMatch = this.visionUtil.matchTemplate(sourceBlank, needle);
    const filledMatch = this.visionUtil.matchTemplate(sourceFilled, needle);
    if (needle !== template) toDelete.push(needle);

    return {
      blankRect: addOrigin(templateRectAt(blankMatch, template, sourceBlank), blankOrigin),
      filledRect: addOrigin(templateRectAt(filledMatch, template, sourceFilled), filledOrigin),
      blankConfidence: blankMatch.confidence,
      filledConfidence: filledMatch.confidence,
      cleanup: () => {
        for (const mat of toDelete) mat.delete();
        if (sourceBlank !== this.blankForm) sourceBlank.delete();
        if (sourceFilled !== this.filledForm) sourceFilled.delete();
      },
    };
  }

  private labelNeedle(template: any, config: ElementConfig): any {
    const labelWidth = config.ocrRect?.x;
    if (labelWidth === undefined || labelWidth < 8 || labelWidth >= template.cols) {
      return template;
    }
    return this.visionUtil.extractROI(template, {
      x: 0,
      y: 0,
      width: labelWidth,
      height: template.rows,
    });
  }

  private async readChangedText(
    filledRect: Rect,
    blankRect: Rect,
    name: string,
    type: ElementConfig['type'],
    charsetPreset: string | undefined,
    options: string[] | undefined,
    ocrThreshold: number,
  ): Promise<{ value: string; isEmpty: boolean; traceImage: Buffer; traceName: string }> {
    const filledROI = this.visionUtil.extractROI(this.filledForm!, filledRect);
    const blankROI = this.visionUtil.extractROI(this.blankForm!, blankRect);
    const ocrImage = this.visionUtil.isolateChangedForOcr(filledROI, blankROI, ocrThreshold);
    let value = '';
    let isEmpty = true;
    let traceImage: Buffer;
    let traceName: string;
    if (this.visionUtil.hasEnoughInk(ocrImage, 3)) {
      const charset = charsetForField(name, type, charsetPreset);
      const charsetOpt = charset !== undefined ? { charset } : {};
      const prep = this.visionUtil.ocrPrepOptions(ocrImage, charsetOpt);
      const prepared = this.visionUtil.prepareForOcr(ocrImage, prep.scale, { ...prep, ...charsetOpt });
      const ocrBuffer = this.visionUtil.matToBuffer(prepared);
      value = pickFromOptions(
        await this.ocrUtil.extractText(ocrBuffer, charsetOpt),
        options,
      );
      prepared.delete();
      isEmpty = !value.trim();
      traceImage = ocrBuffer;
      traceName = `ocr:${name} → ${value || '(empty)'}`;
    } else {
      traceImage = this.visionUtil.matToBuffer(ocrImage);
      traceName = `ocr:${name} (not sent)`;
    }
    ocrImage.delete();
    filledROI.delete();
    blankROI.delete();
    return { value, isEmpty, traceImage, traceName };
  }

  /**
   * Match an element's template against a live screenshot (no blank alignment).
   * Uses the label portion when ocrRect is set so filled values do not tank confidence.
   */
  async locateOnScreenshot(screenshotPath: string, config: ElementConfig): Promise<ElementResult> {
    if (!config.templatePath) {
      throw new Error(`Element "${config.name}" has no templatePath`);
    }

    const shotColor = this.visionUtil.loadImage(await fs.readFile(screenshotPath));
    const shotGray = this.visionUtil.toGrayscale(shotColor);
    shotColor.delete();

    const templateColor = this.visionUtil.loadImage(await fs.readFile(config.templatePath));
    const template = this.visionUtil.toGrayscale(templateColor);
    templateColor.delete();

    const needle = this.labelNeedle(template, config);

    let match: MatchResult;
    try {
      match = this.visionUtil.matchTemplate(shotGray, needle);
    } catch {
      match = {
        location: { x: 0, y: 0 },
        confidence: 0,
        rect: { x: 0, y: 0, width: 0, height: 0 },
      };
    }

    const location = templateRectAt(match, template, shotGray);
    if (needle !== template) needle.delete();
    template.delete();
    shotGray.delete();

    return {
      name: config.name,
      value: '',
      confidence: match.confidence,
      location,
      isEmpty: true,
      type: config.type,
    };
  }

  /**
   * Extract element using custom matcher function
   */
  private async extractWithCustomMatcher(config: ElementConfig): Promise<ElementResult> {
    if (!config.customMatcher) {
      throw new Error('customMatcher is required');
    }
    
    if (!config.templatePath) {
      throw new Error(`Element "${config.name}" with customMatcher requires templatePath to locate the element`);
    }

    const templateBuffer = await fs.readFile(config.templatePath);
    const template = this.visionUtil.toGrayscale(
      this.visionUtil.loadImage(templateBuffer)
    );

    const located = await this.locateOnBoth(template, config);
    const filledROI = this.visionUtil.extractROI(this.filledForm!, located.filledRect);
    const blankROI = this.visionUtil.extractROI(this.blankForm!, located.blankRect);

    const context: import('./types.js').CustomMatcherContext = {
      blankROI,
      filledROI,
      templateROI: template,
      location: located.filledRect,
      config,
      utils: {
        createDiffImage: (roi1: any, roi2: any, threshold = 80) => 
          this.visionUtil.createDiffImage(roi1, roi2, threshold),
        isolateChangedForOcr: (filled: any, blank: any, threshold = 50) =>
          this.visionUtil.isolateChangedForOcr(filled, blank, threshold),
        matToBuffer: (mat: any) => 
          this.visionUtil.matToBuffer(mat),
        compareRegions: (roi1: any, roi2: any, threshold = 80, minDiffPixels = 10) => 
          this.visionUtil.compareRegions(roi1, roi2, threshold, minDiffPixels),
      },
    };

    const customResult = await config.customMatcher(context);

    filledROI.delete();
    blankROI.delete();
    template.delete();
    located.cleanup();

    return {
      name: config.name,
      value: customResult.value,
      confidence: customResult.confidence,
      location: located.filledRect,
      ocrLocation: located.filledRect,
      blankLocation: located.blankRect,
      isEmpty: customResult.isEmpty,
      type: config.type,
      metadata: customResult.metadata,
    };
  }

  /**
   * Clean up OpenCV matrices
   */
  cleanup(): void {
    if (this.blankForm) {
      this.blankForm.delete();
      this.blankForm = null;
    }
    if (this.filledForm) {
      this.filledForm.delete();
      this.filledForm = null;
    }
    if (this.blankColor) {
      this.blankColor.delete();
      this.blankColor = null;
    }
    if (this.filledColor) {
      this.filledColor.delete();
      this.filledColor = null;
    }
  }
}

