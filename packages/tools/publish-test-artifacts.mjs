#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'test-results');
const DEST_DIR = path.join(PROJECT_ROOT, 'artifacts', 'html-fixture');

function walk(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found;
}

function latest(filename, needle) {
  return walk(RESULTS_DIR)
    .filter((file) => path.basename(file) === filename && file.includes(needle))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

export function publishHtmlFixtureArtifacts({ sinceMs } = {}) {
  const video = latest('video.webm', 'html-login-ocr');
  const trace = latest('trace.zip', 'html-login-ocr');
  const fresh = (file) => file && (sinceMs == null || fs.statSync(file).mtimeMs >= sinceMs);
  const nextVideo = fresh(video) ? video : null;
  const nextTrace = fresh(trace) ? trace : null;
  if (!nextVideo && !nextTrace) {
    return { video: null, trace: null };
  }
  fs.mkdirSync(DEST_DIR, { recursive: true });
  if (nextVideo) fs.copyFileSync(nextVideo, path.join(DEST_DIR, 'video.webm'));
  if (nextTrace) fs.copyFileSync(nextTrace, path.join(DEST_DIR, 'trace.zip'));
  return {
    video: nextVideo ? path.join(DEST_DIR, 'video.webm') : null,
    trace: nextTrace ? path.join(DEST_DIR, 'trace.zip') : null,
  };
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = publishHtmlFixtureArtifacts();
  if (!result.video || !result.trace) {
    console.error('Could not find video.webm / trace.zip under test-results for html-login-ocr.');
    process.exit(1);
  }
  console.log(`Wrote ${path.relative(PROJECT_ROOT, DEST_DIR)}/video.webm`);
  console.log(`Wrote ${path.relative(PROJECT_ROOT, DEST_DIR)}/trace.zip`);
}
