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
import { exec } from 'node:child_process';
import { handleTmV2Request, initTmV2, tmV2StartupLines } from './tm-v2/handler.mjs';
import { PNG } from 'pngjs';
import { VisionUtil } from '@rickcedwhat/playwright-smart-vision/utils/vision';
import { OCRUtil, charsetForField, pickFromOptions } from '@rickcedwhat/playwright-smart-vision/utils/ocr';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TOOLS_DIR, '..');
const REPO_SCREENS_DIR = path.join(PROJECT_ROOT, 'core', 'tests', 'screens');
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
    res.writeHead(302, { Location: '/template-manager' });
    res.end();
    return;
  }

  if (await handleTmV2Request(req, res, url)) return;

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
    const url = `http://localhost:${port}/template-manager`;
    console.log(`Hub:              ${url}`);
    for (const line of tmV2StartupLines(port)) console.log(line);
    console.log(`config.ts → ${dest.configRoot}`);
    console.log(`images    → ${dest.imagesRoot}`);
    openBrowser(url);
  });
}

initTmV2();
listen(DEFAULT_PORT);
