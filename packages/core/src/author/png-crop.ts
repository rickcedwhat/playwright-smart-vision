import { PNG } from 'pngjs';

export function cropPng(pngBuffer: Buffer, x: number, y: number, width: number, height: number): Buffer {
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
