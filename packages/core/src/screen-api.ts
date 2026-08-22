import { screen as rawScreen } from './screen.js';
import type { BindOcrScreenOptions } from './screen.js';
import type { ScreenResult } from './screen-result.js';
import type { ScreenElement } from './element.js';

type ScreenKey<
  T extends Record<string, { name: string; elements: Record<string, string> }>,
  S extends T[keyof T]['name'],
> = { [K in keyof T]: T[K]['name'] extends S ? K : never }[keyof T];

type CatalogElementName<
  T extends Record<string, { name: string; elements: Record<string, string> }>,
  S extends T[keyof T]['name'],
> = keyof T[ScreenKey<T, S>]['elements'] & string;

type TypedResult<
  T extends Record<string, { name: string; elements: Record<string, string> }>,
  S extends T[keyof T]['name'],
> = Omit<ScreenResult, 'element'> & {
  element(name: CatalogElementName<T, S>): ScreenElement;
};

/**
 * Create a typed screen() function bound to a generated.ts catalog.
 * Call once with your imported `screens` const, then use the returned
 * `screen()` for compile-time element-name checking.
 *
 *   import { createScreenApi } from '@rickcedwhat/playwright-smart-vision';
 *   import { screens } from '../helpers/screens.generated';
 *
 *   const api = createScreenApi(screens);
 *
 *   // In a test (after await init(...)):
 *   const customerInfo = api.screen('customer-info');
 *   await customerInfo.element('customerNumber').toHaveValue('SEA314535');
 *   // TypeScript error: customerInfo.element('typo') ← won't compile
 */
export function createScreenApi<
  const T extends Record<string, { name: string; elements: Record<string, string> }>,
>(_catalog: T): {
  screen<S extends T[keyof T]['name']>(name: S, options?: BindOcrScreenOptions): TypedResult<T, S>;
} {
  return {
    screen(name, options) {
      return rawScreen(name as string, options) as unknown as TypedResult<T, typeof name>;
    },
  };
}
