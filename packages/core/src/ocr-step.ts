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

/**
 * Resolve the assertion timeout: explicit override → 5 000 ms default → 0 outside a test.
 * 5 000 ms matches Playwright's built-in expect.timeout default. Pass options.timeout to
 * override per-call, or pass 0 to assert once without retrying.
 * Returns 0 when called outside a Playwright test (no retry in unit/script contexts).
 */
export function expectTimeout(override?: number): number {
  if (override !== undefined) return override;
  try {
    test.info();
    return 5_000;
  } catch {
    return 0;
  }
}
