import { defineScreen } from '../../../src/screen-config.js';
import { ElementType } from '../../../src/types.js';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const htmlNavScreen = defineScreen({
  name: 'html-nav',
  baseDir: __dirname,
  elements: [
    { name: 'customerSearch',   template: 'customer-search.png',   type: ElementType.BUTTON },
    { name: 'vehicleInventory', template: 'vehicle-inventory.png', type: ElementType.BUTTON },
    { name: 'service',          template: 'service.png',           type: ElementType.BUTTON },
    { name: 'fni',              template: 'fni.png',               type: ElementType.BUTTON },
    { name: 'parts',            template: 'parts.png',             type: ElementType.BUTTON },
    { name: 'reports',          template: 'reports.png',           type: ElementType.BUTTON },
  ],
});
