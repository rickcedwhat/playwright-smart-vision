export { detectScreen, detectBoxes, annotateBoxes } from './detect.js';
export type { DetectScreenResult, BoxesFile } from './detect.js';

export { applyScreen } from './apply.js';
export type { FirstPass, FirstPassElement, FirstPassPart, ApplyScreenResult, AppliedElement } from './apply.js';

export { writeScreenCatalog, readScreenCatalog } from './catalog.js';
export type { ScreenCatalog } from './catalog.js';

export { showAnnotated } from './show.js';

export { kebab, unionRects, insetRect } from './geometry.js';
export type { DetectedBox } from './geometry.js';
