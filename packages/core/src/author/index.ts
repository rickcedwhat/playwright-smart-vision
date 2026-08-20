export { detectScreen, detectBoxes, annotateBoxes, writeBoxes } from './detect.js';
export type { DetectScreenResult, BoxesFile } from './detect.js';

export { applyScreen } from './apply.js';
export type { FirstPass, FirstPassElement, FirstPassPart, FirstPassSection, ApplyScreenResult, AppliedElement, AppliedSection } from './apply.js';

export { writeScreenCatalog, readScreenCatalog, screenCatalogSource, screenCatalogPath } from './catalog.js';
export type { ScreenCatalog } from './catalog.js';

export { showAnnotated } from './show.js';

export { kebab, unionRects, insetRect } from './geometry.js';
export type { DetectedBox } from './geometry.js';

export type { DetectedLabel } from './labels.js';
