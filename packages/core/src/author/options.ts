import fs from 'node:fs';
import path from 'node:path';
import type { AppliedElement, FirstPass, FirstPassElement, FirstPassPart } from './apply.js';
import { writeScreenCatalog } from './catalog.js';
import { screenDir } from './storage.js';

export interface ElementOptionsPatch {
  charset?: string | null;
  swaps?: Record<string, string | string[]> | null;
  overflow?: string | null;
  read?: string | null;
}

function normalizeSwaps(
  swaps: Record<string, string | string[]> | null | undefined,
): Record<string, string[]> | undefined {
  if (swaps == null) return undefined;
  const out: Record<string, string[]> = {};
  for (const [from, to] of Object.entries(swaps)) {
    const key = String(from);
    if (!key) continue;
    const list = (typeof to === 'string' ? [to] : [...to])
      .map((item) => String(item))
      .filter(Boolean);
    if (list.length) out[key] = list;
  }
  return Object.keys(out).length ? out : undefined;
}

function applyPatchToRecord(
  target: Record<string, unknown>,
  patch: ElementOptionsPatch,
): void {
  if ('charset' in patch) {
    if (patch.charset == null || patch.charset === '' || patch.charset === 'auto') {
      delete target.charset;
    } else {
      target.charset = patch.charset;
    }
  }
  if ('read' in patch) {
    if (patch.read == null || patch.read === '' || patch.read === 'ocr') {
      delete target.read;
    } else {
      target.read = patch.read;
    }
  }
  if ('overflow' in patch) {
    if (patch.overflow == null || patch.overflow === '') {
      delete target.overflow;
    } else {
      target.overflow = patch.overflow;
    }
  }
  if ('swaps' in patch) {
    const swaps = normalizeSwaps(patch.swaps);
    if (!swaps) delete target.swaps;
    else target.swaps = swaps;
  }
}

/**
 * Update charset / swaps / read / overflow on one element without re-cropping templates.
 * Writes both first-pass.json (survives AI re-apply merge) and index.json (runtime).
 */
export function patchElementOptions(
  screenName: string,
  elementName: string,
  patch: ElementOptionsPatch,
): { firstPass: FirstPassElement; index: AppliedElement } {
  const dir = screenDir(screenName);
  const firstPassPath = path.join(dir, 'first-pass.json');
  const indexPath = path.join(dir, 'index.json');
  if (!fs.existsSync(firstPassPath)) {
    throw new Error(`patchElementOptions('${screenName}'): no first-pass.json`);
  }
  if (!fs.existsSync(indexPath)) {
    throw new Error(`patchElementOptions('${screenName}'): no index.json — apply the screen first`);
  }

  const firstPass = JSON.parse(fs.readFileSync(firstPassPath, 'utf8')) as FirstPass;
  const fpEl = (firstPass.elements || []).find((el) => el.name === elementName);
  if (!fpEl) {
    throw new Error(`patchElementOptions('${screenName}'): element "${elementName}" not in first-pass.json`);
  }
  applyPatchToRecord(fpEl as unknown as Record<string, unknown>, patch);
  fs.writeFileSync(firstPassPath, `${JSON.stringify(firstPass, null, 2)}\n`);

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
    name?: string;
    sections?: unknown[];
    elements: AppliedElement[];
  };
  const idxEl = (index.elements || []).find((el) => el.name === elementName);
  if (!idxEl) {
    throw new Error(`patchElementOptions('${screenName}'): element "${elementName}" not in index.json`);
  }
  applyPatchToRecord(idxEl as unknown as Record<string, unknown>, patch);
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  writeScreenCatalog();

  return { firstPass: fpEl, index: idxEl };
}

/**
 * Patch options on one named part of an element.
 */
export function patchPartOptions(
  screenName: string,
  elementName: string,
  partName: string,
  patch: ElementOptionsPatch,
): { firstPass: FirstPassPart; index: NonNullable<AppliedElement['parts']>[number] } {
  const dir = screenDir(screenName);
  const firstPassPath = path.join(dir, 'first-pass.json');
  const indexPath = path.join(dir, 'index.json');
  if (!fs.existsSync(firstPassPath) || !fs.existsSync(indexPath)) {
    throw new Error(`patchPartOptions('${screenName}'): need first-pass.json and index.json`);
  }

  const firstPass = JSON.parse(fs.readFileSync(firstPassPath, 'utf8')) as FirstPass;
  const fpEl = (firstPass.elements || []).find((el) => el.name === elementName);
  if (!fpEl) throw new Error(`element "${elementName}" not in first-pass.json`);
  if (!fpEl.parts) fpEl.parts = [];
  let fpPart = fpEl.parts.find((part) => part.name === partName);
  if (!fpPart) {
    fpPart = { name: partName };
    fpEl.parts.push(fpPart);
  }
  applyPatchToRecord(fpPart as unknown as Record<string, unknown>, patch);
  fs.writeFileSync(firstPassPath, `${JSON.stringify(firstPass, null, 2)}\n`);

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
    elements: AppliedElement[];
  };
  const idxEl = (index.elements || []).find((el) => el.name === elementName);
  if (!idxEl) throw new Error(`element "${elementName}" not in index.json`);
  if (!idxEl.parts) idxEl.parts = [];
  let idxPart = idxEl.parts.find((part) => part.name === partName);
  if (!idxPart) {
    throw new Error(`part "${partName}" not in index.json for "${elementName}" — re-apply first`);
  }
  applyPatchToRecord(idxPart as unknown as Record<string, unknown>, patch);
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  writeScreenCatalog();

  return { firstPass: fpPart, index: idxPart };
}
