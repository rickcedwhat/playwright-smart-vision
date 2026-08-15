import { test } from '@playwright/test';

/**
 * Wrap OCR actions so they appear as named steps in the Playwright report and trace.
 * Falls back to running the body when called outside a test.
 */
export async function ocrStep<T>(title: string, body: () => Promise<T>): Promise<T> {
  try {
    test.info();
  } catch {
    return body();
  }
  return test.step(title, body, { box: true });
}

/** Attach a PNG to the current Playwright test so it shows in the report and trace. */
export async function attachOcrImage(name: string, buffer: Buffer): Promise<void> {
  try {
    await test.info().attach(name, { body: buffer, contentType: 'image/png' });
  } catch {
    // Not running inside a Playwright test.
  }
}
