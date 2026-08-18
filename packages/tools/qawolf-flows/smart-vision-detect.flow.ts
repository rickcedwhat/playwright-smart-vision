import fs from 'node:fs';
import { flow } from '@qawolf/flows/web';
import { configure } from '@rickcedwhat/playwright-smart-vision';
import * as author from '@rickcedwhat/playwright-smart-vision/author';

function screensRoot(): string {
  const team = process.env.TEAM_STORAGE_DIR;
  if (!team) throw new Error('TEAM_STORAGE_DIR is not set');
  return team + '/screens';
}

function listBlanks(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => fs.existsSync(root + '/' + name + '/blank.png'));
}

export default flow(
  'Smart vision: detect and show',
  { target: 'Web - Chrome', launch: true },
  async ({ page, test }) => {
    const root = screensRoot();
    await configure({ storage: { root }, devtools: true, page });

    const requested = process.env.SMART_VISION_SCREEN;
    const names = requested ? [requested] : listBlanks(root);
    if (names.length === 0) {
      throw new Error('no screens with blank.png under ' + root);
    }

    const detected = {};
    for (const name of names) {
      await test('detect ' + name, async () => {
        detected[name] = await author.detectScreen(name);
      });
    }

    const showName =
      requested ||
      names.find((name) => !fs.existsSync(root + '/' + name + '/index.json')) ||
      names[0];

    await test('show ' + showName, async () => {
      const result = detected[showName];
      const viewer = await author.showAnnotated(page, result.annotatedPath);
      await viewer.bringToFront();
      console.log(
        JSON.stringify(
          {
            screen: showName,
            width: result.width,
            height: result.height,
            boxIds: result.boxes.map((box) => box.id),
          },
          null,
          2,
        ),
      );
    });
  },
);
