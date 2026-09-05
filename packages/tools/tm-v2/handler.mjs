/**
 * Template Manager v2 — Local screen authoring and management.
 * Mounted under /template-manager on the main tools server (port 2020).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { configure } from '@rickcedwhat/playwright-smart-vision/configure';
import { applyScreen, detectScreen, writeBoxes, writeScreenCatalog, patchElementOptions, patchPartOptions } from '@rickcedwhat/playwright-smart-vision/author';

export const TM_V2_BASE = '/template-manager';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const HTML_FILE = path.join(TOOLS_DIR, 'index.html');
const HOME = path.join(os.homedir(), '.smart-vision');
const SETTINGS_FILE = path.join(HOME, 'tm-v2.json');
const CACHE_DIR = path.join(HOME, 'screens');
const CHARSETS_FILE = path.join(HOME, 'charsets.json');
const DEFAULTS_FILE = path.join(HOME, 'defaults.json');

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

function safeCachePath(rel) {
  const clean = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/');
  if (!clean || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('invalid path');
  }
  if (!parts.every((part) => /^[a-zA-Z0-9._-]+$/.test(part))) {
    throw new Error('invalid path');
  }
  return path.join(CACHE_DIR, ...parts);
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

function listLocalPrefix(relPath) {
  const dir = relPath ? path.join(CACHE_DIR, ...relPath.split('/')) : CACHE_DIR;
  if (!fs.existsSync(dir)) return { dirs: [], files: [] };
  const dirs = [];
  const files = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    if (ent.isDirectory()) dirs.push(ent.name);
    else files.push(ent.name);
  }
  return { dirs: dirs.sort(), files: files.sort() };
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
    send(res, 200, { ...readSettings(), cacheDir: CACHE_DIR, localScreens: listLocalScreens() });
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
      console.error('[tm-v2] catalog regeneration failed after charset save:', err);
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
      console.error('[tm-v2] catalog regeneration failed after defaults save:', err);
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
    console.error('[tm-v2]', msg);
    send(res, 500, { error: msg });
  }
  return true;
}

export function tmV2StartupLines(port) {
  return [
    `Template Manager: http://localhost:${port}${TM_V2_BASE}`,
    `Local screens: ${CACHE_DIR}`,
  ];
}
