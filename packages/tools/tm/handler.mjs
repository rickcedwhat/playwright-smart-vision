/**
 * Template Manager — Local screen authoring and management.
 * Mounted under /template-manager on the main tools server (port 2020).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { configure } from '@rickcedwhat/playwright-smart-vision/configure';
import { applyScreen, detectScreen, writeBoxes, writeScreenCatalog, patchElementOptions, patchPartOptions } from '@rickcedwhat/playwright-smart-vision/author';
import { VisionUtil, ensureCvReady, getCv } from '@rickcedwhat/playwright-smart-vision/utils/vision';

export const TM_V2_BASE = '/template-manager';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const HTML_FILE = path.join(TOOLS_DIR, 'index.html');
const HOME = path.join(os.homedir(), '.smart-vision');
const SETTINGS_FILE = path.join(HOME, 'tm.json');
const CHARSETS_FILE = path.join(HOME, 'charsets.json');
const DEFAULTS_FILE = path.join(HOME, 'defaults.json');

function expandHomeDir(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

/** Screens root: SMART_VISION_SCREENS, else ~/.smart-vision/screens. */
function resolveScreensRoot() {
  const fromEnv = expandHomeDir(process.env.SMART_VISION_SCREENS);
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(HOME, 'screens');
}

const CACHE_DIR = resolveScreensRoot();
const RECORDINGS_DIR = path.join(path.dirname(CACHE_DIR), 'recordings');
const WORKSPACE_ROOTS = {
  screens: CACHE_DIR,
  recordings: RECORDINGS_DIR,
};

