/**
 * Template Manager v2 — GCS screens (QA Wolf team-storage).
 * Mounted under /template-manager on the main tools server (port 2020).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { configure } from '@rickcedwhat/playwright-smart-vision';
import { applyScreen, detectScreen, writeBoxes, writeScreenCatalog, patchElementOptions, patchPartOptions } from '@rickcedwhat/playwright-smart-vision/author';

export const TM_V2_BASE = '/template-manager';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const HTML_FILE = path.join(TOOLS_DIR, 'index.html');
const HOME = path.join(os.homedir(), '.smart-vision');
const SETTINGS_FILE = path.join(HOME, 'tm-v2.json');
const CACHE_DIR = path.join(HOME, 'screens');
const DEFAULT_GCS = 'gs://qawolf-prod-team-storage/clzn2wsor00hcda0ickzd3544/screens';

const RUNTIME_FILES = ['blank.png', 'index.json'];
const CHARSETS_FILE = path.join(HOME, 'charsets.json');

function normalizeGcs(raw) {
  const uri = String(raw || '').trim().replace(/\/+$/, '');
  if (!uri.startsWith('gs://')) {
    throw new Error('GCS URI must start with gs://');
  }
  return uri;
}

function assertScreensUri(gcsUri) {
  const uri = normalizeGcs(gcsUri);
  if (!uri.endsWith('/screens')) {
    throw new Error('GCS URI must end with /screens — refusing to push anywhere else');
  }
  return uri;
}

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { gcsUri: normalizeGcs(raw.gcsUri || DEFAULT_GCS) };
  } catch {
    return { gcsUri: DEFAULT_GCS };
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

function runGcloud(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('gcloud', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', () => {
      reject(new Error('gcloud not found — install the Google Cloud SDK and run gcloud auth login'));
    });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || stdout.trim() || `gcloud exited ${code}`));
      else resolve(`${stdout}${stderr ? `\n${stderr}` : ''}`.trim());
    });
  });
}

function parseLs(stdout, gcsPrefix) {
  const prefix = `${gcsPrefix.replace(/\/+$/, '')}/`;
  const dirs = new Set();
  const files = new Set();
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('gs://') || trimmed.endsWith(':')) continue;
    if (!trimmed.startsWith(prefix)) continue;
    const rest = trimmed.slice(prefix.length);
    if (!rest) continue;
    const parts = rest.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts.length !== 1) continue;
    const name = parts[0];
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue;
    if (trimmed.endsWith('/')) dirs.add(name);
    else files.add(name);
  }
  return { dirs: [...dirs].sort(), files: [...files].sort() };
}

async function listGcsPrefix(gcsUri, relPath) {
  const base = relPath ? `${gcsUri}/${relPath}` : gcsUri;
  try {
    const stdout = await runGcloud(['storage', 'ls', `${base}/`]);
    return parseLs(stdout, base);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (/matched no objects/i.test(msg)) return { dirs: [], files: [] };
    throw err;
  }
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

function screenRuntimePlan(name) {
  const dir = screenDir(name);
  const missing = [];
  for (const file of RUNTIME_FILES) {
    if (!fs.existsSync(path.join(dir, file))) missing.push(file);
  }
  const tmplDir = path.join(dir, 'templates');
  const templates = [];
  if (!fs.existsSync(tmplDir) || !fs.statSync(tmplDir).isDirectory()) {
    missing.push('templates/');
  } else {
    for (const ent of fs.readdirSync(tmplDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.png') || !isSafeFileName(ent.name)) continue;
      templates.push(ent.name);
    }
    if (!templates.length) missing.push('templates/*.png');
  }
  if (missing.length) {
    return { name, ready: false, reason: `missing ${missing.join(', ')}`, files: [] };
  }
  return {
    name,
    ready: true,
    files: [
      ...RUNTIME_FILES.map((file) => `${name}/${file}`),
      ...templates.map((file) => `${name}/templates/${file}`),
    ],
  };
}

function stageRuntimeScreen(name, stagingRoot) {
  const src = screenDir(name);
  const dest = path.join(stagingRoot, name);
  fs.mkdirSync(path.join(dest, 'templates'), { recursive: true });
  for (const file of RUNTIME_FILES) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
  const tmplDir = path.join(src, 'templates');
  for (const ent of fs.readdirSync(tmplDir, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith('.png') || !isSafeFileName(ent.name)) continue;
    fs.copyFileSync(path.join(tmplDir, ent.name), path.join(dest, 'templates', ent.name));
  }
}

async function rsync(src, dest, { dryRun = false } = {}) {
  if (!src.startsWith('gs://')) fs.mkdirSync(src, { recursive: true });
  if (!dest.startsWith('gs://')) fs.mkdirSync(dest, { recursive: true });
  const args = ['storage', 'rsync', '-r'];
  if (dryRun) args.push('--dry-run');
  args.push(src, dest);
  return runGcloud(args);
}

async function pushRuntimeScreens({ names, dryRun }) {
  await ensureConfigured();
  const gcsUri = assertScreensUri(readSettings().gcsUri);
  const requested = names?.length
    ? names.map((name) => assertScreenName(name))
    : listLocalScreens();
  const plans = requested.map(screenRuntimePlan);
  const ready = plans.filter((plan) => plan.ready);
  const skipped = plans.filter((plan) => !plan.ready);
  if (!ready.length) {
    throw new Error('no runtime-ready screens to push (need blank.png, index.json, templates/*.png)');
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-v2-push-'));
  const logs = [];
  try {
    for (const plan of ready) {
      stageRuntimeScreen(plan.name, staging);
      const dest = `${gcsUri}/${plan.name}`;
      const log = await rsync(path.join(staging, plan.name), dest, { dryRun });
      logs.push({
        screen: plan.name,
        dest,
        files: plan.files,
        gcloud: log.trim(),
      });
    }
    const catalogLocal = path.join(CACHE_DIR, 'generated.ts');
    if (fs.existsSync(catalogLocal)) {
      const dest = `${gcsUri}/generated.ts`;
      const log = dryRun
        ? `Would copy ${catalogLocal} to ${dest}`
        : await runGcloud(['storage', 'cp', catalogLocal, dest]);
      logs.push({
        screen: 'generated.ts',
        dest,
        files: ['generated.ts'],
        gcloud: String(log).trim(),
      });
    }
    if (fs.existsSync(CHARSETS_FILE)) {
      const dest = `${gcsUri}/charsets.json`;
      const log = dryRun
        ? `Would copy ${CHARSETS_FILE} to ${dest}`
        : await runGcloud(['storage', 'cp', CHARSETS_FILE, dest]);
      logs.push({
        screen: 'charsets.json',
        dest,
        files: ['charsets.json'],
        gcloud: String(log).trim(),
      });
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  return {
    dryRun,
    deletes: false,
    gcsUri,
    pushed: ready.map((plan) => plan.name),
    skipped: skipped.map((plan) => ({ name: plan.name, reason: plan.reason })),
    operations: logs,
  };
}

async function ensureConfigured() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  await configure({ storage: { root: CACHE_DIR } });
  writeScreenCatalog();
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
    const settings = { gcsUri: normalizeGcs(body.gcsUri) };
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
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(CHARSETS_FILE, `${JSON.stringify(incoming, null, 2)}\n`);
    send(res, 200, { charsets: incoming });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/remote') {
    const names = await listGcsPrefix(readSettings().gcsUri, '').then((listing) => listing.dirs);
    send(res, 200, { screens: names });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/pull') {
    const body = JSON.parse(await readBody(req) || '{}');
    const gcsUri = readSettings().gcsUri;
    const screen = body.name ? assertScreenName(body.name) : '';
    if (screen) await rsync(`${gcsUri}/${screen}`, screenDir(screen));
    else await rsync(gcsUri, CACHE_DIR);
    send(res, 200, { ok: true, localScreens: listLocalScreens() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ls') {
    const rel = (url.searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');
    if (rel.includes('..')) throw new Error('invalid path');
    const gcsUri = readSettings().gcsUri;
    const remote = await listGcsPrefix(gcsUri, rel);
    const local = listLocalPrefix(rel);
    send(res, 200, { path: rel, remote, local });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/push') {
    const body = JSON.parse(await readBody(req) || '{}');
    const dryRun = body.dryRun === true;
    const names = body.name ? [assertScreenName(body.name)] : undefined;
    const result = await pushRuntimeScreens({ names, dryRun });
    send(res, 200, result);
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
    applyIfFirstPassNewer(assertScreenName(name));
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

  send(res, 404, { error: 'not found' });
}

/** One-time startup (cache dir, default settings, catalog). */
export function initTmV2() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(SETTINGS_FILE)) writeSettings({ gcsUri: DEFAULT_GCS });
  ensureConfigured().catch((err) => console.error(err));
}

function isAuthError(msg) {
  return /gcloud not found|active account|auth login|UNAUTHENTICATED|invalid authentication credentials|credentials do not satisfy|could not refresh|invalid_grant|AccessDeniedException/i.test(msg);
}

/** Returns true when the request was handled. */
export async function handleTmV2Request(req, res, url) {
  if (!matchesTmV2(url)) return false;
  try {
    await handleInternal(req, res, stripTmV2Base(url));
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    console.error('[tm-v2]', msg);
    if (isAuthError(msg)) {
      send(res, 401, { error: 'GCS auth error — run: gcloud auth login', authRequired: true });
    } else {
      send(res, 500, { error: msg });
    }
  }
  return true;
}

export function tmV2StartupLines(port) {
  return [
    `Template Manager (GCS): http://localhost:${port}${TM_V2_BASE}`,
    `Local cache: ${CACHE_DIR}`,
    `GCS: ${readSettings().gcsUri}`,
  ];
}
