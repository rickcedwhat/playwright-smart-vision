#!/usr/bin/env node
/**
 * Open demo-app with the FAB so new screens/recordings land next to ./screens.
 * Usage (from repo root): pnpm capture
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { configure } from '@rickcedwhat/playwright-smart-vision/configure';

const here = path.dirname(fileURLToPath(import.meta.url));
const screensRoot = path.join(here, 'screens');
const recordingsRoot = path.join(here, 'recordings');
const demoServer = path.join(here, '..', 'demo-app', 'server.mjs');
const DEMO_PORT = 3456;

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

async function waitForPort(port, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isPortOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Demo app did not start on http://localhost:${port}`);
}

async function ensureDemoServer() {
  if (await isPortOpen(DEMO_PORT)) return undefined;
  const child = spawn(process.execPath, [demoServer], {
    stdio: 'inherit',
    cwd: path.dirname(demoServer),
  });
  await waitForPort(DEMO_PORT);
  return child;
}

async function main() {
  const server = await ensureDemoServer();

  const browser = await chromium.launch({
    headless: false,
    args: ['--window-position=0,0'],
  });

  const shutdown = async () => {
    await browser.close().catch(() => {});
    server?.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  await configure({
    storage: { root: screensRoot },
    devtools: true,
    page,
  });

  await page.goto(`http://localhost:${DEMO_PORT}`);

  console.log('Canvas demo opened with the FAB.');
  console.log(`Captures save to: ${screensRoot}`);
  console.log(`Recordings save to: ${recordingsRoot}`);
  console.log('Author in Template Manager: pnpm tm');
  console.log('Press Ctrl+C when done\n');

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
