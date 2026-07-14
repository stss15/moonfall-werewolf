import './build.mjs';
import {cp} from 'node:fs/promises';
import {join} from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const assets = join(root, 'assets');
const dist = join(root, 'dist');

try {
  await cp(join(assets, 'role-sfx'), join(dist, 'assets', 'role-sfx'), {recursive: true});
  console.log('Included premium role SFX pack in production dist.');
} catch {
  console.log('No premium role SFX pack found; production build keeps procedural role cues.');
}
