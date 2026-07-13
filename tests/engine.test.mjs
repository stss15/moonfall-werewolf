import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlayerCommand,
  beginResolution,
  buildDeck,
  checkWinner,
  closeDayVote,
  makeState,
  narratorUnlock,
  resolvePending,
  startGame,
  storytellerAdvance,
  viewFor,
  wolvesHaveConsensus
} from '../src/engine.js';

function fixture(names = ['Story', 'Wolf', 'Ada', 'Ben', 'Cleo', 'Drew']) {
  const state = makeState({roomCode: 'TEST42', coordinatorId: 'story', coordinatorName: names[0]});
  state.players.story.seatKey = 'secret';
  for (let i = 1; i < names.length; i += 1) {
    const id = names[i].toLowerCase();
    state.players[id] = {id, name: names[i], seatKey: `key-${id}`, connected: true, alive: true, role: 'villager', ready: false, joinedAt: i};
  }
  state.storytellerId = 'story';
  state.players.story.role = 'storyteller';
  return state;
}

test('official learning deck uses the published 8-player mix', () => {
  const deck = buildDeck(8, {wolves: 'auto', roles: ['seer']}, () => 0.42);
  assert.equal(deck.wolfCount, 2);
  assert.equal(deck.composition.filter(role => role === 'werewolf').length, 2);
  assert.equal(deck.composition.filter(role => role === 'seer').length, 1);
  assert.equal(deck.composition.filter(role => role === 'villager').length, 5);
  assert.equal(deck.extras.length, 0);
});

test('Thief adds two physical spare cards before the deal', () => {
  const deck = buildDeck(10, {wolves: 2, roles: ['seer', 'witch', 'thief']}, () => 0.25);
  assert.equal(deck.dealt.length, 10);
  assert.equal(deck.extras.length, 2);
  assert.equal(deck.composition.length, 10);
  assert.equal(deck.dealt.length + deck.extras.length, 12);
});

test('game start removes absent lobby seats and gives every gathered player a character card', () => {
  const state = fixture(['Host', 'A', 'B', 'C', 'D', 'E', 'Absent']);
  state.players.absent.connected = false;
  state.settings.roles = ['seer'];
  const result = startGame(state, () => 0);
  assert.equal(result.ok, true);
  assert.equal(state.storytellerId, null);
  assert.equal(state.players.absent, undefined);
  assert.equal(state.phase, 'role-reveal');
  assert.equal(state.phaseReady, false);
  assert.equal(Object.values(state.players).filter(player => player.role === 'storyteller').length, 0);
  assert.equal(Object.values(state.players).every(player => player.role), true);
});

test('ordinary and coordinator views never leak living roles', () => {
  const state = fixture();
  state.storytellerId = null;
  state.players.story.role = 'villager';
  state.players.wolf.role = 'werewolf';
  state.phase = 'night-wolves';
  const ordinary = viewFor(state, 'ada');
  const coordinator = viewFor(state, 'story', {coordinator: true});
  assert.equal(ordinary.players.wolf.role, null);
  assert.equal(ordinary.storyteller, null);
  assert.ok(coordinator.narrator);
  assert.equal('roles' in coordinator.narrator, false);
  assert.equal(coordinator.players.wolf.role, null);
});

test('lovers can never vote against one another', () => {
  const state = fixture();
  state.players.wolf.role = 'werewolf';
  state.lovers = ['ada', 'ben'];
  state.phase = 'day-vote';
  const result = applyPlayerCommand(state, 'ada', 'cast-vote', {target: 'ben'});
  assert.equal(result.ok, false);
  assert.match(result.error, /Lovers/);
});

