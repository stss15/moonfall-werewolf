import test from 'node:test';
import assert from 'node:assert/strict';
import {morningLine, spriteFile, townSquare} from '../src/village.js';

function fakeView(overrides = {}) {
  const players = {};
  for (const name of ['Ada', 'Ben', 'Cleo', 'Drew', 'Eli', 'Finn']) {
    const id = name.toLowerCase();
    players[id] = {id, name, alive: true, connected: true, storyteller: false, sheriff: false, role: null};
  }
  return {
    roomCode: 'TEST42',
    phase: 'day-discussion',
    day: 2,
    players,
    chronicle: [],
    lastDeaths: [],
    nightResult: {healed: false, poisoned: false},
    winner: null,
    me: {id: 'ada', alive: true, role: 'villager', loverId: null, visions: null, pack: null},
    ...overrides
  };
}

test('the square draws one animated sprite per character and living strangers all look like villagers', () => {
  const view = fakeView({me: {id: 'ada', alive: true, role: 'werewolf', loverId: null, visions: null, pack: []}});
  const square = townSquare(view);
  assert.equal((square.match(/data-sprite=/g) || []).length, 6);
  assert.equal((square.match(/sheets\/villager\.webp/g) || []).length, 5, 'every other living soul is dressed as a villager');
  assert.equal((square.match(/sheets\/werewolf\.webp/g) || []).length, 1, 'only your own phone shows your true form');
  assert.match(square, /class="ss loop/, 'living characters play their sheet animation');
});

test('private knowledge dresses the crowd: pack sight and the Seer’s visions', () => {
  const wolfView = fakeView({me: {id: 'ada', alive: true, role: 'werewolf', loverId: null, visions: null, pack: ['ben']}});
  assert.equal(spriteFile(wolfView, wolfView.players.ben), 'werewolf', 'wolves recognise their pack');
  const seerView = fakeView({me: {id: 'ada', alive: true, role: 'seer', loverId: null, visions: {cleo: 'witch'}, pack: null}});
  assert.equal(spriteFile(seerView, seerView.players.cleo), 'witch', 'the Seer keeps what her visions showed her');
  const plainView = fakeView();
  assert.equal(spriteFile(plainView, plainView.players.ben), 'villager');
});

test('the dead become ghosts where they stood, revealed once the village turns their card', () => {
  const view = fakeView();
  view.players.ben.alive = false;
  view.players.ben.role = 'werewolf';
  const square = townSquare(view);
  assert.match(square, /sprite ghost/);
  assert.match(square, /sheets\/werewolf\.webp/, 'a revealed ghost wears its true sheet');
  const hidden = fakeView();
  hidden.players.ben.alive = false;
  hidden.players.ben.role = null;
  const hiddenSquare = townSquare(hidden);
  assert.match(hiddenSquare, /sprite ghost/);
  assert.doesNotMatch(hiddenSquare, /sheets\/werewolf\.webp/, 'an unrevealed corpse stays anonymous');
});

test('a selection context makes legal targets tappable and dims the rest', () => {
  const view = fakeView({me: {id: 'ada', alive: true, role: 'seer', loverId: null, visions: null, pack: null}});
  const select = {ids: new Set(['ben', 'cleo']), selected: ['ben'], action: 'seer-choose'};
  const square = townSquare(view, {select});
  assert.match(square, /square selecting named-all/);
  assert.equal((square.match(/can-pick/g) || []).length, 2);
  assert.match(square, /picked/);
  assert.match(square, /pick-ring/);
  assert.ok((square.match(/sprite [^"]*\boff\b/g) || []).length >= 3, 'non-targets stand dimmed');
});

test('the heart hangs only over the lovers, and only on their own phones', () => {
  const lover = fakeView({me: {id: 'ada', alive: true, role: 'villager', loverId: 'cleo', visions: null, pack: null}});
  assert.equal((townSquare(lover).match(/mark heart/g) || []).length, 2, 'both bound souls are marked for the lover');
  const stranger = fakeView({me: {id: 'ben', alive: true, role: 'villager', loverId: null, visions: null, pack: null}});
  assert.doesNotMatch(townSquare(stranger), /mark heart/);
});

test('the Sheriff’s badge is public, and tapping is wired for every sprite', () => {
  const view = fakeView();
  view.players.drew.sheriff = true;
  const square = townSquare(view);
  assert.equal((square.match(/mark badge/g) || []).length, 1);
  assert.equal((square.match(/data-sprite=/g) || []).length, 6);
  assert.match(square, /sprite-name/, 'names wait behind a tap');
});

test('the morning line is keyed to what actually happened in the night', () => {
  const kill = fakeView({phase: 'dawn', lastDeaths: [{id: 'ben', name: 'Ben', cause: 'the Werewolves'}]});
  assert.match(morningLine(kill), /Ben’s cottage/);
  const saved = fakeView({phase: 'dawn', nightResult: {healed: true, poisoned: false}});
  assert.match(morningLine(saved), /chimney/);
  assert.match(morningLine(fakeView({phase: 'dawn'})), /Frost/);
});
