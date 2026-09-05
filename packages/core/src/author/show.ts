import fs from 'node:fs';
import type { Page } from '@playwright/test';

/**
 * Open an annotated PNG (typically boxes-annotated.png) in a **new tab**.
 * Leaves the original page alone so tests can continue.
 * Close the returned page when done inspecting.
 */
export async function showAnnotated(page: Page, pngPath: string): Promise<Page> {
  if (!fs.existsSync(pngPath)) {
    throw new Error(`showAnnotated: file not found: ${pngPath}`);
  }
  const b64 = fs.readFileSync(pngPath).toString('base64');
  const viewer = await page.context().newPage();
  await viewer.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#111">
<img src="data:image/png;base64,${b64}" alt="annotated boxes" style="max-width:100%;height:auto;display:block" />
</body></html>`,
  );
  await viewer.bringToFront();
  return viewer;
}
