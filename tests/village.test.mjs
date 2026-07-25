import test from 'node:test';
import assert from 'node:assert/strict';
import {morningLine, spriteFile, townSquare} from '../src/village.js';
import {deathCinematic, seerCinematic, victoryCinematic} from '../src/cutscene.js';

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
  assert.doesNotMatch(square, /class="ss loop/, 'idle characters stand still — no walk-in-place frame cycling');
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
  // The fallen wear the painted kneeling art, not a standing idle frame.
  assert.match(square, /dead-werewolf\.webp/, 'a revealed ghost wears its true fallen figure');
  assert.doesNotMatch(square, /sheets\/werewolf\.webp/, 'the dead do not stand about in their living pose');
  const hidden = fakeView();
  hidden.players.ben.alive = false;
  hidden.players.ben.role = null;
  const hiddenSquare = townSquare(hidden);
  assert.match(hiddenSquare, /sprite ghost/);
  assert.match(hiddenSquare, /dead-villager\.webp/, 'an unrevealed corpse falls as a plain villager');
  assert.doesNotMatch(hiddenSquare, /dead-werewolf\.webp/, 'an unrevealed corpse stays anonymous');
});

test('the Hunter has no painted fallen figure and falls back to the sheet', () => {
  const view = fakeView();
  view.players.ben.alive = false;
  view.players.ben.role = 'hunter';
  const square = townSquare(view);
  assert.match(square, /sprite ghost/);
  assert.doesNotMatch(square, /dead-hunter\.webp/, 'assets/sprites/dead-hunter.webp does not exist');
  assert.match(square, /sheets\/hunter\.webp/, 'the one role without fallen art keeps the sheet ghost');
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

test('lovers stand in their chained bound pose, and only on their own phones', () => {
  const lover = fakeView({me: {id: 'ada', alive: true, role: 'villager', loverId: 'cleo', visions: null, pack: null}});
  const square = townSquare(lover);
  assert.equal((square.match(/background-position:0% 75%/g) || []).length, 2, 'both bound souls wear the chained sheet row');
  assert.doesNotMatch(square, /mark heart/, 'no floating heart betrays the pose');
  const stranger = fakeView({me: {id: 'ben', alive: true, role: 'villager', loverId: null, visions: null, pack: null}});
  const strangerSquare = townSquare(stranger);
  assert.doesNotMatch(strangerSquare, /background-position:0% 75%/, 'strangers see ordinary standing villagers');
});

test('the Sheriff’s badge is public, and tapping is wired for every sprite', () => {
  const view = fakeView();
  view.players.drew.sheriff = true;
  const square = townSquare(view);
  assert.equal((square.match(/mark badge/g) || []).length, 1);
  assert.match(square, /badge\.png/, 'the Sheriff wears the real badge, not a glyph');
  assert.equal((square.match(/data-sprite=/g) || []).length, 6);
  assert.equal((square.match(/data-id=/g) || []).length, 6, 'every sprite carries the id the action handler reads');
  assert.match(square, /sprite-name/, 'names wait behind a tap');
});

test('the morning line is keyed to what actually happened in the night', () => {
  const kill = fakeView({phase: 'dawn', lastDeaths: [{id: 'ben', name: 'Ben', cause: 'the Werewolves'}]});
  assert.match(morningLine(kill), /Ben’s cottage/);
  const saved = fakeView({phase: 'dawn', nightResult: {healed: true, poisoned: false}});
  assert.match(morningLine(saved), /chimney/);
  assert.match(morningLine(fakeView({phase: 'dawn'})), /Frost/);
});

test('dawn falls anonymously before revealing each true role and cause', () => {
  const view = fakeView({phase: 'dawn', lastDeaths: [
    {id: 'ben', name: 'Ben', role: 'werewolf', cause: 'the Werewolves'},
    {id: 'cleo', name: 'Cleo', role: 'witch', cause: 'a broken heart'}
  ]});
  const scene = deathCinematic(view);
  assert.match(scene, /cinema-body disguise[\s\S]*sheets\/villager\.webp/);
  assert.match(scene, /cinema-body truth[\s\S]*sheets\/werewolf\.webp/);
  assert.match(scene, /cause-wolf/);
  assert.match(scene, /cause-heart/);
});

test('the Seer vision evolves a villager silhouette into the private true form', () => {
  const view = fakeView();
  const scene = seerCinematic(view, {target: 'ben', result: 'werewolf'});
  assert.match(scene, /crystal-ball\.png/);
  assert.match(scene, /seer-form mortal[\s\S]*sheets\/villager\.webp/);
  assert.match(scene, /seer-form true-form[\s\S]*sheets\/werewolf\.webp/);
});

test('the living crowd breathes while the dead hold still', () => {
  const view = fakeView({
    players: {
      ...fakeView().players,
      ben: {id: 'ben', name: 'Ben', alive: false, connected: true, storyteller: false, sheriff: false, role: 'seer'}
    }
  });
  const square = townSquare(view);
  // Every sheet's idle row holds four real drawings; the crowd used to be
  // frozen on frame 0. The living now play them, staggered per character.
  assert.equal((square.match(/ss idle-life/g) || []).length, 5, 'the five living villagers each get their own idle cycle');
  assert.doesNotMatch(square.slice(square.indexOf('data-sprite="ben"')), /^[\s\S]{0,400}ss idle-life/, 'a ghost does not breathe');

  const durations = [...square.matchAll(/--ssidle:([\d.]+)s/g)].map(match => match[1]);
  const delays = [...square.matchAll(/--ssidledel:(-[\d.]+)s/g)].map(match => match[1]);
  assert.equal(durations.length, 5);
  assert.ok(new Set(durations).size > 1, 'characters must not share one cycle length');
  assert.ok(new Set(delays).size > 1, 'characters must not flourish in unison');
});

test('the crowd stands in staggered rows with depth, not in columns', () => {
  const square = townSquare(fakeView());
  const lefts = [...square.matchAll(/left:([\d.]+)%/g)].map(match => Number(match[1]));
  const front = lefts.slice(0, 3);
  const back = lefts.slice(3);
  for (const x of back) {
    assert.ok(front.every(f => Math.abs(f - x) > 4), `back-row ${x}% lines up with the front row`);
  }
  const depths = [...square.matchAll(/--depth:([\d.]+)/g)].map(match => Number(match[1]));
  assert.deepEqual(depths.slice(0, 3), [0, 0, 0], 'the front row is fully lit');
  assert.ok(depths.slice(3).every(d => d > 0), 'rows further back recede');
});

test('committing an action plays your own role’s act pose, and only yours', () => {
  const view = fakeView({me: {id: 'ada', alive: true, role: 'witch', loverId: null, visions: null, pack: null}});
  const still = townSquare(view);
  assert.doesNotMatch(still, /class="[^"]*acting/);

  const acting = townSquare(view, {acting: true});
  const mine = acting.split('<button').find(chunk => chunk.includes('data-sprite="ada"'));
  assert.ok(mine, 'the viewer stands in their own square');
  assert.match(mine, /class="[^"]*acting/);
  assert.match(mine, /sheets\/witch\.webp/);
  assert.match(mine, /background-position:0% 50%/, 'the act row is row 2 of 5');
  assert.equal((acting.match(/class="[^"]*acting/g) || []).length, 1, 'nobody else in the square moves');
});

