import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

test('mobile shell is installable and requests standalone fullscreen display', async () => {
  const [manifestText, template, serviceWorker] = await Promise.all([
    readFile(join(root, 'src/manifest.webmanifest'), 'utf8'),
    readFile(join(root, 'src/template.html'), 'utf8'),
    readFile(join(root, 'src/sw.js'), 'utf8')
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone']);
  assert.equal(manifest.orientation, 'landscape');
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  assert.match(template, /rel="manifest"/);
  assert.match(template, /apple-mobile-web-app-capable/);
  assert.match(serviceWorker, /addEventListener\('fetch'/);
  assert.match(serviceWorker, /square-night\.webp/);
  assert.match(serviceWorker, /potion-green\.png/);
});
