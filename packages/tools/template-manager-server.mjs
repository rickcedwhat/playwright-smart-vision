#!/usr/bin/env node
/**
 * Local Template Manager server.
 * Exports screens by writing config.ts and PNG templates to configured destinations.
 *
 *   npm run template-manager
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { exec, spawn } from 'node:child_process';
import { publishHtmlFixtureArtifacts } from './publish-test-artifacts.mjs';
import { handleTmV2Request, initTmV2, tmV2StartupLines } from './tm-v2/handler.mjs';
import { PNG } from 'pngjs';
import { VisionUtil } from '@rickcedwhat/playwright-smart-vision/utils/vision';
import { OCRUtil, charsetForField, pickFromOptions } from '@rickcedwhat/playwright-smart-vision/utils/ocr';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TOOLS_DIR, '..');
const REPO_SCREENS_DIR = path.join(PROJECT_ROOT, 'core', 'tests', 'screens');
const HTML_FILE = path.join(TOOLS_DIR, 'template-manager.html');
const INDEX_FILE = path.join(TOOLS_DIR, 'index.html');
const APP_DIR = path.join(PROJECT_ROOT, 'core', 'tests', 'fixtures');
const SETTINGS_FILE = path.join(os.homedir(), '.playwright-ocr-screens.json');
const DEFAULT_EXTERNAL_DIR = path.join(os.homedir(), 'ocr-screens');
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const DEFAULT_PORT = Number(process.env.PORT) || 2020;
const LOCATE_MIN_CONFIDENCE = 0.7;

function expandHomeDir(raw) {
  const value = String(raw ?? '').trim();
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveDir(raw) {
  const expanded = expandHomeDir(raw);
  if (!expanded || !path.isAbsolute(expanded)) {
    throw new Error('Folder must be an absolute path (or start with ~).');
  }
  return path.resolve(expanded);
}

function defaultSettings() {
  return {
    configLocation: 'repo',
    configDir: REPO_SCREENS_DIR,
    imagesLocation: 'same',
    imagesDir: REPO_SCREENS_DIR,
  };
}

function normalizeSettings(raw = {}) {
  if (raw.storage === 'external' && !raw.configLocation) {
    const imagesDir = resolveDir(raw.screensDir || DEFAULT_EXTERNAL_DIR);
    return {
      configLocation: 'repo',
      configDir: REPO_SCREENS_DIR,
      imagesLocation: 'custom',
      imagesDir,
    };
  }

  const configLocation = raw.configLocation === 'custom' ? 'custom' : 'repo';
  const imagesLocation = raw.imagesLocation === 'custom' ? 'custom' : 'same';
  const configDir = configLocation === 'custom'
    ? resolveDir(raw.configDir || DEFAULT_EXTERNAL_DIR)
    : REPO_SCREENS_DIR;
  const imagesDir = imagesLocation === 'custom'
    ? resolveDir(raw.imagesDir || DEFAULT_EXTERNAL_DIR)
    : configDir;

  return { configLocation, configDir, imagesLocation, imagesDir };
}

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return defaultSettings();
    return normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
  } catch {
    return defaultSettings();
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
    configLocation: settings.configLocation,
    configDir: settings.configLocation === 'custom' ? settings.configDir : undefined,
    imagesLocation: settings.imagesLocation,
    imagesDir: settings.imagesLocation === 'custom' ? settings.imagesDir : undefined,
  }, null, 2) + '\n', 'utf8');
}

function destinations(settings) {
  const configRoot = settings.configLocation === 'custom' ? settings.configDir : REPO_SCREENS_DIR;
  const imagesRoot = settings.imagesLocation === 'custom' ? settings.imagesDir : configRoot;
  return {
    configRoot,
    imagesRoot,
    split: path.resolve(configRoot) !== path.resolve(imagesRoot),
  };
}

function sanitizeScreenFolder(raw) {
  const kebab = String(raw ?? '')
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (!kebab || kebab.includes('..')) return '';
  return kebab;
}

function sanitizePngFilename(raw) {
  const base = path.basename(String(raw ?? ''));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/.test(base)) return '';
  return base;
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl ?? ''));
  if (!match) throw new Error('Expected a base64 data URL');
  return Buffer.from(match[2], 'base64');
}

function assertInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to write outside the chosen folder.');
  }
}

function displayPath(absPath) {
  const rel = path.relative(PROJECT_ROOT, absPath);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  return absPath;
}

function relativeImport(fromDir, absFile) {
  let rel = path.relative(fromDir, absFile).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function screenExportName(folder) {
  const parts = folder.split('-').filter(Boolean);
  let camel = parts.map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('');
  if (!camel) camel = 'my';
  if (/^[0-9]/.test(camel)) camel = `screen${camel}`;
  return `${camel}Screen`;
}

function titleCase(folder) {
  return folder.split('-').filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function generateConfigTs({ folder, elements, configDir, split }) {
  const exportName = screenExportName(folder);
  const title = titleCase(folder);
  const screenConfigImport = relativeImport(configDir, path.join(PROJECT_ROOT, 'src', 'screen-config.js'));
  const typesImport = relativeImport(configDir, path.join(PROJECT_ROOT, 'src', 'types.js'));
  const imported = split ? '{ defineScreen, screenAssetsDir }' : '{ defineScreen }';
  const baseDirLine = split
    ? `  baseDir: screenAssetsDir('${folder}', __dirname),`
    : '  baseDir: __dirname,';
  const comment = split
    ? ' * PNG templates are loaded from the images folder configured in the Template Manager.\n *'
    : ' *';
  const elementBlocks = elements.map((el) => {
    const lines = [
      `      name: '${el.name}'`,
      `      template: '${el.filename}'`,
      `      type: ElementType.${el.type.toUpperCase()}`,
    ];
    if (el.section) lines.push(`      section: '${el.section}'`);
    if (el.options?.length) {
      lines.push(`      options: [${el.options.map((opt) => `'${String(opt).replace(/'/g, "\\'")}'`).join(', ')}]`);
    }
    if (el.parts?.length) {
      const partLines = el.parts.map((part) =>
        `        { name: '${part.name}', x: ${Number(part.x) || 0}, y: ${Number(part.y) || 0}, width: ${Number(part.width) || 0}, height: ${Number(part.height) || 0} }`
      ).join(',\n');
      lines.push(`      parts: [\n${partLines},\n      ]`);
    }
    return `    {\n${lines.join(',\n')},\n    }`;
  }).join(',\n');

  return `import ${imported} from '${screenConfigImport}';
import { ElementType } from '${typesImport}';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ${title} screen configuration
${comment}
 */
