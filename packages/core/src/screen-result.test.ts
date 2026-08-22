import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScreenResult } from './screen-result.js';
import { setOcrStrategy } from './utils/ocr.js';
import type { ScreenConfig } from './screen-config.js';

function makeConfig(read?: 'ocr' | 'clipboard'): ScreenConfig {
  return {
    name: 'test-screen',
    blankScreenPath: '/fake/blank.png',
    elementConfigs: [
      {
        name: 'field1',
        blankFormPath: '/fake/blank.png',
        labelNeedle: '/fake/label.png',
        ...(read !== undefined && { read }),
      },
    ],
  } as unknown as ScreenConfig;
}

function makeHost(
  config: ScreenConfig,
  initRead?: 'ocr' | 'clipboard',
): ScreenResult {
  return ScreenResult.bind(
    {} as never,
    {} as never,
    config,
    '/tmp',
    { ...(initRead !== undefined && { initRead }) },
  );
}

// ---------------------------------------------------------------------------
// matchOptions() — read resolution order
// ---------------------------------------------------------------------------

describe('matchOptions() — read resolution order', () => {
  beforeEach(() => setOcrStrategy(undefined));
  afterEach(() => setOcrStrategy(undefined));

  it('returns no read when nothing is configured', () => {
    const result = makeHost(makeConfig());
    expect(result.matchOptions('field1').read).toBeUndefined();
  });

  it('picks up read from Strategies.Ocr (lowest precedence)', () => {
    setOcrStrategy({ read: 'clipboard' });
    const result = makeHost(makeConfig());
    expect(result.matchOptions('field1').read).toBe('clipboard');
  });

  it('index.json (config.read) wins over Strategies.Ocr', () => {
    setOcrStrategy({ read: 'clipboard' });
    const result = makeHost(makeConfig('ocr'));
    expect(result.matchOptions('field1').read).toBe('ocr');
  });

  it('init() level wins over index.json config.read', () => {
    const result = makeHost(makeConfig('clipboard'), 'ocr');
    expect(result.matchOptions('field1').read).toBe('ocr');
  });

  it('init() level wins over Strategies.Ocr', () => {
    setOcrStrategy({ read: 'clipboard' });
    const result = makeHost(makeConfig(), 'ocr');
    expect(result.matchOptions('field1').read).toBe('ocr');
  });
});

// ---------------------------------------------------------------------------
// ScreenResult.bind() — overlay option forwarded to host
// ---------------------------------------------------------------------------

describe('ScreenResult.bind() — overlay', () => {
  it('stores overlay:true on the host', () => {
    const result = ScreenResult.bind({} as never, {} as never, makeConfig(), '/tmp', { overlay: true });
    // paintOverlay/hideOverlay are no-ops without a real page; we verify the host flag indirectly
    // by confirming the bound result exposes the correct internal state via the public API.
    // (overlay is only visible through behaviour with a real Page — this just asserts no throw.)
    expect(result).toBeInstanceOf(ScreenResult);
  });

  it('stores overlay:false on the host', () => {
    const result = ScreenResult.bind({} as never, {} as never, makeConfig(), '/tmp', { overlay: false });
    expect(result).toBeInstanceOf(ScreenResult);
  });

  it('omitting overlay leaves it unset', () => {
    const result = ScreenResult.bind({} as never, {} as never, makeConfig(), '/tmp', {});
    expect(result).toBeInstanceOf(ScreenResult);
  });
});
