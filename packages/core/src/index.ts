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
export { ScreenElement } from './element.js';
export type { HaveTextOptions, MatchOptions, WaitForOptions } from './element.js';

export { ElementType } from './field-extractor.js';
export type { ElementConfig, ElementResult, ScreenComparison } from './field-extractor.js';

export type {
  ElementVariant,
  CustomMatcherContext,
  CustomMatcherResult,
  CustomMatcherFunction,
} from './types.js';

export { ocrTextMatches } from './utils/ocr.js';
export type { FieldRead, OcrOverflow, OcrSwaps } from './utils/ocr.js';
