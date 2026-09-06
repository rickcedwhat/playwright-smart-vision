/**
 * Start Template Manager against this package's ./screens folder.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.SMART_VISION_SCREENS = path.join(here, 'screens');

await import('../tools/template-manager-server.mjs');
