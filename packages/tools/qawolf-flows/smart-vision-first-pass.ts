/**
 * Copy to the QA Wolf repo as src/helpers/smart-vision-first-pass.ts
 * The AI overwrites this after inspecting the annotated tab, then runs apply.
 */
export const screenName = 'customer-info';

export const firstPass = {
  screen: { name: 'customer-info', width: 1280, height: 720 },
  notes: [],
  unknowns: [],
  sections: [],
  elements: [
    { name: 'lastName', type: 'field', section: null, boxIds: [12] },
  ],
};
