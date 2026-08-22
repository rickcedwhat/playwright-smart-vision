import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./screen.js', () => ({
  screen: vi.fn(),
}));

import { createScreen } from './screen-api.js';
import { screen as rawScreen } from './screen.js';

const mockScreen = vi.mocked(rawScreen);

describe('createScreen', () => {
  const catalog = {
    htmlLogin: { name: 'html-login', elements: { username: 'username', password: 'password' } },
    customerInfo: { name: 'customer-info', elements: { custNum: 'custNum' } },
  } as const;

  beforeEach(() => {
    mockScreen.mockReset();
  });

  it('returns a callable function', () => {
    const screen = createScreen(catalog);
    expect(typeof screen).toBe('function');
  });

  it('delegates name and options to the underlying screen()', () => {
    const fakeResult = {} as ReturnType<typeof rawScreen>;
    mockScreen.mockReturnValue(fakeResult);

    const screen = createScreen(catalog);
    const options = { overlay: true } as Parameters<typeof rawScreen>[1];
    const result = screen('html-login', options);

    expect(mockScreen).toHaveBeenCalledOnce();
    expect(mockScreen).toHaveBeenCalledWith('html-login', options);
    expect(result).toBe(fakeResult);
  });

  it('passes undefined options through when called without options', () => {
    mockScreen.mockReturnValue({} as ReturnType<typeof rawScreen>);
    const screen = createScreen(catalog);
    screen('customer-info');
    expect(mockScreen).toHaveBeenCalledWith('customer-info', undefined);
  });

  it('each createScreen call returns a distinct function', () => {
    const screen1 = createScreen(catalog);
    const screen2 = createScreen(catalog);
    expect(screen1).not.toBe(screen2);
  });
});
