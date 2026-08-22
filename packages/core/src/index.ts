export { saveScreen } from './configure.js';
export {
  bindOcrScreen,
  createFixture,
  createOcrExtractor,
  ensureOcrRuntime,
  init,
  release,
  releaseOcrScreen,
  screen,
} from './screen.js';
export type { BindOcrScreenOptions, ScreenFixture } from './screen.js';
export { UNHOVER_POINT, unhoverBeforeCapture } from './unhover.js';

export { defineScreen, screenAssetsDir } from './screen-config.js';
export type { ScreenConfig } from './screen-config.js';

export { defineTypedScreen, TypedScreenResult } from './typed-screen.js';
export type { TypedScreenConfig } from './typed-screen.js';

export { ScreenResult } from './screen-result.js';
export { ScreenElement, NegatedScreenElement } from './element.js';
export type { HaveTextOptions, MatchOptions, WaitForOptions } from './element.js';
export { TextElement, findAllMatches } from './text-element.js';
export type { TextQuery, TextElementOptions, TextMatch, WordBox } from './text-element.js';

export { ElementType } from './field-extractor.js';
export type { ElementConfig, ElementResult, ScreenComparison } from './field-extractor.js';

export type {
  ElementVariant,
  CustomMatcherContext,
  CustomMatcherResult,
  CustomMatcherFunction,
} from './types.js';

export { ocrTextMatches } from './utils/ocr.js';
export type { Charset, FieldRead, OcrOverflow, OcrSwaps } from './utils/ocr.js';
export { Strategies } from './screen.js';
export type { OcrStrategy, ClickStrategy, FillStrategy, CaptureStrategy } from './screen.js';
export { presets, mergeInitOptions } from './presets.js';
export { createScreen } from './screen-api.js';
export type { TypedResult } from './screen-api.js';
