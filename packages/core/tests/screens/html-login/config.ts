import { defineScreen } from '../../../src/screen-config.js';
import { ElementType } from '../../../src/types.js';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const htmlLoginScreen = defineScreen({
  name: 'html-login',
  baseDir: __dirname,
  elements: [
    { name: 'username', template: 'username.png', type: ElementType.FIELD },
    { name: 'password', template: 'password.png', type: ElementType.FIELD },
    { name: 'signIn',   template: 'sign-in.png',  type: ElementType.BUTTON },
  ],
});
