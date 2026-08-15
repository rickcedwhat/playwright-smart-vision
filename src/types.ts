import type { FieldRead, OcrOverflow, OcrSwaps } from './utils/ocr.js';

/**
 * Types of UI elements that can be extracted
 */
export enum ElementType {
  FIELD = 'field',           // Text input, textarea
  BUTTON = 'button',         // Button, submit button
  CHECKBOX = 'checkbox',     // Checkbox
  RADIO = 'radio',          // Radio button
  LINK = 'link',            // Hyperlink
  ICON = 'icon',            // Icon, status indicator
  LABEL = 'label',          // Text label
  DROPDOWN = 'dropdown',    // Select dropdown
  TAB = 'tab',             // Tab navigation
  TOGGLE = 'toggle',        // Toggle switch
  MESSAGE = 'message',      // Error/success message
  OTHER = 'other',          // Other UI element
}

/**
 * Variant configuration for elements with multiple states
 */
export interface ElementVariant {
  /** Path to template for this variant */
  template: string;
  
  /** Optional: Additional metadata for this variant */
  metadata?: Record<string, any>;
}

/**
 * Context provided to custom matcher functions
 */
export interface CustomMatcherContext {
  /** Region from blank form/screen */
  blankROI: any; // cv.Mat
  
  /** Region from filled form/screen */
  filledROI: any; // cv.Mat
  
  /** Template that was matched to find this location */
  templateROI: any; // cv.Mat
  
  /** Location where element was found */
  location: Rect;
  
  /** Element configuration */
  config: ElementConfig;
  
  /** Utility functions */
  utils: {
    /** Create difference image between two regions */
    createDiffImage: (roi1: any, roi2: any, threshold?: number) => any;

    /** Keep filled pixels that changed vs blank; unchanged pixels become white */
    isolateChangedForOcr: (filled: any, blank: any, threshold?: number) => any;
    
    /** Convert Mat to buffer for OCR */
    matToBuffer: (mat: any) => Buffer;
    
    /** Compare two regions and get pixel difference stats */
    compareRegions: (roi1: any, roi2: any, threshold?: number, minDiffPixels?: number) => {
      different: boolean;
      diffPixelCount: number;
      diffPercentage: number;
    };
  };
}

/**
 * Result from custom matcher function
 */
export interface CustomMatcherResult {
  /** Extracted value */
  value: string;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Whether element is in empty/default state */
  isEmpty: boolean;
  
  /** Optional: Additional metadata */
  metadata?: Record<string, any> | undefined;
}

/**
 * Custom matcher function type
 */
export type CustomMatcherFunction = (
  context: CustomMatcherContext
) => Promise<CustomMatcherResult> | CustomMatcherResult;

/**
 * Configuration for a single UI element to extract
 */
export interface ElementConfig {
  /** Unique identifier for this element */
  name: string;
  
  /** Path to the template image for this element (if no variants) */
  templatePath?: string | undefined;
  
  /** Variants of this element (e.g., enabled/disabled button) */
  variants?: Record<string, ElementVariant> | undefined;
  
  /** Optional: Path to section template if element is within a specific section */
  sectionTemplatePath?: string | undefined;
  
  /** Type of UI element */
  type?: ElementType | undefined;
  
  /** 
   * Whether this element is animated/changes frequently
   * Animated elements use looser matching and skip exact pixel comparison
   */
  animated?: boolean | undefined;
  
  /**
   * Custom matcher function for advanced use cases
   * Provides full control over element matching and value extraction
   * Example: Extract progress percentage from progress bar
   */
  customMatcher?: CustomMatcherFunction | undefined;
  
  /** Deprecated: Use type: ElementType.CHECKBOX instead */
  isCheckbox?: boolean | undefined;

  /** Optional dropdown choices. When set, OCR is snapped to the closest option. */
  options?: string[] | undefined;

  /** Value box inside the match crop (label stays in the template, OCR reads this). */
  ocrRect?: Rect | undefined;

  /** Character whitelist preset: auto, text, digits, alnum, email, vin. */
  charset?: string | undefined;

  /** Expected glyph → OCR glyphs allowed in its place. */
  swaps?: OcrSwaps | undefined;

  /**
   * Value may clip in the box. `end` = prefix plus up to 2 garbage glyphs at the cut.
   */
  overflow?: OcrOverflow | undefined;

  /** How to read the value. Default `ocr`. `clipboard` is click / select-all / copy. */
  read?: FieldRead | undefined;

  /**
   * Inner boxes to OCR separately after one parent match.
   * Rects are relative to the match crop (same space as ocrRect).
   */
  parts?: FieldPart[] | undefined;
}

/** One inner value box on a shared-label row (name, city/state, phones). */
export interface FieldPart extends Rect {
  name: string;
  charset?: string | undefined;
  swaps?: OcrSwaps | undefined;
  overflow?: OcrOverflow | undefined;
  read?: FieldRead | undefined;
}

/**
 * Result from extracting a single element
 */
export interface ElementResult {
  /** Element name/identifier */
  name: string;
  
  /** Extracted value (text for fields, "checked"/"unchecked" for checkboxes, etc.) */
  value: string;
  
  /** Match confidence score (0-1) */
  confidence?: number | undefined;
  
  /** Location of the element on screen */
  location: Rect;

  /** Value box in screen space (label crop stays on `location`). Used by fill(). */
  ocrLocation?: Rect | undefined;

  /** Template match on blank.png. Differs from `location` when the window moved. */
  blankLocation?: Rect | undefined;
  
  /** Whether the element is in its empty/default state */
  isEmpty: boolean;
  
  /** Type of element */
  type?: ElementType | undefined;
  
  /** Which variant matched (if element has variants) */
  variant?: string | undefined;
  
  /** Custom metadata from custom matcher (e.g., { percentage: 47 }) */
  metadata?: Record<string, any> | undefined;

  /** Per-box OCR when the element was authored with parts. */
  parts?: ElementResult[] | undefined;

  /** Crop PNG to attach on the assertion step, not on waitFor. */
  traceImage?: Buffer | undefined;

  /** Attachment title for `traceImage`. */
  traceName?: string | undefined;
}

/**
 * Result from comparing a form/screen
 */
export interface ScreenComparison {
  /** All extracted elements */
  elements: ElementResult[];
  
  /** Total elements checked */
  totalElements: number;
  
  /** Number of elements with content/active state */
  filledElements: number;
  
  /** Number of elements in empty/default state */
  emptyElements: number;
}

/**
 * Rectangle coordinates
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Point coordinates
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Template matching result
 */
export interface MatchResult {
  location: Point;
  confidence: number;
  rect: Rect;
}

// Legacy type aliases for backward compatibility
/** @deprecated Use ElementConfig instead */
export type FieldConfig = ElementConfig;

/** @deprecated Use ElementResult instead */
export type FieldResult = ElementResult;

/** @deprecated Use ScreenComparison instead */
export type FormComparison = ScreenComparison;