export const ${exportName} = defineScreen({
  name: '${folder}',
${baseDirLine}
  elements: [
${elementBlocks}
  ],
});
`;
}

function listScreens(screensDir) {
  if (!fs.existsSync(screensDir)) return [];
  return fs.readdirSync(screensDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const dir = path.join(screensDir, entry.name);
      const templatesDir = path.join(dir, 'templates');
      const templates = fs.existsSync(templatesDir)
        ? fs.readdirSync(templatesDir).filter((f) => f.endsWith('.png'))
        : [];
      return {
        name: entry.name,
        hasConfig: fs.existsSync(path.join(dir, 'config.ts')),
        hasBlank: fs.existsSync(path.join(dir, 'blank.png')),
        templateCount: templates.length,
      };
    });
}

function statusPayload() {
  const settings = loadSettings();
  const dest = destinations(settings);
  return {
    ok: true,
    configLocation: settings.configLocation,
    configDir: displayPath(dest.configRoot),
    configDirAbs: dest.configRoot,
    imagesLocation: settings.imagesLocation,
    imagesDir: displayPath(dest.imagesRoot),
    imagesDirAbs: dest.imagesRoot,
    split: dest.split,
    repoScreensDir: 'tests/screens',
    defaultExternalDir: process.env.OCR_SCREENS_DIR?.trim()
      ? resolveDir(process.env.OCR_SCREENS_DIR)
      : DEFAULT_EXTERNAL_DIR,
    settingsFile: SETTINGS_FILE,
    screens: listScreens(dest.configRoot),
  };
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fileToDataUrl(filePath) {
  const bytes = fs.readFileSync(filePath);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function parseConfigElements(source) {
  const elements = [];
  const re = /name:\s*'([^']+)'\s*,\s*template:\s*'([^']+)'\s*,\s*type:\s*ElementType\.(\w+)\s*,(?:\s*section:\s*'([^']+)'\s*,)?/g;
  let match;
  while ((match = re.exec(source))) {
    elements.push({
      name: match[1],
      filename: match[2],
      type: match[3].toLowerCase(),
      section: match[4] || undefined,
    });
  }
  return elements;
}

function filenameToName(filename) {
  return filename.replace(/\.png$/i, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function pngDataUrl(filePath) {
  return fs.existsSync(filePath) ? fileToDataUrl(filePath) : undefined;
}

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function pngRow(png, x, y, width) {
  const start = (y * png.width + x) * 4;
  return png.data.subarray(start, start + width * 4);
}

function patchEquals(blank, tmpl, x, y) {
  for (let row = 0; row < tmpl.height; row++) {
    if (!pngRow(blank, x, y + row, tmpl.width).equals(pngRow(tmpl, 0, row, tmpl.width))) {
      return false;
    }
  }
  return true;
}

function findExactPlacements(blank, tmpl) {
  const maxX = blank.width - tmpl.width;
  const maxY = blank.height - tmpl.height;
  if (maxX < 0 || maxY < 0) return [];
  const first = pngRow(tmpl, 0, 0, tmpl.width);
  const found = [];
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      if (pngRow(blank, x, y, tmpl.width).equals(first) && patchEquals(blank, tmpl, x, y)) {
        found.push({ x, y, width: tmpl.width, height: tmpl.height });
      }
    }
  }
  return found;
}

function rectContains(outer, inner) {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function locateOnBlank(payload) {
  if (!payload?.blankPng) throw new Error('No blank image was sent.');
  const vision = new VisionUtil();
  const blankColor = vision.loadImage(decodeDataUrl(payload.blankPng));
  const blank = vision.toGrayscale(blankColor);
  blankColor.delete();

  const matchOne = (dataUrl, search, offsetX, offsetY) => {
    if (!dataUrl) return { found: false, reason: 'missing template' };
    const tmplColor = vision.loadImage(decodeDataUrl(dataUrl));
    const tmpl = vision.toGrayscale(tmplColor);
    tmplColor.delete();
    if (tmpl.rows > search.rows || tmpl.cols > search.cols) {
      tmpl.delete();
      return { found: false, reason: 'template larger than search area' };
    }
    const match = vision.matchTemplate(search, tmpl);
    tmpl.delete();
    if (match.confidence < LOCATE_MIN_CONFIDENCE) {
      return { found: false, confidence: match.confidence };
    }
    return {
      found: true,
      confidence: match.confidence,
      x: match.rect.x + offsetX,
      y: match.rect.y + offsetY,
      width: match.rect.width,
      height: match.rect.height,
    };
  };

  const sections = [];
  for (const section of payload.sections || []) {
    sections.push({
      id: section.id,
      name: section.name,
      ...matchOne(section.dataUrl, blank, 0, 0),
    });
  }

  const sectionById = new Map(sections.filter((s) => s.found).map((s) => [s.id, s]));
  const elements = [];
  for (const element of payload.elements || []) {
    const section = sectionById.get(element.sectionId);
    let result = { found: false };
    if (section) {
      const roi = vision.extractROI(blank, {
        x: section.x,
        y: section.y,
        width: section.width,
        height: section.height,
      });
      result = matchOne(element.dataUrl, roi, section.x, section.y);
      roi.delete();
    }
    if (!result.found) {
      const full = matchOne(element.dataUrl, blank, 0, 0);
      if (full.found && section) full.fallback = 'full-screen';
      result = full;
    }
    elements.push({ id: element.id, name: element.name, ...result });
  }

  blank.delete();
  return { ok: true, minConfidence: LOCATE_MIN_CONFIDENCE, sections, elements };
}

function pickPlacement(candidates, sectionRect) {
  if (!candidates.length) return null;
  if (sectionRect && sectionRect.width > 0 && sectionRect.height > 0) {
    const inside = candidates.filter((c) => rectContains(sectionRect, c));
    if (inside.length) return inside[0];
  }
  return candidates[0];
}

function locateMissingBoxes(blankPath, templatesDir, sections, elements) {
  const missing = [...sections, ...elements].filter((item) => !(item.width > 0 && item.height > 0));
  if (!missing.length) return 0;

  const blank = readPng(blankPath);
  const cache = new Map();
  const placementsFor = (filename) => {
    if (cache.has(filename)) return cache.get(filename);
    const filePath = path.join(templatesDir, filename);
    if (!fs.existsSync(filePath)) {
      cache.set(filename, []);
      return [];
    }
    const found = findExactPlacements(blank, readPng(filePath));
    cache.set(filename, found);
    return found;
  };

  let recovered = 0;
  for (const section of sections) {
    if (section.width > 0 && section.height > 0) continue;
    const match = pickPlacement(placementsFor(section.filename));
    if (!match) continue;
    Object.assign(section, match);
    recovered += 1;
  }

  const sectionRectByFile = new Map(
    sections.filter((s) => s.filename && s.width > 0).map((s) => [s.filename, s]),
  );
  for (const element of elements) {
    if (element.width > 0 && element.height > 0) continue;
    const match = pickPlacement(placementsFor(element.filename), sectionRectByFile.get(element.section));
    if (!match) continue;
    Object.assign(element, match);
    recovered += 1;
  }
  return recovered;
}

function findScreenDirs(screenName) {
  const dest = destinations(loadSettings());
  const candidates = [dest.imagesRoot, dest.configRoot, REPO_SCREENS_DIR];
  const seen = new Set();
  for (const root of candidates) {
    const abs = path.resolve(root, screenName);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (fs.existsSync(abs)) {
      return { screenDir: abs, templatesDir: path.join(abs, 'templates') };
    }
  }
  return null;
}

function loadScreen(rawName) {
  const screenName = sanitizeScreenFolder(rawName);
  if (!screenName) {
    return { status: 400, body: { error: 'Invalid screen name.' } };
  }
  const found = findScreenDirs(screenName);
  if (!found) {
    return { status: 404, body: { error: `Screen "${screenName}" was not found.` } };
  }

  const { screenDir, templatesDir } = found;
  const blankPath = path.join(screenDir, 'blank.png');
  const configPath = path.join(screenDir, 'config.ts');
  const indexPath = path.join(screenDir, 'index.json');
  if (!fs.existsSync(blankPath)) {
    return { status: 404, body: { error: `Screen "${screenName}" has no blank.png.` } };
  }

  const blankPng = fileToDataUrl(blankPath);
  const filledPath = path.join(screenDir, 'filled.png');
  const filledPng = fs.existsSync(filledPath) ? fileToDataUrl(filledPath) : null;
  let sections = [];
  let elements = [];

  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    sections = (index.sections || []).map((section, i) => ({
      ...section,
      id: Date.now() + i,
      imageData: fs.existsSync(path.join(templatesDir, section.filename))
        ? fileToDataUrl(path.join(templatesDir, section.filename))
        : undefined,
    }));
    const sectionIdByFile = new Map(sections.map((s) => [s.filename, s.id]));
    elements = (index.elements || []).map((el, i) => ({
      ...el,
      id: Date.now() + 1000 + i,
      sectionId: el.section ? sectionIdByFile.get(el.section) ?? null : null,
      imageData: fs.existsSync(path.join(templatesDir, el.filename))
        ? fileToDataUrl(path.join(templatesDir, el.filename))
        : undefined,
    }));
  } else {
    const parsed = fs.existsSync(configPath)
      ? parseConfigElements(fs.readFileSync(configPath, 'utf8'))
      : [];
    const sectionFiles = [...new Set(parsed.map((el) => el.section).filter(Boolean))];
    const fieldFiles = new Set(parsed.map((el) => el.filename));
    const diskPngs = fs.existsSync(templatesDir)
      ? fs.readdirSync(templatesDir).filter((f) => f.endsWith('.png'))
      : [];
    const extraSections = diskPngs.filter((f) => !fieldFiles.has(f) && !sectionFiles.includes(f));
    sections = [...sectionFiles, ...extraSections].map((filename, i) => ({
      id: Date.now() + i,
      name: filenameToName(filename),
      filename,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      imageData: pngDataUrl(path.join(templatesDir, filename)),
    }));
    const sectionIdByFile = new Map(sections.map((s) => [s.filename, s.id]));
    elements = parsed.map((el, i) => ({
      id: Date.now() + 1000 + i,
      name: el.name,
      type: el.type,
      filename: el.filename,
      section: el.section,
      sectionId: el.section ? sectionIdByFile.get(el.section) ?? null : null,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      imageData: pngDataUrl(path.join(templatesDir, el.filename)),
    }));
  }

  const expectedPath = path.join(screenDir, 'expected.json');
  let expectedValues = {};
  if (fs.existsSync(expectedPath)) {
    try {
      expectedValues = JSON.parse(fs.readFileSync(expectedPath, 'utf8')).values || {};
    } catch {
      expectedValues = {};
    }
  }
  elements = elements.map((el) => ({
    ...el,
    expected: el.expected ?? expectedValues[el.name] ?? '',
    parts: (el.parts || []).map((part) => ({
      ...part,
      expected: part.expected ?? expectedValues[`${el.name}.${part.name}`] ?? '',
    })),
  }));

  const recovered = locateMissingBoxes(blankPath, templatesDir, sections, elements);
  if (recovered > 0) {
    const index = {
      name: screenName,
      sections: sections.map(({ name, filename, x, y, width, height }) => ({
        name, filename, x, y, width, height,
      })),
      elements: elements.map((el) => ({
        name: el.name,
        filename: el.filename,
        type: el.type,
        section: el.section,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        boxIds: el.boxIds,
        parts: el.parts,
        options: el.options,
        expected: el.expected,
        ocrRect: el.ocrRect,
        charset: el.charset,
      })),
    };
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
  }

  return {
    status: 200,
    body: {
      ok: true,
      name: screenName,
      blankPng,
      filledPng,
      sections: sections.filter((s) => s.imageData),
      elements: elements.filter((el) => el.imageData),
      hasManager: fs.existsSync(indexPath),
      recovered,
    },
  };
}

function writeExpected(payload) {
  const screenName = sanitizeScreenFolder(payload.screenName);
  if (!screenName) {
    return { status: 400, body: { error: 'Enter a valid screen name.' } };
  }
  const found = findScreenDirs(screenName);
  if (!found) {
    return { status: 404, body: { error: `Screen "${screenName}" was not found.` } };
  }
  const values = payload.values && typeof payload.values === 'object' ? payload.values : {};
  const expectedPath = path.join(found.screenDir, 'expected.json');
  fs.writeFileSync(expectedPath, `${JSON.stringify({ filled: 'filled.png', values }, null, 2)}\n`);
  const indexPath = path.join(found.screenDir, 'index.json');
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    index.elements = (index.elements || []).map((el) => ({
      ...el,
      expected: values[el.name] ?? el.expected ?? '',
    }));
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }
  return {
    status: 200,
    body: { ok: true, path: displayPath(expectedPath), count: Object.keys(values).length },
  };
}

function applySettings(payload) {
  const settings = normalizeSettings(payload);
  saveSettings(settings);
  return { status: 200, body: statusPayload() };
}

const ocrUtil = new OCRUtil();

async function runOcr(dataUrl, meta = {}) {
  if (!dataUrl) throw new Error('No image was sent to OCR.');
  if (meta.type === 'checkbox') {
    return { text: meta.checked ? 'checked' : 'unchecked' };
  }
  const vision = new VisionUtil();
  const color = vision.loadImage(decodeDataUrl(dataUrl));
  if (!vision.hasEnoughInk(color)) {
    color.delete();
    return { text: '', raw: '', scale: 0, threshold: '', charset: '' };
  }
  const charset = charsetForField(meta.name, meta.type, meta.charset);
  const scale = Number(meta.scale);
  const prep = vision.ocrPrepOptions(color, {
    charset,
    scale: Number.isInteger(scale) && scale >= 2 && scale <= 8 ? scale : undefined,
  });
  const prepared = vision.prepareForOcr(color, prep.scale, { ...prep, charset });
  const bytes = vision.matToBuffer(prepared);
  const preparedPng = `data:image/png;base64,${bytes.toString('base64')}`;
  color.delete();
  prepared.delete();
  const raw = await ocrUtil.extractText(bytes, { charset });
  return {
    text: pickFromOptions(raw, meta.options),
    raw,
    preparedPng,
    preparedBytes: bytes.length,
    scale: prep.scale,
    threshold: prep.threshold ?? 'otsu',
    charset: charset || '',
    charsetPreset: meta.charset || 'auto',
  };
}

function writeScreen(payload) {
  const settings = normalizeSettings(payload);
  saveSettings(settings);
  const dest = destinations(settings);

  const screenName = sanitizeScreenFolder(payload.screenName);
  if (!screenName) {
    return { status: 400, body: { error: 'Enter a valid screen name (letters, numbers, hyphens).' } };
  }

  const configDir = path.join(dest.configRoot, screenName);
  const imagesDir = path.join(dest.imagesRoot, screenName);
  const templatesDir = path.join(imagesDir, 'templates');
  assertInsideRoot(dest.configRoot, configDir);
  assertInsideRoot(dest.imagesRoot, imagesDir);

  const exists = fs.existsSync(path.join(configDir, 'config.ts'))
    || fs.existsSync(path.join(imagesDir, 'blank.png'));

  if (exists && !payload.overwrite) {
    return {
      status: 409,
      body: {
        error: `Screen "${screenName}" already exists.`,
        screenName,
        configPath: displayPath(path.join(configDir, 'config.ts')),
        imagesPath: displayPath(imagesDir),
      },
    };
  }

  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  if (templates.length === 0) {
    return { status: 400, body: { error: 'Save at least one template before exporting.' } };
  }
  if (templates.length > 100) {
    return { status: 400, body: { error: 'Too many templates (max 100).' } };
  }

  let blankPng;
  try {
    blankPng = decodeDataUrl(payload.blankPng);
  } catch {
    return { status: 400, body: { error: 'Load a blank form image before exporting.' } };
  }

  const decodedTemplates = [];
  for (const template of templates) {
    const filename = sanitizePngFilename(template.filename);
    if (!filename) {
      return { status: 400, body: { error: `Invalid template filename: ${template.filename}` } };
    }
    const type = String(template.type || 'other').toLowerCase();
    const section = sanitizePngFilename(template.section || '') || undefined;
    try {
      decodedTemplates.push({
        name: template.name || filename.replace(/\.png$/, ''),
        filename,
        type,
        section,
        x: Number(template.x) || 0,
        y: Number(template.y) || 0,
        width: Number(template.width) || 0,
        height: Number(template.height) || 0,
        expected: String(template.expected ?? ''),
        options: Array.isArray(template.options) ? template.options.map(String) : undefined,
        charset: template.charset ? String(template.charset) : undefined,
        ocrScale: template.ocrScale && template.ocrScale !== 'auto' ? String(template.ocrScale) : undefined,
        ocrRect: Number.isFinite(template.ocrRect?.width) ? {
          x: Number(template.ocrRect.x) || 0,
          y: Number(template.ocrRect.y) || 0,
          width: Number(template.ocrRect.width) || 0,
          height: Number(template.ocrRect.height) || 0,
        } : undefined,
        bytes: decodeDataUrl(template.dataUrl),
      });
    } catch {
      return { status: 400, body: { error: `Could not decode template image: ${filename}` } };
    }
  }

  const decodedSections = [];
  const incomingSections = Array.isArray(payload.sections) ? payload.sections : [];
  if (incomingSections.length > 50) {
    return { status: 400, body: { error: 'Too many sections (max 50).' } };
  }
  for (const section of incomingSections) {
    const filename = sanitizePngFilename(section.filename);
    if (!filename) {
      return { status: 400, body: { error: `Invalid section filename: ${section.filename}` } };
    }
    try {
      decodedSections.push({
        name: section.name || filename.replace(/\.png$/i, ''),
        filename,
        x: Number(section.x) || 0,
        y: Number(section.y) || 0,
        width: Number(section.width) || 0,
        height: Number(section.height) || 0,
        bytes: decodeDataUrl(section.dataUrl),
      });
    } catch {
      return { status: 400, body: { error: `Could not decode section image: ${filename}` } };
    }
  }

  const configTs = generateConfigTs({
    folder: screenName,
    elements: decodedTemplates,
    configDir,
    split: dest.split,
  });

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.ts'), configTs, 'utf8');
  fs.writeFileSync(path.join(imagesDir, 'blank.png'), blankPng);

  const written = [
    displayPath(path.join(configDir, 'config.ts')),
    displayPath(path.join(imagesDir, 'blank.png')),
  ];

  if (payload.filledPng) {
    try {
      const filledBytes = decodeDataUrl(payload.filledPng);
      fs.writeFileSync(path.join(imagesDir, 'filled.png'), filledBytes);
      written.push(displayPath(path.join(imagesDir, 'filled.png')));
    } catch {
      // optional
    }
  }

  for (const template of decodedTemplates) {
    const destFile = path.join(templatesDir, template.filename);
    fs.writeFileSync(destFile, template.bytes);
    written.push(displayPath(destFile));
  }

  for (const section of decodedSections) {
    const destFile = path.join(templatesDir, section.filename);
    fs.writeFileSync(destFile, section.bytes);
    written.push(displayPath(destFile));
  }

  const index = {
    name: screenName,
    sections: decodedSections.map(({ name, filename, x, y, width, height }) => ({
      name, filename, x, y, width, height,
    })),
    elements: decodedTemplates.map(({ name, filename, type, section, x, y, width, height, expected, options, ocrRect, charset, ocrScale, parts }) => ({
      name, filename, type, section, x, y, width, height, expected, options, ocrRect, charset, ocrScale, parts,
    })),
  };
  fs.writeFileSync(path.join(imagesDir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  written.push(displayPath(path.join(imagesDir, 'index.json')));
  const expectedValues = Object.fromEntries(
    decodedTemplates.map((t) => [t.name, t.expected ?? '']),
  );
  if (Object.values(expectedValues).some((value) => value !== '')) {
    const expectedPath = path.join(imagesDir, 'expected.json');
    fs.writeFileSync(expectedPath, `${JSON.stringify({ filled: 'filled.png', values: expectedValues }, null, 2)}\n`);
    written.push(displayPath(expectedPath));
  }

  return {
    status: exists ? 200 : 201,
    body: {
      ok: true,
      screenName,
      exportName: screenExportName(screenName),
      split: dest.split,
      configPath: displayPath(path.join(configDir, 'config.ts')),
      imagesPath: displayPath(imagesDir),
      configTs,
      files: written,
    },
  };
}

function serveHtml(res, filePath, missing) {
  if (!fs.existsSync(filePath)) {
    sendText(res, 500, missing);
    return;
  }
  sendText(res, 200, fs.readFileSync(filePath), 'text/html; charset=utf-8');
}

const APP_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'artifacts');
// playwright-core is not a direct dep of core — resolve via @playwright/test.
// Must use realpathSync so createRequire sees the pnpm store's own node_modules.
const _atTestReal = fs.realpathSync(
  path.join(PROJECT_ROOT, 'core', 'node_modules', '@playwright', 'test', 'index.js')
);
const _playwrightCorePkg = createRequire(_atTestReal).resolve('playwright-core/package.json');
const TRACE_VIEWER_DIR = path.join(path.dirname(_playwrightCorePkg), 'lib', 'vite', 'traceViewer');

function labelFromScreenName(name) {
  return name
    .replace(/^html-/, '')
    .replace(/-(.)/g, (_, c) => ' ' + c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toUpperCase());
}

/** Parse element names from a screen config.ts — top-level entries in elements:[...] only. */
function parseConfigElementNames(configPath) {
  if (!fs.existsSync(configPath)) return [];
  const text = fs.readFileSync(configPath, 'utf8');
  const startIdx = text.indexOf('elements: [');
  if (startIdx === -1) return [];

  const names = [];
  let i = startIdx + 'elements: ['.length;
  let depth = 1;

  while (i < text.length && depth > 0) {
    const ch = text[i];
    // Skip string literals so brackets inside strings don't count
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '{') {
      if (depth === 1) {
        // Opening brace of a top-level element — grab its name
        const slice = text.slice(i + 1);
        const m = slice.match(/name:\s*['"]([^'"]+)['"]/);
        if (m) names.push(m[1]);
      }
      depth++;
    } else if (ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
    }
    i++;
  }

  return names;
}

function getSourceFiles() {
  const files = {
    test: path.join(PROJECT_ROOT, 'core', 'tests', 'customer.spec.ts'),
  };
  if (fs.existsSync(REPO_SCREENS_DIR)) {
    for (const entry of fs.readdirSync(REPO_SCREENS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(REPO_SCREENS_DIR, entry.name, 'config.ts');
      if (fs.existsSync(configPath)) files[entry.name] = configPath;
    }
  }
  return files;
}

function htmlScreenCatalog() {
  if (!fs.existsSync(REPO_SCREENS_DIR)) return [];
  return fs.readdirSync(REPO_SCREENS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .map((screenName) => {
      const screenDir = path.join(REPO_SCREENS_DIR, screenName);
      const blankPath = path.join(screenDir, 'blank.png');
      if (!fs.existsSync(blankPath)) return null;

      const indexPath = path.join(screenDir, 'index.json');
      const configPath = path.join(screenDir, 'config.ts');
      const filledPath = path.join(screenDir, 'filled.png');

      const index = fs.existsSync(indexPath)
        ? JSON.parse(fs.readFileSync(indexPath, 'utf8'))
        : { elements: [] };

      const configNames = parseConfigElementNames(configPath);
      const indexByName = Object.fromEntries(
        (index.elements || []).map((el) => [el.name, el]),
      );

      // Config.ts is authoritative for which elements exist; index.json provides positions.
      const elementNames = configNames.length > 0 ? configNames : (index.elements || []).map((el) => el.name);
      const elements = elementNames.map((name) => {
        const m = indexByName[name] || {};
        return {
          name,
          type: m.type,
          x: m.x,
          y: m.y,
          width: m.width,
          height: m.height,
          parts: (m.parts || []).map((p) => ({ name: p.name, x: p.x, y: p.y, width: p.width, height: p.height })),
        };
      });

      // href: use stored value from index.json if present, otherwise derive from first name segment
      const firstSegment = screenName.replace(/^html-/, '').replace(/-.*$/, '');
      const href = index.href || `/app/${firstSegment}.html`;
      const sections = (index.sections && index.sections.length) ? index.sections : null;

      return {
        name: screenName,
        label: labelFromScreenName(screenName),
        href,
        blank: `/screens/${screenName}/blank.png`,
        filled: fs.existsSync(filledPath) ? `/screens/${screenName}/filled.png` : null,
        sections,
        elements,
      };
    })
    .filter(Boolean);
}

function loadSource(rawKey) {
  const filePath = getSourceFiles()[String(rawKey ?? '')];
  if (!filePath) {
    return { status: 404, body: { error: 'Unknown source file.' } };
  }
  if (!fs.existsSync(filePath)) {
    return { status: 404, body: { error: `${displayPath(filePath)} was not found.` } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      path: displayPath(filePath),
      source: fs.readFileSync(filePath, 'utf8'),
    },
  };
}

function serveStatic(res, root, pathname, prefix) {
  const relative = decodeURIComponent(pathname.replace(prefix, ''));
  const target = path.normalize(path.join(root, relative || 'index.html'));
  try {
    assertInsideRoot(root, target);
  } catch {
    sendText(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }
  const type = APP_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
  const body = fs.readFileSync(target);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function artifactPayload() {
  const video = path.join(ARTIFACTS_DIR, 'html-fixture', 'video.webm');
  const trace = path.join(ARTIFACTS_DIR, 'html-fixture', 'trace.zip');
  const hasVideo = fs.existsSync(video);
  const hasTrace = fs.existsSync(trace);
  const stamp = hasVideo || hasTrace
    ? new Date(Math.max(
      hasVideo ? fs.statSync(video).mtimeMs : 0,
      hasTrace ? fs.statSync(trace).mtimeMs : 0,
    )).toISOString()
    : null;
  return {
    ok: true,
    title: 'HTML Customer Information spec',
    updatedAt: stamp,
    video: hasVideo ? '/artifacts/html-fixture/video.webm' : null,
    trace: hasTrace ? '/artifacts/html-fixture/trace.zip' : null,
  };
}

const htmlTestRun = {
  status: 'idle',
  headed: false,
  log: '',
  startedAt: null,
  finishedAt: null,
  error: null,
  child: null,
};

function runPayload() {
  return {
    ok: true,
    status: htmlTestRun.status,
    headed: htmlTestRun.headed,
    log: htmlTestRun.log.slice(-12_000),
    startedAt: htmlTestRun.startedAt,
    finishedAt: htmlTestRun.finishedAt,
    error: htmlTestRun.error,
    artifacts: artifactPayload(),
  };
}

function appendRunLog(chunk) {
  htmlTestRun.log += chunk.toString();
  if (htmlTestRun.log.length > 40_000) {
    htmlTestRun.log = htmlTestRun.log.slice(-30_000);
  }
}

function startHtmlTest({ headed = false } = {}) {
  if (htmlTestRun.status === 'running') {
    return { status: 409, body: { error: 'A test is already running.', ...runPayload() } };
  }

  htmlTestRun.status = 'running';
  htmlTestRun.headed = Boolean(headed);
  htmlTestRun.log = '';
  htmlTestRun.startedAt = new Date().toISOString();
  htmlTestRun.finishedAt = null;
  htmlTestRun.error = null;

  const CORE_ROOT = path.join(PROJECT_ROOT, 'core');
  const playwrightBin = path.join(CORE_ROOT, 'node_modules', '.bin', 'playwright');
  const args = ['test', 'tests/customer.spec.ts'];
  if (htmlTestRun.headed) args.push('--headed');

  const env = { ...process.env, OCR_OPEN: '0' };
  delete env.PLAYWRIGHT_BROWSERS_PATH;

  const child = spawn(playwrightBin, args, {
    cwd: CORE_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  htmlTestRun.child = child;

  child.stdout.on('data', appendRunLog);
  child.stderr.on('data', appendRunLog);
  child.on('error', (err) => {
    htmlTestRun.child = null;
    htmlTestRun.status = 'failed';
    htmlTestRun.error = err.message;
    htmlTestRun.finishedAt = new Date().toISOString();
    appendRunLog(`\n${err.message}\n`);
  });
  child.on('close', (code) => {
    htmlTestRun.child = null;
    try {
      const published = publishHtmlFixtureArtifacts({
        sinceMs: Date.parse(htmlTestRun.startedAt) - 1_000,
      });
      if (!published.video && !published.trace) {
        appendRunLog('\nNo new video/trace to publish.\n');
      } else {
        appendRunLog('\nPublished artifacts/html-fixture.\n');
      }
    } catch (err) {
      appendRunLog(`\nCould not publish artifacts: ${err.message}\n`);
    }
    htmlTestRun.status = code === 0 ? 'passed' : 'failed';
    htmlTestRun.finishedAt = new Date().toISOString();
    if (code !== 0) htmlTestRun.error = `playwright exited ${code}`;
  });

  return { status: 202, body: runPayload() };
}

function serveApp(res, pathname) {
  const relative = pathname.replace(/^\/app\/?/, '');
  const target = path.normalize(path.join(APP_DIR, relative || 'login.html'));
  if (!target.startsWith(APP_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }
  const type = APP_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
  sendText(res, 200, fs.readFileSync(target), type);
}

function serveScreenAsset(res, pathname) {
  const relative = decodeURIComponent(pathname.replace(/^\/screens\/?/, ''));
  const target = path.normalize(path.join(REPO_SCREENS_DIR, relative));
  try {
    assertInsideRoot(REPO_SCREENS_DIR, target);
  } catch {
    sendText(res, 403, 'Forbidden');
    return;
  }
  if (path.extname(target).toLowerCase() !== '.png') {
    sendText(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }
  sendText(res, 200, fs.readFileSync(target), 'image/png');
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    serveHtml(res, INDEX_FILE, 'index.html is missing.');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/template-manager.html') {
    serveHtml(res, HTML_FILE, 'template-manager.html is missing.');
    return;
  }

  if (await handleTmV2Request(req, res, url)) return;

  if (req.method === 'GET' && (url.pathname === '/app' || url.pathname.startsWith('/app/'))) {
    serveApp(res, url.pathname);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/screens/')) {
    serveScreenAsset(res, url.pathname);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/artifacts/')) {
    serveStatic(res, ARTIFACTS_DIR, url.pathname, /^\/artifacts\/?/);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/trace-viewer/')) {
    serveStatic(res, TRACE_VIEWER_DIR, url.pathname, /^\/trace-viewer\/?/);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/artifacts') {
    sendJson(res, 200, artifactPayload());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/run') {
    sendJson(res, 200, runPayload());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    let payload = {};
    try {
      const raw = (await readBody(req)).toString('utf8').trim();
      if (raw) payload = JSON.parse(raw);
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON body.' });
      return;
    }
    const result = startHtmlTest({ headed: Boolean(payload.headed) });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/source') {
    const result = loadSource(url.searchParams.get('file'));
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/sources') {
    const sourceFiles = getSourceFiles();
    const coreRoot = path.join(PROJECT_ROOT, 'core');
    const screenEntries = Object.entries(sourceFiles)
      .filter(([k]) => k !== 'test')
      .sort(([a], [b]) => a.localeCompare(b));
    const testEntry = Object.entries(sourceFiles).find(([k]) => k === 'test');
    const ordered = testEntry ? [...screenEntries, testEntry] : screenEntries;
    const files = ordered.map(([key, filePath]) => ({
      file: key,
      tab: key !== 'test' ? `${key}/config.ts` : path.basename(filePath),
      path: path.relative(coreRoot, filePath).replace(/\\/g, '/'),
      screen: key !== 'test' ? key : null,
    }));
    sendJson(res, 200, { files });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/html-screens') {
    sendJson(res, 200, { screens: htmlScreenCatalog() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    sendJson(res, 200, statusPayload());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/screens') {
    sendJson(res, 200, { screens: listScreens(destinations(loadSettings()).configRoot) });
    return;
  }

  const screenMatch = url.pathname.match(/^\/api\/screens\/([^/]+)$/);
  if (req.method === 'GET' && screenMatch) {
    const result = loadScreen(decodeURIComponent(screenMatch[1]));
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings') {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8'));
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON body.' });
      return;
    }
    try {
      const result = applySettings(payload);
      sendJson(res, result.status, result.body);
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Could not save settings.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/locate') {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8'));
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON body.' });
      return;
    }
    try {
      sendJson(res, 200, locateOnBlank(payload));
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Could not relocate templates.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/expected') {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8'));
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON body.' });
      return;
    }
    try {
      const result = writeExpected(payload);
      sendJson(res, result.status, result.body);
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Could not save expected values.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ocr') {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8'));
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON body.' });
      return;
    }
    try {
      const result = await runOcr(payload.dataUrl, {
        name: payload.name,
        type: payload.type,
        checked: payload.checked,
        options: payload.options,
        charset: payload.charset,
        scale: payload.scale,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'OCR failed.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/screens') {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8'));
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON body.' });
      return;
    }
    try {
      const result = writeScreen(payload);
      sendJson(res, result.status, result.body);
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Could not save screen.' });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function openBrowser(url) {
  if (process.env.OCR_OPEN === '0' || process.env.CI) return;
  const command = process.platform === 'darwin'
    ? `open "${url}"`
    : process.platform === 'win32'
      ? `start "" "${url}"`
      : `xdg-open "${url}"`;
  exec(command, () => {});
}

function listen(port) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      sendJson(res, 500, { error: 'Internal server error' });
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Kill the existing process and retry.`);
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  });

  server.listen(port, () => {
    const dest = destinations(loadSettings());
    const url = `http://localhost:${port}/`;
    console.log(`Hub:              ${url}`);
    console.log(`Template Manager: ${url}template-manager.html`);
    for (const line of tmV2StartupLines(port)) console.log(line);
    console.log(`App login:        ${url}app/login.html`);
    console.log(`App customer:     ${url}app/customer.html`);
    console.log(`App source:       ${url}app/config.html`);
    console.log(`config.ts → ${dest.configRoot}`);
    console.log(`images    → ${dest.imagesRoot}`);
    openBrowser(url);
  });
}

initTmV2();
listen(DEFAULT_PORT);