test('Sheriff vote is counted twice and determines the elimination', () => {
  const state = fixture(['Story', 'Wolf', 'Ada', 'Ben', 'Cleo', 'Drew', 'Eli']);
  state.players.wolf.role = 'werewolf';
  state.sheriffId = 'ada';
  state.phase = 'day-vote';
  applyPlayerCommand(state, 'ada', 'cast-vote', {target: 'ben'});
  applyPlayerCommand(state, 'ben', 'cast-vote', {target: 'cleo'});
  applyPlayerCommand(state, 'cleo', 'cast-vote', {target: 'ben'});
  const result = closeDayVote(state);
  assert.equal(result.ok, true);
  assert.equal(state.lastVote.tally.ben, 3);
  assert.equal(state.lastVote.tally.cleo, 1);
  assert.equal(state.players.ben.alive, false);
});

test('Witch may heal and poison in the same night; each potion is then spent', () => {
  const state = fixture(['Story', 'Wolf', 'Witch', 'Victim', 'Poisoned', 'Other', 'Spare']);
  state.players.wolf.role = 'werewolf';
  state.players.witch.role = 'witch';
  state.phase = 'night-witch';
  state.actions.wolfVictim = 'victim';
  const choice = applyPlayerCommand(state, 'witch', 'witch-submit', {heal: true, poisonTarget: 'poisoned'});
  assert.equal(choice.ok, true);
  assert.equal(storytellerAdvance(state).ok, true);
  assert.equal(state.players.victim.alive, true);
  assert.equal(state.players.poisoned.alive, false);
  assert.deepEqual(state.potions, {heal: false, poison: false});
});

test('lover grief and Hunter final shot form a complete death chain', () => {
  const state = fixture(['Story', 'Wolf', 'Ada', 'Hunter', 'Cleo', 'Drew', 'Eli', 'Finn']);
  state.players.wolf.role = 'werewolf';
  state.players.hunter.role = 'hunter';
  state.lovers = ['ada', 'hunter'];
  beginResolution(state, [{id: 'ada', cause: 'the village vote'}], 'day');
  assert.equal(state.players.ada.alive, false);
  assert.equal(state.players.hunter.alive, false);
  assert.equal(state.resolution.pending.type, 'hunter');
  const shot = resolvePending(state, 'hunter', 'cleo');
  assert.equal(shot.ok, true);
  assert.equal(state.players.cleo.alive, false);
  assert.equal(state.phase, 'day-result');
  assert.deepEqual(state.lastDeaths.map(death => death.id), ['ada', 'hunter', 'cleo']);
});

test('a mixed living couple wins only when every other character is dead', () => {
  const state = fixture();
  state.players.wolf.role = 'werewolf';
  state.lovers = ['wolf', 'ada'];
  for (const id of ['ben', 'cleo', 'drew']) state.players[id].alive = false;
  const winner = checkWinner(state);
  assert.equal(winner.team, 'lovers');
});

test('full-game roles are revealed to everyone only after victory', () => {
  const state = fixture();
  state.players.wolf.role = 'werewolf';
  state.phase = 'game-over';
  state.winner = {team: 'village', title: 'Village', text: 'Done'};
  const view = viewFor(state, 'ada');
  assert.equal(view.players.wolf.role, 'werewolf');
  assert.equal(view.players.ben.role, 'villager');
});

test('a private turn stays locked until the automatic narrator finishes its cue', () => {
  const state = fixture();
  state.players.wolf.role = 'werewolf';
  state.phase = 'night-wolves';
  state.phaseReady = false;
  const early = applyPlayerCommand(state, 'wolf', 'wolf-vote', {target: 'ada'});
  assert.equal(early.ok, false);
  assert.match(early.error, /narrator/i);
  assert.equal(narratorUnlock(state).ok, true);
  assert.equal(applyPlayerCommand(state, 'wolf', 'wolf-vote', {target: 'ada'}).ok, true);
});

test('Werewolves may unanimously choose no victim, but split choices do not advance', () => {
  const state = fixture();
  state.players.wolf.role = 'werewolf';
  state.players.ada.role = 'werewolf';
  state.phase = 'night-wolves';
  state.phaseReady = true;
  applyPlayerCommand(state, 'wolf', 'wolf-vote', {target: null});
  applyPlayerCommand(state, 'ada', 'wolf-vote', {target: 'ben'});
  assert.equal(wolvesHaveConsensus(state), false);
  applyPlayerCommand(state, 'ada', 'wolf-vote', {target: null});
  assert.equal(wolvesHaveConsensus(state), true);
  assert.equal(storytellerAdvance(state).ok, true);
  assert.equal(state.actions.wolfVictim, null);
});

