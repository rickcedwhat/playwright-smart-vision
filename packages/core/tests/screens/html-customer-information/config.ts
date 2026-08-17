import { defineScreen } from '../../../src/screen-config.js';
import { ElementType } from '../../../src/types.js';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const htmlCustomerInformationScreen = defineScreen({
  name: 'html-customer-information',
  baseDir: __dirname,
  elements: [
    { name: 'customerNumber',        template: 'customer-number.png', type: ElementType.FIELD },
    {
      name: 'vin', template: 'vin.png', type: ElementType.FIELD,
      charset: 'vin', swaps: { '5': ['S'] },
    },
    {
      name: 'name', template: 'name.png', type: ElementType.FIELD,
      parts: [
        { name: 'firstName',    x: 124, y: 4, width: 88, height: 16, overflow: 'end' },
        { name: 'middleInitial',x: 210, y: 4, width: 36, height: 16 },
        { name: 'lastName',     x: 244, y: 4, width: 88, height: 16 },
      ],
    },
    {
      name: 'homePhone', template: 'home-phone.png', type: ElementType.FIELD, charset: 'digits',
      parts: [
        { name: 'area',   x: 124, y: 4, width: 50, height: 16 },
        { name: 'prefix', x: 172, y: 4, width: 50, height: 16 },
        { name: 'line',   x: 220, y: 4, width: 60, height: 16 },
      ],
    },
    { name: 'address',              template: 'address.png',               type: ElementType.FIELD },
    {
      name: 'birthdate', template: 'birthdate.png', type: ElementType.FIELD, charset: 'digits',
      parts: [
        { name: 'month', x: 124, y: 4, width: 36, height: 16 },
        { name: 'day',   x: 174, y: 4, width: 36, height: 16 },
        { name: 'year',  x: 224, y: 4, width: 36, height: 16 },
      ],
    },
    {
      name: 'cityState', template: 'city-state.png', type: ElementType.FIELD,
      parts: [
        { name: 'city',  x: 124, y: 4, width: 148, height: 16 },
        { name: 'state', x: 270, y: 4, width: 44,  height: 16 },
        { name: 'zip',   x: 312, y: 4, width: 88,  height: 16 },
      ],
    },
    {
      name: 'primaryContactMethod', template: 'primary-contact-method.png',
      type: ElementType.DROPDOWN,
      options: ['H - Home Phone', 'W - Work Phone', 'C - Cell', 'E - Email'],
    },
    { name: 'email',  template: 'email.png',  type: ElementType.FIELD, charset: 'email', swaps: { '@': ['C', 'Q'] } },
    // section: 'customer-section.png' scopes match to the Customer section,
    // disambiguating from vehicleActive which uses the same template
    { name: 'customerActive', template: 'active.png', type: ElementType.CHECKBOX, section: 'customer-section.png' },

    { name: 'stockNo',  template: 'stock-no.png',  type: ElementType.FIELD },
    {
      name: 'delivered', template: 'delivered.png', type: ElementType.FIELD, charset: 'digits',
      parts: [
        { name: 'month', x: 124, y: 4, width: 36, height: 16 },
        { name: 'day',   x: 174, y: 4, width: 36, height: 16 },
        { name: 'year',  x: 224, y: 4, width: 36, height: 16 },
      ],
    },
    { name: 'year',      template: 'year.png',      type: ElementType.FIELD, charset: 'digits' },
    { name: 'odometer',  template: 'odometer.png',  type: ElementType.FIELD, charset: 'digits' },
    { name: 'make',      template: 'make.png',       type: ElementType.FIELD },
    { name: 'color',     template: 'color.png',      type: ElementType.FIELD },
    { name: 'model',     template: 'model.png',      type: ElementType.FIELD },
    { name: 'doNotCall',    template: 'do-not-call.png', type: ElementType.CHECKBOX },
    { name: 'vehicleActive', template: 'active.png',    type: ElementType.CHECKBOX, section: 'vehicle-section.png' },
    {
      name: 'save',
      variants: {
        disabled: { template: 'save-disabled.png' },
        enabled:  { template: 'save-enabled.png'  },
      },
      type: ElementType.BUTTON,
    },
    { name: 'saveStatus', template: 'save-toast.png', type: ElementType.MESSAGE },
  ],
});