function readDefaults() {
  try {
    const raw = JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeSettings(next) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`);
}

function assertScreenName(name) {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error(`invalid screen name: ${JSON.stringify(name)}`);
  }
  return name;
}

function screenDir(name) {
  return path.join(CACHE_DIR, assertScreenName(name));
}

function splitWorkspaceRel(rel) {
  const clean = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!clean) return { root: '', parts: [] };
  const parts = clean.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('invalid path');
  }
  if (!parts.every((part) => /^[a-zA-Z0-9._-]+$/.test(part))) {
    throw new Error('invalid path');
  }
  return { root: parts[0], parts: parts.slice(1) };
}

function resolveWorkspaceDir(rel) {
  const { root, parts } = splitWorkspaceRel(rel);
  if (!root) return null;
  const base = WORKSPACE_ROOTS[root];
  if (!base) throw new Error('invalid path');
  return parts.length ? path.join(base, ...parts) : base;
}

function resolveWorkspaceFile(rel) {
  const { root, parts } = splitWorkspaceRel(rel);
  if (!root || !parts.length) throw new Error('invalid path');
  const base = WORKSPACE_ROOTS[root];
  if (!base) throw new Error('invalid path');
  return path.join(base, ...parts);
}

function safeCachePath(rel) {
  return resolveWorkspaceFile(rel);
}

function cropPng(pngBuffer, x, y, width, height) {
  const png = PNG.sync.read(pngBuffer);
  const sx = Math.max(0, Math.round(x));
  const sy = Math.max(0, Math.round(y));
  const sw = Math.max(1, Math.min(png.width - sx, Math.round(width)));
  const sh = Math.max(1, Math.min(png.height - sy, Math.round(height)));
  const out = new PNG({ width: sw, height: sh });
  for (let row = 0; row < sh; row++) {
    const src = ((sy + row) * png.width + sx) * 4;
    out.data.set(png.data.subarray(src, src + sw * 4), row * sw * 4);
  }
  return PNG.sync.write(out);
}

function kebab(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function listDirEntries(dir) {
  if (!dir || !fs.existsSync(dir)) return { dirs: [], files: [] };
  const dirs = [];
  const files = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    if (ent.isDirectory()) dirs.push(ent.name);
    else files.push(ent.name);
  }
  return { dirs: dirs.sort(), files: files.sort() };
}

function listLocalPrefix(relPath) {
  const { root } = splitWorkspaceRel(relPath);
  if (!root) return { dirs: Object.keys(WORKSPACE_ROOTS), files: [] };
  return listDirEntries(resolveWorkspaceDir(relPath));
}

function listLocalScreens() {
  if (!fs.existsSync(CACHE_DIR)) return [];
  return fs
    .readdirSync(CACHE_DIR)
    .filter((name) => fs.existsSync(path.join(CACHE_DIR, name, 'blank.png')))
    .sort();
}

function isSafeFileName(name) {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

/** Find a template *inside* a frame, trying a few scales. */
function matchTemplateInFrame(vision, frame, tmpl) {
  const cv = getCv();
  const scales = [0.55, 0.7, 0.85, 1, 1.15, 1.35, 1.6];
  let best = { confidence: -1, x: 0, y: 0, width: tmpl.cols, height: tmpl.rows, scale: 1 };
  for (const scale of scales) {
    let needle = tmpl;
    let allocated = false;
    const width = Math.max(8, Math.round(tmpl.cols * scale));
    const height = Math.max(8, Math.round(tmpl.rows * scale));
    if (height > frame.rows || width > frame.cols) continue;
    if (scale !== 1) {
      needle = new cv.Mat();
      cv.resize(tmpl, needle, new cv.Size(width, height), 0, 0, cv.INTER_CUBIC);
      allocated = true;
    }
    const match = vision.matchTemplate(frame, needle);
    if (allocated) needle.delete();
    if (match.confidence > best.confidence) {
      best = {
        confidence: match.confidence,
        x: match.rect.x,
        y: match.rect.y,
        width: match.rect.width,
        height: match.rect.height,
        scale,
      };
    }
  }
  return best;
}

let _configured = false;
async function ensureConfigured() {
  if (_configured) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  await configure({ storage: { root: CACHE_DIR } });
  writeScreenCatalog(undefined, undefined, readDefaults());
  _configured = true;
}

function resetScreenDir(name) {
  const dir = screenDir(name);
  if (!fs.existsSync(dir)) return false;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'blank.png') continue;
    fs.rmSync(path.join(dir, ent.name), { recursive: true, force: true });
  }
  return true;
}

function applyIfFirstPassNewer(name) {
  const dir = screenDir(name);
  const firstPassPath = path.join(dir, 'first-pass.json');
  const indexPath = path.join(dir, 'index.json');
  if (!fs.existsSync(firstPassPath)) return false;
  if (fs.existsSync(indexPath) && fs.statSync(indexPath).mtimeMs >= fs.statSync(firstPassPath).mtimeMs) {
    return false;
  }
  applyScreen(assertScreenName(name));
  return true;
}

function send(res, status, body, type = 'application/json') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : `${JSON.stringify(body)}\n`;
  res.writeHead(status, { 'content-type': type });
  res.end(payload);
}

function sendFile(res, file, type) {
  if (!fs.existsSync(file)) {
    send(res, 404, { error: 'not found' });
    return;
  }
  send(res, 200, fs.readFileSync(file), type);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function matchesTmV2(url) {
  return url.pathname === TM_V2_BASE
    || url.pathname === `${TM_V2_BASE}/`
    || url.pathname.startsWith(`${TM_V2_BASE}/`);
}

function stripTmV2Base(url) {
  if (url.pathname === TM_V2_BASE || url.pathname === `${TM_V2_BASE}/`) {
    return new URL(`/${url.search}`, url.origin);
  }
  return new URL(`${url.pathname.slice(TM_V2_BASE.length)}${url.search}`, url.origin);
}

async function handleInternal(req, res, url) {
  const name = url.searchParams.get('name') || '';

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(HTML_FILE));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    send(res, 200, {
      ...readSettings(),
      cacheDir: CACHE_DIR,
      recordingsDir: RECORDINGS_DIR,
      localScreens: listLocalScreens(),
    });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings') {
    const body = JSON.parse(await readBody(req));
    const settings = body && typeof body === 'object' ? body : {};
    writeSettings(settings);
    send(res, 200, { ...settings, cacheDir: CACHE_DIR });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/charsets') {
    let data = {};
    if (fs.existsSync(CHARSETS_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(CHARSETS_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
      } catch (_) {}
    }
    send(res, 200, { charsets: data });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/charsets') {
    const body = JSON.parse(await readBody(req) || '{}');
    const incoming = (body && body.charsets) ?? {};
    if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) {
      send(res, 400, { error: 'charsets must be a plain object' });
      return;
    }
    for (const [csName, cs] of Object.entries(incoming)) {
      if (!cs || typeof cs !== 'object' || !Array.isArray(cs.only)) {
        send(res, 400, { error: `charset "${csName}" must have an "only" array field` });
        return;
      }
    }
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(CHARSETS_FILE, `${JSON.stringify(incoming, null, 2)}\n`);
    try {
      writeScreenCatalog(undefined, incoming, readDefaults());
    } catch (err) {
      console.error('[tm] catalog regeneration failed after charset save:', err);
    }
    send(res, 200, { charsets: incoming });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/defaults') {
    send(res, 200, { defaults: readDefaults() });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/defaults') {
    const body = JSON.parse(await readBody(req) || '{}');
    const incoming = (body && body.defaults) ?? {};
    if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) {
      send(res, 400, { error: 'defaults must be a plain object' });
      return;
    }
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(DEFAULTS_FILE, `${JSON.stringify(incoming, null, 2)}\n`);
    try {
      writeScreenCatalog(undefined, undefined, incoming);
    } catch (err) {
      console.error('[tm] catalog regeneration failed after defaults save:', err);
    }
    send(res, 200, { defaults: incoming });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ls') {
    const rel = (url.searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');
    if (rel.includes('..')) throw new Error('invalid path');
    const local = listLocalPrefix(rel);
    send(res, 200, { path: rel, local });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/screen' && name) {
    const dir = screenDir(name);
    await ensureConfigured();
    const applied = applyIfFirstPassNewer(assertScreenName(name));
    const indexPath = path.join(dir, 'index.json');
    const boxesPath = path.join(dir, 'boxes.json');
    const firstPassPath = path.join(dir, 'first-pass.json');
    let width = 0;
    let height = 0;
    let elements = [];
    let sections = [];
    let boxes = [];
    let labels = [];
    let firstPass = null;
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      elements = index.elements || [];
      sections = index.sections || [];
    }
    if (fs.existsSync(boxesPath)) {
      const file = JSON.parse(fs.readFileSync(boxesPath, 'utf8'));
      boxes = file.boxes || [];
      labels = file.labels || [];
      width = file.width || 0;
      height = file.height || 0;
    }
    if (fs.existsSync(firstPassPath)) {
      firstPass = JSON.parse(fs.readFileSync(firstPassPath, 'utf8'));
    }
    send(res, 200, {
      name,
      width,
      height,
      elements,
      sections,
      boxes,
      labels,
      firstPass,
      hasBlank: fs.existsSync(path.join(dir, 'blank.png')),
      hasAnnotated: fs.existsSync(path.join(dir, 'boxes-annotated.png')),
      applied,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/detect' && name) {
    await ensureConfigured();
    const result = await detectScreen(assertScreenName(name));
    send(res, 200, {
      name,
      width: result.width,
      height: result.height,
      boxes: result.boxes,
      labels: result.labels,
    });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/boxes' && name) {
    await ensureConfigured();
    const body = JSON.parse(await readBody(req) || '{}');
    const result = await writeBoxes(assertScreenName(name), body.boxes || []);
    send(res, 200, {
      name,
      width: result.width,
      height: result.height,
      boxes: result.boxes,
      labels: result.labels,
    });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/element-options' && name) {
    await ensureConfigured();
    const body = JSON.parse(await readBody(req) || '{}');
    const element = String(body.element || '');
    if (!element) {
      send(res, 400, { error: 'body.element is required' });
      return;
    }
    const patch = {
      ...('type' in body && { type: body.type }),
      ...('charset' in body && { charset: body.charset }),
      ...('swaps' in body && { swaps: body.swaps }),
      ...('overflow' in body && { overflow: body.overflow }),
      ...('read' in body && { read: body.read }),
    };
    if (body.part) {
      const result = patchPartOptions(assertScreenName(name), element, String(body.part), patch);
      send(res, 200, { name, element, part: body.part, firstPass: result.firstPass, index: result.index });
      return;
    }
    const result = patchElementOptions(assertScreenName(name), element, patch);
    send(res, 200, { name, element, firstPass: result.firstPass, index: result.index });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/first-pass' && name) {
    const dir = screenDir(name);
    const firstPass = JSON.parse(await readBody(req));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'first-pass.json'), `${JSON.stringify(firstPass, null, 2)}\n`);
    await ensureConfigured();
    const applied = applyIfFirstPassNewer(assertScreenName(name));
    if (applied) writeScreenCatalog();
    send(res, 200, { saved: name });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reset') {
    const body = JSON.parse(await readBody(req) || '{}');
    if (body.all) {
      const names = listLocalScreens();
      for (const screen of names) resetScreenDir(screen);
      send(res, 200, { ok: true, reset: names });
      return;
    }
    const screen = assertScreenName(body.name || name);
    if (!resetScreenDir(screen)) {
      send(res, 404, { error: 'screen not in local cache' });
      return;
    }
    send(res, 200, { ok: true, reset: [screen] });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/apply' && name) {
    await ensureConfigured();
    const firstPassPath = path.join(screenDir(name), 'first-pass.json');
    if (!fs.existsSync(firstPassPath)) {
      send(res, 400, { error: 'no first-pass.json — assign names first' });
      return;
    }
    const result = applyScreen(assertScreenName(name));
    writeScreenCatalog(undefined, undefined, readDefaults());
    send(res, 200, {
      name,
      elements: result.elements.map((el) => el.name),
    });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/elements' && name) {
    const dir = screenDir(name);
    const blankPath = path.join(dir, 'blank.png');
    if (!fs.existsSync(blankPath)) {
      send(res, 400, { error: 'no blank.png — pull this screen first' });
      return;
    }
    const body = JSON.parse(await readBody(req));
    const elements = body.elements || [];
    const blank = fs.readFileSync(blankPath);
    const tmplDir = path.join(dir, 'templates');
    fs.mkdirSync(tmplDir, { recursive: true });
    const written = [];
    for (const el of elements) {
      const filename = el.filename || `${kebab(el.name)}.png`;
      fs.writeFileSync(path.join(tmplDir, filename), cropPng(blank, el.x, el.y, el.width, el.height));
      written.push({ ...el, filename });
    }
    const indexPath = path.join(dir, 'index.json');
    const prev = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : {};
    fs.writeFileSync(
      indexPath,
      `${JSON.stringify({ name: prev.name || name, sections: prev.sections || [], elements: written }, null, 2)}\n`,
    );
    send(res, 200, { saved: name, count: written.length });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/file') {
    const rel = url.searchParams.get('path') || '';
    const file = safeCachePath(rel);
    const types = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.webm': 'video/webm',
      '.mp4': 'video/mp4',
      '.json': 'application/json',
      '.txt': 'text/plain; charset=utf-8',
      '.ts': 'text/plain; charset=utf-8',
    };
    const type = types[path.extname(file).toLowerCase()];
    if (!type) {
      send(res, 400, { error: 'unsupported file type' });
      return;
    }
    sendFile(res, file, type);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/file/blank' && name) {
    sendFile(res, path.join(screenDir(name), 'blank.png'), 'image/png');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/file/annotated' && name) {
    sendFile(res, path.join(screenDir(name), 'boxes-annotated.png'), 'image/png');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/fs/rename') {
    const body = JSON.parse(await readBody(req) || '{}');
    const fromRel = String(body.path || '');
    const newName = String(body.name || '').trim();
    if (!isSafeFileName(newName)) throw new Error('invalid name');
    const from = resolveWorkspaceFile(fromRel);
    if (!fs.existsSync(from)) {
      send(res, 404, { error: 'not found' });
      return;
    }
    const dest = path.join(path.dirname(from), newName);
    if (from === dest) {
      send(res, 200, { ok: true, path: fromRel });
      return;
    }
    if (fs.existsSync(dest)) throw new Error('a file or folder with that name already exists');
    fs.renameSync(from, dest);
    const parent = fromRel.split('/').slice(0, -1).join('/');
    const nextPath = parent ? `${parent}/${newName}` : newName;
    const indexPath = path.join(dest, 'index.json');
    if (fs.existsSync(indexPath) && fs.statSync(dest).isDirectory()) {
      try {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        if (index && typeof index === 'object') {
          index.name = newName;
          fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
        }
      } catch { /* leave index as-is */ }
    }
    send(res, 200, { ok: true, path: nextPath });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/fs/delete') {
    const body = JSON.parse(await readBody(req) || '{}');
    const rel = String(body.path || '');
    const target = resolveWorkspaceFile(rel);
    if (!fs.existsSync(target)) {
      send(res, 404, { error: 'not found' });
      return;
    }
    fs.rmSync(target, { recursive: true, force: true });
    send(res, 200, { ok: true, path: rel });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/locate-template') {
    await ensureConfigured();
    await ensureCvReady();
    const body = JSON.parse(await readBody(req) || '{}');
    const screen = assertScreenName(body.name || name);
    const templateRel = String(body.template || '').replace(/\\/g, '/');
    if (!templateRel || templateRel.includes('..')) throw new Error('invalid template');
    const tmplPath = path.join(screenDir(screen), 'templates', ...templateRel.split('/'));
    if (!fs.existsSync(tmplPath)) {
      send(res, 404, { error: 'template not found' });
      return;
    }
    const frames = Array.isArray(body.frames) ? body.frames : [body.frame];
    const vision = new VisionUtil();
    const tmplColor = vision.loadImage(fs.readFileSync(tmplPath));
    const tmpl = vision.toGrayscale(tmplColor);
    tmplColor.delete();
    const results = [];
    for (const raw of frames) {
      const frameB64 = String(raw || '').replace(/^data:[^;]+;base64,/, '');
      if (!frameB64) {
        results.push({ found: false, reason: 'frame is required' });
        continue;
      }
      const frameColor = vision.loadImage(Buffer.from(frameB64, 'base64'));
      const frame = vision.toGrayscale(frameColor);
      frameColor.delete();
      const match = matchTemplateInFrame(vision, frame, tmpl);
      frame.delete();
      results.push({
        found: match.confidence >= 0.5,
        confidence: match.confidence,
        scale: match.scale,
        x: match.x,
        y: match.y,
        width: match.width,
        height: match.height,
      });
    }
    tmpl.delete();
    send(res, 200, frames.length === 1 ? results[0] : { results });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/element-variants') {
    await ensureConfigured();
    const body = JSON.parse(await readBody(req) || '{}');
    const screen = assertScreenName(body.name || name);
    const elementName = String(body.element || '');
    if (!elementName) throw new Error('element is required');
    const indexPath = path.join(screenDir(screen), 'index.json');
    if (!fs.existsSync(indexPath)) throw new Error('no index.json for this screen');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const el = (index.elements || []).find((item) => item.name === elementName);
    if (!el) throw new Error('element not found: ' + elementName);
    const incoming = [];
    for (const item of body.variants || []) {
      const variantName = String(item.name || '').trim();
      if (!variantName || !isSafeFileName(variantName)) continue;
      const b64 = String(item.b64 || '').replace(/^data:[^;]+;base64,/, '');
      if (!b64) continue;
      incoming.push({ name: variantName, b64 });
    }
    if (!incoming.length) throw new Error('no named variants to save');
    const defaultName = String(body.default || incoming[0].name);
    incoming.sort((a, b) => (a.name === defaultName ? -1 : b.name === defaultName ? 1 : 0));
    const folder = kebab(elementName);
    const tmplRoot = path.join(screenDir(screen), 'templates');
    const leftover = el.filename && !String(el.filename).includes('/')
      ? path.join(tmplRoot, el.filename)
      : path.join(tmplRoot, `${folder}.png`);
    fs.mkdirSync(path.join(tmplRoot, folder), { recursive: true });
    const variants = {};
    for (const item of incoming) {
      const file = `${folder}/${kebab(item.name)}.png`;
      fs.writeFileSync(path.join(tmplRoot, ...file.split('/')), Buffer.from(item.b64, 'base64'));
      variants[item.name] = { filename: file };
    }
    delete el.filename;
    el.variants = variants;
    if (fs.existsSync(leftover) && leftover !== path.join(tmplRoot, folder)) {
      fs.unlinkSync(leftover);
    }
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    writeScreenCatalog(undefined, undefined, readDefaults());
    send(res, 200, { saved: screen, element: elementName, variants: Object.keys(variants), folder });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/fs/write') {
    const body = JSON.parse(await readBody(req) || '{}');
    const rel = String(body.path || '');
    const { root, parts } = splitWorkspaceRel(rel);
    if (root !== 'recordings' || parts.length < 2) {
      throw new Error('can only write files under recordings/<id>/');
    }
    if (!/\.(png|json)$/i.test(parts[parts.length - 1])) {
      throw new Error('unsupported write type');
    }
    const dest = resolveWorkspaceFile(rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const b64 = String(body.b64 || '').replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
    send(res, 200, { ok: true, path: rel });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/restart') {
    send(res, 200, { ok: true });
    setTimeout(() => {
      const child = spawn(process.execPath, process.argv.slice(1), {
        detached: true,
        stdio: 'inherit',
        env: { ...process.env, TM_NO_OPEN: '1' },
      });
      child.unref();
      process.exit(0);
    }, 100);
    return;
  }

  send(res, 404, { error: 'not found' });
}

/** One-time startup (cache dir, default settings, catalog). */
export function initTmV2() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  if (!fs.existsSync(SETTINGS_FILE)) writeSettings({});
  ensureConfigured().catch((err) => console.error(err));
}

/** Returns true when the request was handled. */
export async function handleTmV2Request(req, res, url) {
  if (!matchesTmV2(url)) return false;
  try {
    await handleInternal(req, res, stripTmV2Base(url));
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    console.error('[tm]', msg);
    send(res, 500, { error: msg });
  }
  return true;
}

export function tmV2StartupLines(port) {
  return [
    `Template Manager: http://localhost:${port}${TM_V2_BASE}`,
    `Local screens: ${CACHE_DIR}`,
    `Recordings: ${RECORDINGS_DIR}`,
  ];
}
