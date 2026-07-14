import test from 'node:test';
import assert from 'node:assert/strict';
import {morningLine, villageScene} from '../src/village.js';

function fakeView(overrides = {}) {
  const players = {};
  for (const name of ['Ada', 'Ben', 'Cleo', 'Drew', 'Eli', 'Finn']) {
    const id = name.toLowerCase();
    players[id] = {id, name, alive: true, connected: true, storyteller: false, sheriff: false};
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
    me: {id: 'ada', alive: true, loverId: null},
    ...overrides
  };
}

test('the village draws one cottage per character and remembers every death', () => {
  const view = fakeView();
  view.players.ben.alive = false;
  view.chronicle = [{id: 'ben', cause: 'the Werewolves', night: 1, day: 1, source: 'night'}];
  const scene = villageScene(view);
  assert.equal((scene.match(/vg-house/g) || []).length, 6);
  assert.match(scene, /vg-house dead/, 'a dead player’s cottage is boarded');
  assert.match(scene, /clawed/, 'a wolf kill leaves claw-marks on the door');
  assert.match(scene, /vg-grave/, 'the churchyard gains a cross');
  assert.match(scene, /data-mood="day"/);
});

test('moods follow the tale: night, dawn, dusk lobby and the wolves’ ember epilogue', () => {
  assert.match(villageScene(fakeView({phase: 'night-wolves'})), /data-mood="night"/);
  assert.match(villageScene(fakeView({phase: 'dawn'})), /data-mood="dawn"/);
  assert.match(villageScene(fakeView({phase: 'lobby'})), /data-mood="dusk"/);
  assert.match(villageScene(fakeView({phase: 'game-over', winner: {team: 'wolves'}})), /data-mood="ember"/);
  assert.match(villageScene(fakeView({phase: 'game-over', winner: {team: 'wolves'}})), /vg-ember/);
});

test('the red thread appears only on a living lover’s own phone', () => {
  const bound = fakeView({me: {id: 'ada', alive: true, loverId: 'cleo'}});
  assert.match(villageScene(bound), /vg-thread/);
  const stranger = fakeView({me: {id: 'ben', alive: true, loverId: null}});
  assert.doesNotMatch(villageScene(stranger), /vg-thread/);
  const bereaved = fakeView({me: {id: 'ada', alive: true, loverId: 'cleo'}});
  bereaved.players.cleo.alive = false;
  assert.doesNotMatch(villageScene(bereaved), /vg-thread/, 'a severed thread must not linger');
});

test('the dead see the village through a ghost veil; the scene never leaks roles', () => {
  const view = fakeView({me: {id: 'ada', alive: false, loverId: null}});
  view.players.ada.alive = false;
  const scene = villageScene(view);
  assert.match(scene, /data-ghost="1"/);
  assert.match(scene, /vg-wisp/);
  assert.doesNotMatch(scene, /werewolf|seer|witch/i);
});

test('the morning line is keyed to what actually happened in the night', () => {
  const kill = fakeView({phase: 'dawn', lastDeaths: [{id: 'ben', name: 'Ben', cause: 'the Werewolves'}]});
  assert.match(morningLine(kill), /Ben’s cottage/);
  const saved = fakeView({phase: 'dawn', nightResult: {healed: true, poisoned: false}});
  assert.match(morningLine(saved), /chimney/);
  assert.match(morningLine(fakeView({phase: 'dawn'})), /Frost/);
});
