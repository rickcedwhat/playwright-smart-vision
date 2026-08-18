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
    await configure({
      storage: { root: team + '/screens' },
      devtools: true,
      page,
    });

    await test('apply ' + screenName, async () => {
      const result = author.applyScreen(screenName, firstPass);
      console.log(JSON.stringify(result.elements.map((el) => el.name)));
    });
  },
);
