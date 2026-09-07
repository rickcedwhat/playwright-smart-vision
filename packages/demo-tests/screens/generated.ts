// Generated 2026-09-06T23:30:07.365Z by Template Manager — do not edit, re-generated on every save.
/** @generated */
import type { Strategies } from '@rickcedwhat/playwright-smart-vision';

export const strategies = {} satisfies Strategies;

export const screens = {
  crmSystem: {
    name: "crm-system",
    elements: {
      "windowTitle": { name: "windowTitle", type: "label" },
      "minimize": { name: "minimize", type: "button" },
      "maximize": { name: "maximize", type: "button" },
      "closeWindow": { name: "closeWindow", type: "button" },
      "searchCustomers": { name: "searchCustomers", type: "field" },
      "newCustomer": { name: "newCustomer", type: "button" },
      "customers": { name: "customers", type: "other" },
      "johnEmail": { name: "johnEmail", type: "field" },
      "johnPhone": { name: "johnPhone", type: "field" },
      "janeEmail": { name: "janeEmail", type: "field" },
      "janePhone": { name: "janePhone", type: "field" },
      "bobEmail": { name: "bobEmail", type: "field" },
    },
  },
  customerInformation: {
    name: "customer-information",
    elements: {
      "windowTitle": { name: "windowTitle", type: "label" },
      "minimize": { name: "minimize", type: "button" },
      "maximize": { name: "maximize", type: "button" },
      "closeWindow": { name: "closeWindow", type: "button" },
      "customerNumber": { name: "customerNumber", type: "field" },
      "firstName": { name: "firstName", type: "field" },
      "lastName": { name: "lastName", type: "field" },
      "email": { name: "email", type: "field" },
      "phone": { name: "phone", type: "field", parts: {"area": "field", "prefix": "field", "line": "field"} },
      "address": { name: "address", type: "field" },
      "city": { name: "city", type: "field" },
      "state": { name: "state", type: "field" },
      "zip": { name: "zip", type: "field" },
      "vin": { name: "vin", type: "field" },
      "birthdate": { name: "birthdate", type: "field", parts: {"month": "field", "day": "field", "year": "field"} },
      "activeCustomer": { name: "activeCustomer", type: "checkbox" },
      "doNotCall": { name: "doNotCall", type: "checkbox" },
      "contactMethod": { name: "contactMethod", type: "dropdown" },
      "save": { name: "save", type: "button" },
      "close": { name: "close", type: "button" },
    },
  },
  desktop: {
    name: "desktop",
    elements: {
      "crmIcon": { name: "crmIcon", type: "icon" },
      "start": { name: "start", type: "button" },
    },
  },
} as const;

export type ScreenName = keyof typeof screens extends never
  ? string
  : (typeof screens)[keyof typeof screens]['name'];

type _ScreenKey<S extends ScreenName> = {
  [K in keyof typeof screens]: (typeof screens)[K]['name'] extends S ? K : never;
}[keyof typeof screens];

type _Screen<S extends ScreenName> = (typeof screens)[_ScreenKey<S>];

export type ElementName<S extends ScreenName> = keyof _Screen<S>['elements'] & string;

export type PartName<S extends ScreenName, E extends ElementName<S>> =
  _Screen<S>['elements'][E] extends { parts: infer P } ? keyof P & string : never;

export type PartType<S extends ScreenName, E extends ElementName<S>, P extends PartName<S, E>> =
  _Screen<S>['elements'][E] extends { parts: infer Parts }
    ? Parts extends Record<string, string>
      ? P extends keyof Parts
        ? Parts[P]
        : never
      : never
    : never;
