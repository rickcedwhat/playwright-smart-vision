#!/usr/bin/env node
/**
 * Turn first-pass.json (boxIds) into manager.json, config.ts, and template PNGs.
 *
 *   node tools/apply-first-pass.mjs tests/screens/autosoft-customer-information
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cropPng,
  expandLeftForLabel,
  insetRect,
  ocrRectFromBoxes,
  relativeToCrop,
  unionRects,
} from './detect-boxes.mjs';

const TYPE_ENUM = {
  field: 'FIELD',
  button: 'BUTTON',
  checkbox: 'CHECKBOX',
  radio: 'RADIO',
  dropdown: 'DROPDOWN',
  tab: 'TAB',
  label: 'LABEL',
  icon: 'ICON',
  message: 'MESSAGE',
  other: 'OTHER',
};

function kebab(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function exportName(folder) {
  const parts = folder.split('-').filter(Boolean);
  let camel = parts.map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('');
  return `${camel}Screen`;
}

function titleCase(folder) {
  return folder.split('-').filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

export function applyFirstPass(screenDir) {
  const blank = fs.readFileSync(path.join(screenDir, 'blank.png'));
  const boxesFile = JSON.parse(fs.readFileSync(path.join(screenDir, 'boxes.json'), 'utf8'));
  const boxes = boxesFile.boxes || [];
  const labels = boxesFile.labels || [];
  const pass = JSON.parse(fs.readFileSync(path.join(screenDir, 'first-pass.json'), 'utf8'));
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const byLabel = new Map(labels.map((label) => [label.id, label]));
  const tmplDir = path.join(screenDir, 'templates');
  fs.rmSync(tmplDir, { recursive: true, force: true });
  fs.mkdirSync(tmplDir, { recursive: true });

  const elements = [];
  for (const el of pass.elements || []) {
    const fieldBoxes = (el.boxIds || []).map((id) => byId.get(id)).filter(Boolean);
    const labelRects = (el.labelIds || []).map((id) => byLabel.get(id)).filter(Boolean);
    const joined = [...fieldBoxes, ...labelRects];
    let crop;
    if (labelRects.length && joined.length) {
      const union = unionRects(joined);
      crop = { x: Math.max(0, union.x - 4), y: Math.max(0, union.y - 4), width: union.width + 8, height: union.height + 8 };
    } else if (el.includeLabel === true && fieldBoxes.length) {
      crop = expandLeftForLabel(boxes, fieldBoxes);
    } else if (fieldBoxes.length) {
      crop = unionRects(fieldBoxes);
    } else {
      crop = el.crop;
    }
    if (!crop) continue;
    const filename = `${kebab(el.name)}.png`;
    fs.writeFileSync(path.join(tmplDir, filename), cropPng(blank, crop.x, crop.y, crop.width, crop.height));
    const parts = (el.parts || []).map((part) => {
      const box = byId.get(part.boxId);
      if (!box) return null;
      return { name: part.name, ...relativeToCrop(insetRect(box, 2), crop) };
    }).filter(Boolean);
    elements.push({
      name: el.name,
      filename,
      type: el.type || 'field',
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
      boxIds: el.boxIds,
      labelIds: el.labelIds,
      charset: el.charset,
      options: el.options,
      ocrRect: fieldBoxes.length ? ocrRectFromBoxes(crop, fieldBoxes, el.type || 'field') : undefined,
      parts: parts.length ? parts : undefined,
    });
  }

  const folder = pass.screen?.name || path.basename(screenDir);
  fs.writeFileSync(path.join(screenDir, 'manager.json'), `${JSON.stringify({
    name: folder,
    sections: [],
    elements,
  }, null, 2)}\n`);

  const lines = elements.map((el) => {
    const type = TYPE_ENUM[el.type] || 'FIELD';
    const block = [
      `      name: '${el.name}'`,
      `      template: '${el.filename}'`,
      `      type: ElementType.${type}`,
    ];
    if (el.charset) block.push(`      charset: '${el.charset}'`);
    if (el.options?.length) {
      const optionLines = el.options.map((opt) => `        '${String(opt).replace(/'/g, "\\'")}'`).join(',\n');
      block.push(`      options: [\n${optionLines},\n      ]`);
    }
    if (el.parts?.length) {
      const partLines = el.parts.map((part) =>
        `        { name: '${part.name}', x: ${part.x}, y: ${part.y}, width: ${part.width}, height: ${part.height} }`
      ).join(',\n');
      block.push(`      parts: [\n${partLines},\n      ]`);
    }
    return `    {\n${block.join(',\n')},\n    }`;
  }).join(',\n');

  fs.writeFileSync(path.join(screenDir, 'config.ts'), `import { defineScreen, ElementType } from '@rickcedwhat/playwright-smart-vision';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ${titleCase(folder)} screen configuration
 */
export const ${exportName(folder)} = defineScreen({
  name: '${folder}',
  baseDir: __dirname,
  elements: [
${lines}
  ],
});
`);

  return elements;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const screenDir = path.resolve(process.argv[2] || 'tests/screens/autosoft-customer-information');
  const elements = applyFirstPass(screenDir);
  console.log(`Applied ${elements.length} fields in ${screenDir}`);
  for (const el of elements) {
    console.log(`  ${el.name}  ${el.x},${el.y} ${el.width}x${el.height}  boxes=${(el.boxIds || []).join(',')}`);
  }
}
