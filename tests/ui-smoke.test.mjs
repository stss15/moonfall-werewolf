import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

async function bundledApp() {
  const result = await build({
    entryPoints: [join(root, 'src/app.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2021'],
    write: false,
    plugins: [{
      name: 'fake-trystero',
      setup(builder) {
        builder.onResolve({filter: /^trystero$/}, () => ({path: 'trystero', namespace: 'fake'}));
        builder.onLoad({filter: /.*/, namespace: 'fake'}, () => ({contents: `
          export const selfId = 'peer-host';
          export function joinRoom(){
            globalThis.__joinCount = (globalThis.__joinCount || 0) + 1;
            globalThis.__receivers = {};
            globalThis.__sent = [];
            return {
              makeAction(id){
                return [
                  (data, target) => globalThis.__sent.push({id, data, target}),
                  callback => { globalThis.__receivers[id] = callback }
                ];
              },
              onPeerJoin(callback){ globalThis.__peerJoin = callback },
              onPeerLeave(callback){ globalThis.__peerLeave = callback },
              leave(){}
            };
          }
        `}));
      }
    }]
  });
  return result.outputFiles[0].text;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 25));

test('mobile lobby renders, accepts five remote seats and deals the cards', async () => {
  const dom = new JSDOM(`<!doctype html><body><main id="app"></main><div id="toast-root"></div><div id="modal-root"></div></body>`, {
    url: 'https://moonfall.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  dom.window.Math.random = () => 0;
  dom.window.navigator.vibrate = () => true;
  dom.window.navigator.clipboard = {writeText: async () => {}};
  let wakeRequests = 0;
  Object.defineProperty(dom.window.navigator, 'wakeLock', {value: {request: async () => {
    wakeRequests += 1;
    return {release: async () => {}, addEventListener: () => {}};
  }}});
  dom.window.confirm = () => true;
  dom.window.eval(await bundledApp());
  await tick();

  const createName = dom.window.document.querySelector('#create-name');
  assert.ok(createName, 'create form should be visible');
  createName.value = 'Steven';
  dom.window.document.querySelector('[data-action="create-room"]').click();
  await tick();

  const code = dom.window.document.querySelector('.room-code')?.textContent.trim();
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.match(dom.window.document.querySelector('.screen').textContent, /1 of 19 places/);

  for (let index = 1; index <= 5; index += 1) {
    const peerId = `peer-${index}`;
    dom.window.__receivers.mfhello({
      seatId: `seat-${index}`,
      seatKey: `key-${index}`,
      name: `Player ${index}`,
      code
    }, peerId);
  }
  await tick();
  assert.match(dom.window.document.querySelector('.screen').textContent, /6 of 19 places/);
  const start = dom.window.document.querySelector('[data-action="start-game"]');
  assert.equal(start.disabled, false);
  start.click();
  await tick();

  assert.equal(dom.window.document.body.dataset.phase, 'role-reveal');
  assert.match(dom.window.document.querySelector('.phase-ribbon').textContent, /cards are dealt/i);
  assert.ok(dom.window.document.querySelector('.flip-card'));
  assert.ok(dom.window.__sent.some(item => item.id === 'mfview'), 'private views should be sent to peers');
  assert.ok(wakeRequests > 0, 'every joined game phone should request screen-awake protection');

  dom.window.dispatchEvent(new dom.window.Event('offline'));
  dom.window.dispatchEvent(new dom.window.Event('online'));
  await new Promise(resolve => setTimeout(resolve, 260));
  assert.equal(dom.window.__joinCount, 1, 'connectivity recovery must not destroy and recreate the Trystero room');
  assert.ok(dom.window.__sent.some(item => item.id === 'mfhost'), 'the host should recover by announcing on its existing room');
  dom.window.close();
});

test('five local test agents play roles while the user controls the Storyteller', async () => {
  const dom = new JSDOM(`<!doctype html><body><main id="app"></main><div id="toast-root"></div><div id="modal-root"></div></body>`, {
    url: 'https://moonfall.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  dom.window.navigator.vibrate = () => true;
  dom.window.navigator.clipboard = {writeText: async () => {}};
  dom.window.confirm = () => true;
  dom.window.eval(await bundledApp());
  await tick();

  const name = dom.window.document.querySelector('#create-name');
  name.value = 'Steven';
  dom.window.document.querySelector('[data-action="start-agent-test"]').click();
  await tick();
  assert.match(dom.window.document.querySelector('.screen').textContent, /Storyteller/);
  assert.equal(dom.window.document.body.dataset.phase, 'role-reveal');

  dom.window.document.querySelector('[data-action="flip-role"]').click();
  await tick();
  dom.window.document.querySelector('[data-action="seal-role"]').click();
  await new Promise(resolve => setTimeout(resolve, 1100));
  const advance = dom.window.document.querySelector('[data-action="story-advance"]');
  assert.ok(advance && !advance.disabled, 'all five agents should seal their cards automatically');
  advance.click();
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(dom.window.document.body.dataset.phase, 'setup-cupid');
  assert.match(dom.window.document.querySelector('.screen').textContent, /Call the lovers|Cupid/);
  dom.window.close();
});