test('day debate and ballots advance only after every living player acts', () => {
  const state = fixture();
  state.players.wolf.role = 'werewolf';
  state.phase = 'day-discussion';
  state.phaseReady = true;
  const living = ['wolf', 'ada', 'ben', 'cleo', 'drew'];
  for (const id of living.slice(0, -1)) applyPlayerCommand(state, id, 'day-ready', {ready: true});
  assert.equal(state.phase, 'day-discussion');
  applyPlayerCommand(state, living.at(-1), 'day-ready', {ready: true});
  assert.equal(state.phase, 'day-vote');
  assert.equal(state.phaseReady, false);
  narratorUnlock(state);
  for (const id of living.slice(0, -1)) applyPlayerCommand(state, id, 'cast-vote', {target: 'ben'});
  assert.equal(state.phase, 'day-vote');
  applyPlayerCommand(state, living.at(-1), 'cast-vote', {target: 'ben'});
  assert.notEqual(state.phase, 'day-vote');
  assert.equal(state.players.ben.alive, false);
});

test('complete first night follows Thief → Cupid → lovers → Seer → Wolves → Witch → dawn', () => {
  const state = fixture(['Story', 'Thief', 'Cupid', 'Seer', 'Wolf', 'Witch', 'Girl', 'Villager']);
  Object.assign(state.players.thief, {role: 'thief'});
  Object.assign(state.players.cupid, {role: 'cupid'});
  Object.assign(state.players.seer, {role: 'seer'});
  Object.assign(state.players.wolf, {role: 'werewolf'});
  Object.assign(state.players.witch, {role: 'witch'});
  Object.assign(state.players.girl, {role: 'little-girl'});
  Object.assign(state.players.villager, {role: 'villager'});
  state.phase = 'role-reveal';
  state.night = 1;
  state.extraCards = ['villager', 'werewolf'];

  for (const id of Object.keys(state.players)) assert.equal(applyPlayerCommand(state, id, 'seen-role').ok, true);
  assert.equal(storytellerAdvance(state).ok, true);
  assert.equal(state.phase, 'setup-thief');
  narratorUnlock(state);
  applyPlayerCommand(state, 'thief', 'thief-choice', {choice: 'keep'});
  storytellerAdvance(state);
  assert.equal(state.phase, 'setup-cupid');
  narratorUnlock(state);
  applyPlayerCommand(state, 'cupid', 'cupid-choose', {choices: ['cupid', 'wolf']});
  storytellerAdvance(state);
  assert.equal(state.phase, 'setup-lovers');
  narratorUnlock(state);
  applyPlayerCommand(state, 'cupid', 'lovers-seen');
  applyPlayerCommand(state, 'wolf', 'lovers-seen');
  storytellerAdvance(state);
  assert.equal(state.phase, 'night-seer');
  narratorUnlock(state);
  applyPlayerCommand(state, 'seer', 'seer-choose', {target: 'wolf'});
  applyPlayerCommand(state, 'seer', 'seer-done');
  storytellerAdvance(state);
  assert.equal(state.phase, 'night-wolves');
  narratorUnlock(state);
  applyPlayerCommand(state, 'wolf', 'wolf-vote', {target: 'villager'});
  storytellerAdvance(state);
  assert.equal(state.phase, 'night-witch');
  narratorUnlock(state);
  applyPlayerCommand(state, 'witch', 'witch-submit', {heal: false, poisonTarget: null});
  storytellerAdvance(state);
  assert.equal(state.phase, 'dawn');
  assert.equal(state.players.villager.alive, false);
  assert.equal(state.lastDeaths[0].cause, 'the Werewolves');
});
