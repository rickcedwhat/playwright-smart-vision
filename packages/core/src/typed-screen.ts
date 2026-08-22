import path from 'node:path';
import type { ScreenComparison, ElementConfig } from './types.js';
import { ScreenResult } from './screen-result.js';
import type { Page } from '@playwright/test';

/**
 * @deprecated Use `createScreen` from the package root instead.
 * `defineTypedScreen` will be removed in the next major version.
 */
export interface TypedScreenConfig<TElements extends readonly ElementConfig[]> {
  name: string;
  blankScreenPath: string;
  elementConfigs: TElements;
  baseDir?: string | undefined;
  debug?: boolean | undefined;
}

type ExtractElementNames<T extends readonly ElementConfig[]> = T[number]['name'];

/**
 * @deprecated Use `createScreen` from the package root instead.
 * `TypedScreenResult` will be removed in the next major version.
 */
export class TypedScreenResult<TElements extends readonly ElementConfig[]> extends ScreenResult {
  constructor(
    comparison: ScreenComparison,
    private elementNames: Set<string>,
    page?: Page
  ) {
    super(comparison, page);
  }

  element<TName extends ExtractElementNames<TElements>>(
    name: TName
  ): ReturnType<ScreenResult['element']> {
    return super.element(name as string);
  }
}

/**
 * @deprecated Use `createScreen` from the package root instead.
 * `defineTypedScreen` will be removed in the next major version.
 */
export function defineTypedScreen<
  const TElements extends readonly ElementConfig[]
>(config: {
  name: string;
  baseDir: string;
  blankScreen?: string;
  elements: TElements;
  debug?: boolean;
}): TypedScreenConfig<TElements> {
  const blankScreenPath = path.join(
    config.baseDir,
    config.blankScreen || 'blank.png'
  );

  const elementConfigs = config.elements.map(el => {
    const elementConfig: any = {
      name: el.name,
      type: el.type,
    };

    if ('template' in el && el.template) {
      elementConfig.templatePath = path.join(config.baseDir, 'templates', el.template as string);
    } else if ('variants' in el && el.variants) {
      elementConfig.variants = {};
      for (const [variantName, variantConfig] of Object.entries(el.variants)) {
        if (variantConfig && typeof variantConfig === 'object' && 'template' in variantConfig) {
          elementConfig.variants[variantName] = {
            template: path.join(config.baseDir, 'templates', (variantConfig as any).template),
          };
        }
      }
    }

    if ('section' in el && el.section) {
      elementConfig.sectionTemplatePath = path.join(config.baseDir, 'templates', el.section as string);
    } else if (el.sectionTemplatePath) {
      elementConfig.sectionTemplatePath = el.sectionTemplatePath;
    }

    if ('animated' in el && el.animated) {
      elementConfig.animated = el.animated;
    }
    if ('options' in el && Array.isArray(el.options) && el.options.length) {
      elementConfig.options = el.options;
    }

    return elementConfig;
  }) as unknown as TElements;

  const result: TypedScreenConfig<TElements> = {
    name: config.name,
    blankScreenPath,
    elementConfigs,
  };

  if (config.baseDir !== undefined) {
    result.baseDir = config.baseDir;
  }

  if (config.debug !== undefined) {
    result.debug = config.debug;
  }

  return result;
}
