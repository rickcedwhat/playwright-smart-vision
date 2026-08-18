import fs from 'node:fs';
import { join } from 'node:path';
import { flow } from '@qawolf/flows/web';
import { configure } from '@rickcedwhat/playwright-smart-vision';
import * as author from '@rickcedwhat/playwright-smart-vision/author';
import { firstPass, screenName } from '../helpers/smart-vision-first-pass';

export default flow(
  'Smart vision: apply first pass',
  { target: 'Web - Chrome', launch: true },
  async ({ page, test }) => {
    const team = process.env.TEAM_STORAGE_DIR;
    if (!team) throw new Error('TEAM_STORAGE_DIR is not set');
    const root = join(team, 'screens');
    await configure({
      storage: { root },
      devtools: true,
      page,
    });

    await test('apply ' + screenName, async () => {
      const screen = firstPass.screen;
      if (
        screenName === 'replace-with-screen-folder' ||
        !screen ||
        screen.name !== screenName ||
        screen.width <= 0 ||
        screen.height <= 0 ||
        firstPass.elements.length === 0
      ) {
        throw new Error('replace the smart-vision first-pass staging values before apply');
      }

      const result = author.applyScreen(screenName, firstPass);
      const screenDir = join(root, screenName);
      if (
        result.elements.length === 0 ||
        !fs.existsSync(join(screenDir, 'index.json')) ||
        !fs.existsSync(join(screenDir, 'templates'))
      ) {
        throw new Error('smart-vision apply did not create the expected screen artifacts');
      }
      console.log(JSON.stringify(result.elements.map((el) => el.name)));
    });
  },
);
