import {build} from 'esbuild';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {extname, join} from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const src = join(root, 'src');
const assets = join(root, 'assets');
const dist = join(root, 'dist');

await rm(dist, {recursive: true, force: true});
await mkdir(join(dist, 'assets'), {recursive: true});

// Production room invites must always point at the canonical Pages site. The
// app previously copied location.origin + location.pathname, so opening an old
// deployment/staging URL caused every QR code and share link to reproduce it.
const appSource = await readFile(join(src, 'app.js'), 'utf8');
const canonicalAppSource = appSource.replace(
  /function roomInviteUrl\(\) \{\s*return `\$\{location\.origin\}\$\{location\.pathname\}\?room=\$\{roomCode\}`;\s*\}/,
  "function roomInviteUrl() {\n  const invite = new URL('https://stss15.github.io/moonfall-werewolf/');\n  invite.searchParams.set('room', roomCode);\n  return invite.toString();\n}"
);
if (canonicalAppSource === appSource) throw new Error('Could not patch the canonical Moonfall invite URL');

const bundle = await build({
  stdin: {
    contents: canonicalAppSource,
    resolveDir: src,
    sourcefile: 'app.js',
    loader: 'js'
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2021'],
  minify: true,
  legalComments: 'none',
  write: false,
  define: {'process.env.NODE_ENV': '"production"'}
});

const [template, styles, manifest, serviceWorker] = await Promise.all([
  readFile(join(src, 'template.html'), 'utf8'),
  readFile(join(src, 'styles.css'), 'utf8'),
  readFile(join(src, 'manifest.webmanifest'), 'utf8'),
  readFile(join(src, 'sw.js'), 'utf8')
]);
const script = bundle.outputFiles[0].text.replaceAll('</script', '<\\/script');
// Use replacement callbacks so minified `$&`, `$\`` and `$'` sequences stay
// literal JavaScript instead of being interpreted by String.replace.
const html = template
  .replace('/*__STYLE__*/', () => styles)
  .replace('/*__SCRIPT__*/', () => script);
await writeFile(join(dist, 'index.html'), html);
await writeFile(join(dist, 'manifest.webmanifest'), manifest);
await writeFile(join(dist, 'sw.js'), serviceWorker);

const assetNames = [
  'apple-touch-icon.png',
  'card-back.webp', 'cupid.webp', 'hunter.webp', 'little-girl.webp', 'logo.webp',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'seer.webp', 'sheriff.webp', 'storyteller.webp', 'table-bg.webp', 'thief.webp',
  'villager.webp', 'werewolf.webp', 'witch.webp'
];
await Promise.all(assetNames.map(name => cp(join(assets, name), join(dist, 'assets', name))));
await cp(join(assets, 'sfx'), join(dist, 'assets', 'sfx'), {recursive: true});
await cp(join(assets, 'sprites'), join(dist, 'assets', 'sprites'), {recursive: true});

// The narrator voice pack is generated (scripts/generate_voice_pack.py), not
// committed; ship it whenever it exists so deploys gain the recorded voice.
let voicePackShipped = false;
try {
  await cp(join(assets, 'voice'), join(dist, 'assets', 'voice'), {recursive: true});
  voicePackShipped = true;
} catch { /* No pack generated: the app falls back to on-device Web Speech. */ }
try {
  await cp(join(assets, 'ambience'), join(dist, 'assets', 'ambience'), {recursive: true});
} catch { /* No generated ambience: the procedural soundscape is used. */ }

let single = html;
for (const name of assetNames) {
  const bytes = await readFile(join(assets, name));
  const mime = extname(name) === '.webp' ? 'image/webp' : extname(name) === '.png' ? 'image/png' : 'application/octet-stream';
  single = single.replaceAll(`assets/${name}`, `data:${mime};base64,${bytes.toString('base64')}`);
}
await writeFile(join(dist, 'moonfall-werewolf.html'), single);

// ChatGPT Sites expects a Workers-compatible entrypoint. The production worker
// serves the same self-contained edition, so it needs no runtime filesystem,
// database, environment variables or asset service.
await mkdir(join(dist, 'server'), {recursive: true});
await mkdir(join(dist, '.openai'), {recursive: true});
const pwaAssetNames = ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const pwaAssets = Object.fromEntries(await Promise.all(pwaAssetNames.map(async name => [name, (await readFile(join(assets, name))).toString('base64')])));
const worker = `const HTML=${JSON.stringify(single)};
const MANIFEST=${JSON.stringify(manifest)};
const SERVICE_WORKER=${JSON.stringify(serviceWorker)};
const PWA_ASSETS=${JSON.stringify(pwaAssets)};
const HEADERS={
  "content-type":"text/html; charset=utf-8",
  "cache-control":"no-cache",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
  "permissions-policy":"camera=(), microphone=(), geolocation=(), screen-wake-lock=(self), fullscreen=(self)",
  "content-security-policy":"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
const bytes=base64=>Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
export default {async fetch(request){
  const pathname=new URL(request.url).pathname;
  if(pathname.endsWith('/manifest.webmanifest'))return new Response(MANIFEST,{headers:{"content-type":"application/manifest+json","cache-control":"no-cache"}});
  if(pathname.endsWith('/sw.js'))return new Response(SERVICE_WORKER,{headers:{"content-type":"application/javascript; charset=utf-8","cache-control":"no-cache","service-worker-allowed":"/"}});
  const assetName=pathname.split('/').pop();
  if(PWA_ASSETS[assetName])return new Response(bytes(PWA_ASSETS[assetName]),{headers:{"content-type":"image/png","cache-control":"public, max-age=31536000, immutable"}});
  return new Response(HTML,{status:200,headers:HEADERS});
}};
`;
await writeFile(join(dist, 'server', 'index.js'), worker);
await cp(join(root, '.openai', 'hosting.json'), join(dist, '.openai', 'hosting.json'));

await writeFile(join(dist, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), screen-wake-lock=(self), fullscreen=(self)
  Content-Security-Policy: default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/manifest.webmanifest
  Content-Type: application/manifest+json
  Cache-Control: no-cache

/sw.js
  Content-Type: application/javascript; charset=utf-8
  Cache-Control: no-cache
  Service-Worker-Allowed: /
`);

console.log(`Built Moonfall: ${Math.round(Buffer.byteLength(html) / 1024)} KiB shell, ${Math.round(Buffer.byteLength(single) / 1024)} KiB single-file edition, narrator voice pack ${voicePackShipped ? 'included' : 'not generated (on-device speech fallback)'}.`);
