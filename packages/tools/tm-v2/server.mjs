#!/usr/bin/env node
/**
 * Template Manager v2 — GCS screens (QA Wolf team-storage).
 * Uses `gcloud storage` (gcloud auth login). Does not replace the v1 manager.
 *
 *   pnpm tm:v2
 *   open http://127.0.0.1:2021
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { configure } from '@rickcedwhat/playwright-smart-vision';
import { applyScreen, detectScreen, writeBoxes } from '@rickcedwhat/playwright-smart-vision/author';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const HTML_FILE = path.join(TOOLS_DIR, 'index.html');
const HOME = path.join(os.homedir(), '.smart-vision');
const SETTINGS_FILE = path.join(HOME, 'tm-v2.json');
const CACHE_DIR = path.join(HOME, 'screens');
const DEFAULT_GCS = 'gs://qawolf-prod-team-storage/clzn2wsor00hcda0ickzd3544/screens';
const PORT = Number(process.env.PORT) || 2021;

function normalizeGcs(raw) {
  const uri = String(raw || '').trim().replace(/\/+$/, '');
  if (!uri.startsWith('gs://')) {
    throw new Error('GCS URI must start with gs://');
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
      else resolve(stdout);
    });
  });
}

function listRemoteScreens(gcsUri) {
  return listGcsPrefix(gcsUri, '').then((listing) => listing.dirs);
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
  const stdout = await runGcloud(['storage', 'ls', `${base}/`]);
  return parseLs(stdout, base);
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

async function rsync(src, dest, { deleteUnmatched = false } = {}) {
  if (!src.startsWith('gs://')) fs.mkdirSync(src, { recursive: true });
  if (!dest.startsWith('gs://')) fs.mkdirSync(dest, { recursive: true });
  const args = ['storage', 'rsync', '-r'];
  if (deleteUnmatched) args.push('--delete-unmatched-destination-objects');
  args.push(src, dest);
  await runGcloud(args);
}

async function ensureConfigured() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  await configure({ storage: { root: CACHE_DIR } });
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

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
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

  if (req.method === 'GET' && url.pathname === '/api/remote') {
    const names = await listRemoteScreens(readSettings().gcsUri);
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
    send(res, 403, { error: 'GCS write is disabled in TM v2 for now' });
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
    };
    const type = types[path.extname(file).toLowerCase()];
    if (!type) {
      send(res, 400, { error: 'not an image' });
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

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  });
});

fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(SETTINGS_FILE)) writeSettings({ gcsUri: DEFAULT_GCS });

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Template Manager v2: http://127.0.0.1:${PORT}`);
  console.log(`Local cache: ${CACHE_DIR}`);
  console.log(`GCS: ${readSettings().gcsUri}`);
  console.log('v1 manager is unchanged (pnpm dev, port 2020)');
});
