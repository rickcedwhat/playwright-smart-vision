import type { Page } from '@playwright/test';
import { ocrStep } from './ocr-step.js';
import type { ElementResult } from './types.js';

const OVERLAY_ID = 'ocr-match-overlay';

export type OverlayBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  color?: string;
  fill?: string;
};

/** Remove match outlines so the next OCR screenshot stays clean. */
export async function hideOcrOverlay(page: Page): Promise<void> {
  await ocrStep('hide overlay', async () => {
    try {
      await page.evaluate((id) => {
        document.getElementById(id)?.remove();
        return new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      }, OVERLAY_ID);
    } catch {
      // Page may be navigating.
    }
  });
}

/**
 * Draw match rectangles on the live page.
 * Playwright's video is a screencast of the page, so these outlines show up
 * there. pointer-events: none so fill/click still hit the real controls.
 */
export async function showOcrOverlay(page: Page, boxes: OverlayBox[]): Promise<void> {
  await ocrStep('show overlay', async () => {
    try {
      await page.evaluate(({ id, boxes: rects }) => {
        const dpr = window.devicePixelRatio || 1;
        document.getElementById(id)?.remove();
        const root = document.createElement('div');
        root.id = id;
        root.setAttribute('data-ocr-overlay', '1');
        Object.assign(root.style, {
          position: 'fixed',
          inset: '0',
          pointerEvents: 'none',
          zIndex: '2147483647',
        });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.display = 'block';
        for (const box of rects) {
          const x = box.x / dpr;
          const y = box.y / dpr;
          const width = box.width / dpr;
          const height = box.height / dpr;
          if (!width || !height) continue;
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', String(x));
          rect.setAttribute('y', String(y));
          rect.setAttribute('width', String(width));
          rect.setAttribute('height', String(height));
          rect.setAttribute('fill', box.fill || 'rgba(75, 200, 120, 0.12)');
          rect.setAttribute('stroke', box.color || '#4bc878');
          rect.setAttribute('stroke-width', '2');
          svg.appendChild(rect);
          if (!box.label) continue;
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', String(x + 3));
          text.setAttribute('y', String(Math.max(12, y - 4)));
          text.setAttribute('fill', box.color || '#4bc878');
          text.setAttribute('font-size', '11');
          text.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, sans-serif');
          text.textContent = box.label;
          svg.appendChild(text);
        }
        root.appendChild(svg);
        document.documentElement.appendChild(root);
        return new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      }, { id: OVERLAY_ID, boxes });
    } catch {
      // Page may be navigating.
    }
  });
}

export function overlayBoxesFromResult(result: ElementResult, label?: string): OverlayBox[] {
  const boxes: OverlayBox[] = [{
    ...result.location,
    label: label ?? result.name,
    color: '#4bc878',
    fill: 'rgba(75, 200, 120, 0.12)',
  }];
  if (result.ocrLocation
    && (result.ocrLocation.x !== result.location.x
      || result.ocrLocation.width !== result.location.width
      || result.ocrLocation.y !== result.location.y
      || result.ocrLocation.height !== result.location.height)) {
    boxes.push({
      ...result.ocrLocation,
      color: '#4fc1ff',
      fill: 'rgba(79, 193, 255, 0.1)',
    });
  }
  return boxes;
}
