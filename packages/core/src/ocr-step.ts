type PlaywrightTest = typeof import('@playwright/test').test;

let _test: PlaywrightTest | null | undefined; // undefined=not yet loaded, null=unavailable

async function getTest(): Promise<PlaywrightTest | null> {
  if (_test !== undefined) return _test;
  try {
    _test = (await import('@playwright/test')).test;
  } catch {
    _test = null;
  }
  return _test;
}

export async function ocrStep<T>(title: string, body: () => Promise<T>): Promise<T> {
  const test = await getTest();
  if (!test) return body();
  try { test.info(); } catch { return body(); }
  return test.step(title, body, { box: true });
}

export async function attachOcrImage(name: string, buffer: Buffer): Promise<void> {
  const test = await getTest();
  if (!test) return;
  try {
    await test.info().attach(name, { body: buffer, contentType: 'image/png' });
  } catch {}
}

/**
 * Resolve the assertion timeout: explicit override → 5 000 ms default → 0 outside a test.
 * Uses the cached test reference — will be populated after the first ocrStep call in a
 * Playwright context. Returns 0 (no retry) when called outside a Playwright test.
 */
export function expectTimeout(override?: number): number {
  if (override !== undefined) return override;
  if (!_test) return 0;
  try { _test.info(); return 5_000; } catch { return 0; }
}