test('every ending opens on its own scene', () => {
  const withWinner = (team, players) => ({...fakeView({players}), phase: 'game-over', winner: {team, title: 'x', text: 'y'}});
  const mk = (id, alive, role) => [id, {id, name: id, alive, connected: true, storyteller: false, sheriff: false, role}];

  // The pack howls: survivors are drawn from the act row, not standing idle.
  const wolves = victoryCinematic(withWinner('wolves', Object.fromEntries([
    mk('ada', true, 'werewolf'), mk('ben', true, 'werewolf'), mk('cleo', false, 'seer')])));
  assert.match(wolves, /finale-scene wolves-win/);
  assert.match(wolves, /finale-moon blood/);
  assert.equal((wolves.match(/sheets\/werewolf\.webp/g) || []).length, 2, 'both surviving wolves stand');
  assert.match(wolves, /background-position:0% 50%/, 'the act row is row 2 of 5');

  // The village wins with the last wolf down beside it.
  const village = victoryCinematic(withWinner('village', Object.fromEntries([
    mk('ada', true, 'seer'), mk('ben', false, 'werewolf')])));
  assert.match(village, /finale-scene village-win/);
  assert.match(village, /sheets\/seer\.webp/);
  assert.match(village, /finale-fallen[\s\S]*sheets\/werewolf\.webp/);
  const chorusBlock = village.slice(village.indexOf('finale-cast'), village.indexOf('finale-fallen'));
  assert.doesNotMatch(chorusBlock, /sheets\/werewolf\.webp/, 'the dead wolf lies apart, it does not join the village chorus');

  // The lovers stand in the chained bound pose (row 3), not the act row.
  const lovers = victoryCinematic(withWinner('lovers', Object.fromEntries([
    mk('ada', true, 'cupid'), mk('ben', true, 'hunter'), mk('cleo', false, 'werewolf')])));
  assert.match(lovers, /finale-scene lovers-win/);
  assert.match(lovers, /background-position:0% 75%/, 'bound is row 4 of 5');
  assert.match(lovers, /finale-thread/);

  // Nobody survived: an empty square, and no cast at all.
  const none = victoryCinematic(withWinner('none', Object.fromEntries([mk('ada', false, 'villager')])));
  assert.match(none, /finale-scene none-win/);
  assert.doesNotMatch(none, /sheets\//, 'there is nobody left to draw');
});

test('a wiped-out winning team still has something on screen', () => {
  // Lovers can win with the pack dead and the village dead; wolves can win a
  // parity ending where the survivors list is oddly shaped. The scene must
  // never render an empty cast block.
  const view = {...fakeView({players: {}}), phase: 'game-over', winner: {team: 'wolves', title: 'x', text: 'y'}};
  const scene = victoryCinematic(view);
  assert.match(scene, /sheets\/werewolf\.webp/, 'a fallback wolf stands in for an empty pack');
});
