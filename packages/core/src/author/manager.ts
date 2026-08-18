import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import type { AppliedElement } from './apply.js';
import type { BoxesFile } from './detect.js';
import { MANAGER_HTML } from './manager-ui.js';
import { cropPng } from './png-crop.js';
import { kebab } from './geometry.js';
import { screenDir, storageRoot } from './storage.js';

export interface RunManagerOptions {
  screen?: string;
  /** Default true: block until Done or the viewer tab closes. */
  wait?: boolean;
  timeoutMs?: number;
}

export interface RunManagerHandle {
  url: string;
  viewer: Page;
  close: () => Promise<void>;
}

function listScreenNames(): string[] {
  const root = storageRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => fs.existsSync(path.join(root, name, 'blank.png')))
    .sort();
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : `${JSON.stringify(body)}\n`;
  res.writeHead(status, { 'content-type': type });
  res.end(payload);
}

function sendFile(res: http.ServerResponse, file: string, type: string): void {
  if (!fs.existsSync(file)) {
    send(res, 404, { error: 'not found' });
    return;
  }
  send(res, 200, fs.readFileSync(file), type);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function startServer(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const name = url.searchParams.get('name') || '';

      if (req.method === 'GET' && url.pathname === '/') {
        send(res, 200, MANAGER_HTML, 'text/html; charset=utf-8');
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/screens') {
        send(res, 200, listScreenNames());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/screen' && name) {
        const dir = screenDir(name);
        const blankPath = path.join(dir, 'blank.png');
        const indexPath = path.join(dir, 'index.json');
        const boxesPath = path.join(dir, 'boxes.json');
        let width = 0;
        let height = 0;
        let elements: AppliedElement[] = [];
        let boxes: BoxesFile['boxes'] = [];
        if (fs.existsSync(indexPath)) {
          const index = readJson(indexPath) as { elements?: AppliedElement[]; name?: string };
          elements = index.elements ?? [];
        }
        if (fs.existsSync(boxesPath)) {
          const file = readJson(boxesPath) as BoxesFile;
          boxes = file.boxes ?? [];
          width = file.width;
          height = file.height;
        }
        send(res, 200, { name, width, height, elements, boxes, hasBlank: fs.existsSync(blankPath) });
        return;
      }
      if (req.method === 'PUT' && url.pathname === '/api/screen' && name) {
        const dir = screenDir(name);
        const blankPath = path.join(dir, 'blank.png');
        const indexPath = path.join(dir, 'index.json');
        if (!fs.existsSync(blankPath)) {
          send(res, 400, { error: `no blank.png for ${name}` });
          return;
        }
        const body = JSON.parse(await readBody(req)) as { elements?: AppliedElement[] };
        const elements = body.elements ?? [];
        const blank = fs.readFileSync(blankPath);
        const tmplDir = path.join(dir, 'templates');
        fs.mkdirSync(tmplDir, { recursive: true });
        const written: AppliedElement[] = [];
        for (const el of elements) {
          const filename = el.filename || `${kebab(el.name)}.png`;
          fs.writeFileSync(path.join(tmplDir, filename), cropPng(blank, el.x, el.y, el.width, el.height));
          written.push({ ...el, filename });
        }
        const prev = fs.existsSync(indexPath)
          ? (readJson(indexPath) as { name?: string; sections?: unknown[] })
          : {};
        fs.writeFileSync(
          indexPath,
          `${JSON.stringify({ name: prev.name || name, sections: prev.sections ?? [], elements: written }, null, 2)}\n`,
        );
        send(res, 200, { saved: name, count: written.length });
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
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

/**
 * Open a minimal Template Manager in a **new tab** (Guacamole stays alive).
 * Reads/writes `{storage.root}/{screen}/` on FUSE. Click Done or close the tab to finish.
 */
export async function runManager(page: Page, options: string | RunManagerOptions = {}): Promise<RunManagerHandle> {
  const opts: RunManagerOptions = typeof options === 'string' ? { screen: options } : options;
  const { server, url } = await startServer();
  const screen = opts.screen;
  const viewer = await page.context().newPage();
  const href = screen ? `${url}/?screen=${encodeURIComponent(screen)}` : `${url}/`;
  await viewer.goto(href);
  await viewer.bringToFront();

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!viewer.isClosed()) await viewer.close();
  };

  if (opts.wait !== false) {
    const timeout = opts.timeoutMs ?? 30 * 60 * 1000;
    try {
      await Promise.race([
        viewer.waitForEvent('close'),
        viewer.waitForFunction(
          () => Boolean((globalThis as unknown as { __smartVisionDone?: boolean }).__smartVisionDone),
          null,
          { timeout },
        ),
      ]);
    } finally {
      await close();
    }
  }

  return { url, viewer, close };
}
