import {PRESETS, ROLES, SPECIAL_ROLE_IDS, STORY_CUES} from './roles.js';

const clone = value => JSON.parse(JSON.stringify(value));
const unique = values => [...new Set(values)];
const randomIndex = (length, rng = Math.random) => Math.floor(rng() * length);

export function shuffle(values, rng = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIndex(index + 1, rng);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function suggestedWolfCount(characterCount) {
  if (characterCount >= 18) return 4;
  if (characterCount >= 12) return 3;
  if (characterCount >= 8) return 2;
  if (characterCount >= 6) return 2;
  return 1;
}

export function makeState({roomCode, coordinatorId, coordinatorName = 'Host'}) {
  const now = Date.now();
  return {
    schema: 3,
    roomCode,
    coordinatorId,
    storytellerId: null,
    phase: 'lobby',
    phaseReady: true,
    phaseSerial: 0,
    revision: 0,
    night: 0,
    day: 0,
    createdAt: now,
    updatedAt: now,
    settings: {
      preset: 'classic',
      roles: [...PRESETS.classic.roles],
      sheriff: PRESETS.classic.sheriff,
      wolves: 'auto',
      revealRoles: true
    },
    players: {
      [coordinatorId]: {
        id: coordinatorId,
        name: coordinatorName,
        connected: true,
        peerId: null,
        joinedAt: now,
        alive: true,
        role: null,
        ready: false
      }
    },
    extraCards: [],
    lovers: [],
    sheriffId: null,
    potions: {heal: true, poison: true},
    actions: freshActions(),
    electionCandidates: [],
    resolution: null,
    lastDeaths: [],
    lastVote: null,
    winner: null,
    log: [{kind: 'moon', text: 'A new village gathered beneath the moon.', at: now}]
  };
}

export function freshActions() {
  return {
    seen: {},
    thiefDone: false,
    thiefChoice: null,
    cupidChoices: [],
    cupidDone: false,
    loversSeen: {},
    seerTarget: null,
    seerRevealed: false,
    seerDone: false,
    wolfVotes: {},
    wolfVictim: null,
    littleGirlCaught: false,
    witchDraft: {heal: false, poisonTarget: null},
    witchDone: false,
    votes: {},
    dayReady: {}
  };
}

export const allSeatIds = state => Object.keys(state.players);
export const characterIds = state => allSeatIds(state).filter(id => id !== state.storytellerId);
export const aliveIds = state => characterIds(state).filter(id => state.players[id]?.alive);
export const roleIds = (state, roleId, aliveOnly = true) => characterIds(state).filter(id => {
  const player = state.players[id];
  return player?.role === roleId && (!aliveOnly || player.alive);
});
export const playerByRole = (state, roleId, aliveOnly = true) => roleIds(state, roleId, aliveOnly)[0] || null;
export const isStoryteller = (state, seatId) => state.storytellerId === seatId;
export const isCoordinator = (state, seatId) => state.coordinatorId === seatId;

function touch(state) {
  state.revision += 1;
  state.updatedAt = Date.now();
}

function log(state, text, kind = 'event') {
  state.log.push({text, kind, at: Date.now(), day: state.day, night: state.night});
  state.log = state.log.slice(-80);
}

function enterPhase(state, phase, {ready = false} = {}) {
  state.phase = phase;
  state.phaseReady = ready;
  state.phaseSerial = Number(state.phaseSerial || 0) + 1;
}

export function narratorUnlock(state) {
  if (['lobby', 'game-over'].includes(state.phase)) return {ok: false, error: 'There is no turn to open.'};
  if (state.phaseReady) return {ok: true};
  state.phaseReady = true;
  touch(state);
  return {ok: true};
}

export function setPreset(state, presetId) {
  if (state.phase !== 'lobby' || !PRESETS[presetId]) return false;
  state.settings.preset = presetId;
  state.settings.roles = [...PRESETS[presetId].roles];
  state.settings.sheriff = PRESETS[presetId].sheriff;
  touch(state);
  return true;
}

export function updateSettings(state, patch) {
  if (state.phase !== 'lobby') return {ok: false, error: 'The deck is already sealed.'};
  if (patch.roles) {
    state.settings.roles = unique(patch.roles).filter(id => SPECIAL_ROLE_IDS.includes(id));
    state.settings.preset = 'custom';
  }
  if (typeof patch.sheriff === 'boolean') state.settings.sheriff = patch.sheriff;
  if (patch.wolves === 'auto' || Number.isInteger(Number(patch.wolves))) state.settings.wolves = patch.wolves;
  if (typeof patch.revealRoles === 'boolean') state.settings.revealRoles = patch.revealRoles;
  touch(state);
  return {ok: true};
}

export function buildDeck(characterCount, settings, rng = Math.random) {
  const wolfCount = settings.wolves === 'auto'
    ? suggestedWolfCount(characterCount)
    : Math.max(1, Math.min(4, Number(settings.wolves)));
  const specials = unique(settings.roles || []).filter(id => SPECIAL_ROLE_IDS.includes(id));
  if (wolfCount + specials.length > characterCount) {
    throw new Error(`This village has room for ${characterCount} character cards, but ${wolfCount + specials.length} special and Werewolf cards are selected.`);
  }
  const base = [
    ...Array(wolfCount).fill('werewolf'),
    ...specials,
    ...Array(characterCount - wolfCount - specials.length).fill('villager')
  ];
  // Official Thief setup: add two Simple Villagers before shuffling, then leave
  // two cards in the centre. Any character, including the Thief, may be spare.
  const physicalDeck = specials.includes('thief') ? [...base, 'villager', 'villager'] : base;
  const shuffled = shuffle(physicalDeck, rng);
  return {
    dealt: shuffled.slice(0, characterCount),
    extras: shuffled.slice(characterCount),
    wolfCount,
    composition: base
  };
}

export function startGame(state, rng = Math.random) {
  if (state.phase !== 'lobby') return {ok: false, error: 'This game has already begun.'};
  const connected = allSeatIds(state).filter(id => state.players[id].connected !== false);
  if (connected.length < 6) {
    return {ok: false, error: 'Moonfall needs at least six players. Eight or more gives the classic balance.'};
  }
  for (const id of allSeatIds(state)) {
    if (!connected.includes(id)) delete state.players[id];
  }
  // The narrator is automated on the coordinator phone. Nobody loses their
  // character card or has to operate a separate Storyteller seat.
  state.storytellerId = null;
  const characters = connected;
  let deck;
  try {
    deck = buildDeck(characters.length, state.settings, rng);
  } catch (error) {
    state.storytellerId = null;
    return {ok: false, error: error.message};
  }
  const seats = shuffle(characters, rng);
  seats.forEach((id, index) => {
    Object.assign(state.players[id], {role: deck.dealt[index], alive: true, ready: false});
  });
  state.extraCards = deck.extras;
  state.night = 1;
  state.day = 0;
  enterPhase(state, 'role-reveal');
  state.actions = freshActions();
  state.lovers = [];
  state.sheriffId = null;
  state.potions = {heal: true, poison: true};
  state.resolution = null;
  state.lastDeaths = [];
  state.lastVote = null;
  state.winner = null;
  log(state, 'The Moonfall narrator took its place. Every gathered player received a character card.', 'story');
  touch(state);
  return {ok: true};
}

function phaseHasLivingRole(state, roleId) {
  return roleIds(state, roleId, true).length > 0;
}

function nextSetupOrNight(state, current) {
  const order = ['setup-thief', 'setup-cupid', 'setup-lovers', 'night-seer', 'night-wolves', 'night-witch'];
  let index = current === 'role-reveal' ? -1 : order.indexOf(current);
  for (index += 1; index < order.length; index += 1) {
    const phase = order[index];
    if (phase === 'setup-thief' && (!phaseHasLivingRole(state, 'thief') || !state.extraCards.length)) continue;
    if (phase === 'setup-cupid' && !phaseHasLivingRole(state, 'cupid')) continue;
    if (phase === 'setup-lovers' && state.lovers.length !== 2) continue;
    if (phase === 'night-seer' && !phaseHasLivingRole(state, 'seer')) continue;
    if (phase === 'night-witch' && !phaseHasLivingRole(state, 'witch')) continue;
    return phase;
  }
  return 'resolve-night';
}

function resetNightActions(state) {
  state.actions.seerTarget = null;
  state.actions.seerRevealed = false;
  state.actions.seerDone = false;
  state.actions.wolfVotes = {};
  state.actions.wolfVictim = null;
  state.actions.littleGirlCaught = false;
  state.actions.witchDraft = {heal: false, poisonTarget: null};
  state.actions.witchDone = false;
}

function beginNight(state) {
  state.night += 1;
  resetNightActions(state);
  enterPhase(state, phaseHasLivingRole(state, 'seer') ? 'night-seer' : 'night-wolves');
  log(state, `Night ${state.night} fell over the village.`, 'moon');
  touch(state);
}

function canAdvance(state) {
  switch (state.phase) {
    case 'role-reveal': return allSeatIds(state).every(id => state.actions.seen[id]);
    case 'setup-thief': return state.actions.thiefDone;
    case 'setup-cupid': return state.actions.cupidDone;
    case 'setup-lovers': return state.lovers.every(id => state.actions.loversSeen[id]);
    case 'night-seer': return state.actions.seerDone || !phaseHasLivingRole(state, 'seer');
    case 'night-wolves': return wolvesHaveConsensus(state);
    case 'night-witch': return state.actions.witchDone || !phaseHasLivingRole(state, 'witch');
    default: return false;
  }
}

export function wolvesHaveConsensus(state) {
  const wolves = roleIds(state, 'werewolf', true);
  if (!wolves.length) return false;
  const choices = wolves.map(id => state.actions.wolfVotes[id]);
  return choices.every(choice => choice !== undefined) && new Set(choices).size === 1;
}

export function storytellerAdvance(state) {
  if (!canAdvance(state)) return {ok: false, error: 'The active player has not finished yet.'};
  const current = state.phase;
  if (current === 'role-reveal') {
    enterPhase(state, nextSetupOrNight(state, current));
  } else if (['setup-thief', 'setup-cupid', 'setup-lovers'].includes(current)) {
    enterPhase(state, nextSetupOrNight(state, current));
  } else if (current === 'night-seer') {
    enterPhase(state, 'night-wolves');
  } else if (current === 'night-wolves') {
    const votes = Object.values(state.actions.wolfVotes);
    state.actions.wolfVictim = votes[0] ?? null;
    enterPhase(state, phaseHasLivingRole(state, 'witch') ? 'night-witch' : 'resolve-night');
  } else if (current === 'night-witch') {
    enterPhase(state, 'resolve-night');
  }
  if (state.phase === 'resolve-night') resolveNight(state);
  touch(state);
  return {ok: true};
}

export function storytellerForceNoKill(state) {
  if (state.phase !== 'night-wolves') return {ok: false, error: 'The pack is not awake.'};
  state.actions.wolfVictim = null;
  enterPhase(state, phaseHasLivingRole(state, 'witch') ? 'night-witch' : 'resolve-night');
  log(state, 'The pack failed to agree. No victim was chosen.', 'night');
  if (state.phase === 'resolve-night') resolveNight(state);
  touch(state);
  return {ok: true};
}

function resolveNight(state) {
  let victim = state.actions.wolfVictim;
  if (state.actions.littleGirlCaught) victim = playerByRole(state, 'little-girl', true);
  const deaths = [];
  if (victim && !state.actions.witchDraft.heal) deaths.push({id: victim, cause: state.actions.littleGirlCaught ? 'caught peeking' : 'the Werewolves'});
  if (state.actions.witchDraft.poisonTarget) deaths.push({id: state.actions.witchDraft.poisonTarget, cause: 'the Witch’s poison'});
  if (state.actions.witchDraft.heal) state.potions.heal = false;
  if (state.actions.witchDraft.poisonTarget) state.potions.poison = false;
  beginResolution(state, deaths, 'night');
}

function markDead(state, item) {
  const player = state.players[item.id];
  if (!player?.alive || item.id === state.storytellerId) return;
  player.alive = false;
  const death = {
    id: item.id,
    name: player.name,
    role: player.role,
    cause: item.cause,
    day: state.day,
    night: state.night
  };
  state.resolution.resolved.push(death);
  log(state, `${player.name} was claimed by ${item.cause}.`, 'death');
  const triggers = [];
  if (player.role === 'hunter' && aliveIds(state).length) triggers.push({type: 'hunter', actorId: item.id});
  if (state.sheriffId === item.id && aliveIds(state).length) triggers.push({type: 'sheriff-successor', actorId: item.id});
  const lover = state.lovers.includes(item.id) ? state.lovers.find(id => id !== item.id) : null;
  if (lover && state.players[lover]?.alive) {
    state.resolution.queue.push({id: lover, cause: 'a broken heart'});
  }
  state.resolution.triggers.push(...triggers);
}

export function beginResolution(state, deaths, source) {
  enterPhase(state, 'resolution');
  state.resolution = {
    source,
    queue: unique(deaths.map(item => item.id)).map(id => deaths.find(item => item.id === id)),
    triggers: [],
    pending: null,
    resolved: []
  };
  continueResolution(state);
}

export function continueResolution(state) {
  if (!state.resolution || state.resolution.pending) return;
  while (state.resolution.queue.length) {
    markDead(state, state.resolution.queue.shift());
    if (state.resolution.triggers.length) break;
  }
  if (state.resolution.triggers.length) {
    state.resolution.pending = state.resolution.triggers.shift();
    enterPhase(state, 'resolution');
    touch(state);
    return;
  }
  if (state.resolution.queue.length) {
    continueResolution(state);
    return;
  }
  const source = state.resolution.source;
  state.lastDeaths = state.resolution.resolved;
  state.resolution = null;
  const winner = checkWinner(state);
  if (winner) {
    finishGame(state, winner);
    return;
  }
  if (source === 'night') {
    state.day += 1;
    enterPhase(state, 'dawn');
  } else {
    enterPhase(state, 'day-result');
  }
  touch(state);
}

export function resolvePending(state, actorId, targetId = null, storytellerProxy = false) {
  const pending = state.resolution?.pending;
  if (!pending) return {ok: false, error: 'No final action is waiting.'};
  if (!storytellerProxy && pending.actorId !== actorId) return {ok: false, error: 'This final choice belongs to another player.'};
  if (targetId && (!state.players[targetId]?.alive || targetId === state.storytellerId)) {
    return {ok: false, error: 'Choose a living character.'};
  }
  if (pending.type === 'hunter') {
    if (targetId) state.resolution.queue.push({id: targetId, cause: `${state.players[pending.actorId].name}’s final shot`});
    log(state, targetId ? `${state.players[pending.actorId].name} fired one final shot.` : `${state.players[pending.actorId].name} lowered the final shot.`, 'death');
  } else if (pending.type === 'sheriff-successor') {
    state.sheriffId = targetId || null;
    if (targetId) log(state, `${state.players[targetId].name} inherited the Sheriff’s badge.`, 'sheriff');
  }
  state.resolution.pending = null;
  continueResolution(state);
  touch(state);
  return {ok: true};
}

export function advanceFromDawn(state) {
  if (state.phase !== 'dawn') return {ok: false, error: 'The village has not reached dawn.'};
  if (state.settings.sheriff && !state.sheriffId && state.day === 1) {
    enterPhase(state, 'sheriff-vote');
    state.electionCandidates = aliveIds(state);
    state.actions.votes = {};
  } else {
    enterPhase(state, 'day-discussion');
    state.actions.dayReady = {};
  }
  touch(state);
  return {ok: true};
}

export function startDayVote(state) {
  if (state.phase !== 'day-discussion') return {ok: false, error: 'The village is not ready to vote.'};
  enterPhase(state, 'day-vote');
  state.actions.votes = {};
  state.lastVote = null;
  touch(state);
  return {ok: true};
}

export function castVote(state, actorId, targetId) {
  if (!['day-vote', 'sheriff-vote'].includes(state.phase)) return {ok: false, error: 'No vote is open.'};
  if (!state.players[actorId]?.alive || actorId === state.storytellerId) return {ok: false, error: 'Only living characters may vote.'};
  if (!state.players[targetId]?.alive || targetId === state.storytellerId) return {ok: false, error: 'That player cannot receive this vote.'};
  if (state.phase === 'day-vote' && state.lovers.includes(actorId) && state.lovers.includes(targetId)) {
    return {ok: false, error: 'Lovers may never vote against one another.'};
  }
  if (state.phase === 'sheriff-vote' && state.electionCandidates.length && !state.electionCandidates.includes(targetId)) {
    return {ok: false, error: 'That player is not in this ballot.'};
  }
  state.actions.votes[actorId] = targetId;
  const allCast = aliveIds(state).every(id => state.actions.votes[id] !== undefined);
  if (allCast) return state.phase === 'sheriff-vote' ? closeElection(state) : closeDayVote(state);
  touch(state);
  return {ok: true};
}

function tallyVotes(state, sheriffWeighted) {
  const tally = {};
  for (const [voterId, targetId] of Object.entries(state.actions.votes)) {
    if (!state.players[voterId]?.alive || !state.players[targetId]?.alive) continue;
    const weight = sheriffWeighted && voterId === state.sheriffId ? 2 : 1;
    tally[targetId] = (tally[targetId] || 0) + weight;
  }
  return tally;
}

export function closeElection(state) {
  if (state.phase !== 'sheriff-vote') return {ok: false, error: 'The Sheriff ballot is not open.'};
  const tally = tallyVotes(state, false);
  const max = Math.max(0, ...Object.values(tally));
  if (!max) return {ok: false, error: 'At least one vote must be cast.'};
  const leaders = Object.keys(tally).filter(id => tally[id] === max);
  if (leaders.length > 1) {
    state.electionCandidates = leaders;
    state.actions.votes = {};
    enterPhase(state, 'sheriff-vote');
    log(state, `The Sheriff election was tied. ${leaders.map(id => state.players[id].name).join(' and ')} face a new ballot.`, 'sheriff');
    touch(state);
    return {ok: true, runoff: true};
  }
  state.sheriffId = leaders[0];
  state.electionCandidates = [];
  state.actions.votes = {};
  state.actions.dayReady = {};
  enterPhase(state, 'day-discussion');
  log(state, `${state.players[state.sheriffId].name} was elected Sheriff.`, 'sheriff');
  touch(state);
  return {ok: true, elected: leaders[0]};
}

export function closeDayVote(state) {
  if (state.phase !== 'day-vote') return {ok: false, error: 'The village vote is not open.'};
  const tally = tallyVotes(state, true);
  const max = Math.max(0, ...Object.values(tally));
  const leaders = max ? Object.keys(tally).filter(id => tally[id] === max) : [];
  state.lastVote = {tally, leaders, max, eliminated: leaders.length === 1 ? leaders[0] : null};
  state.actions.votes = {};
  if (leaders.length === 1) {
    beginResolution(state, [{id: leaders[0], cause: 'the village vote'}], 'day');
  } else {
    state.lastDeaths = [];
    enterPhase(state, 'day-result');
    log(state, leaders.length ? 'The village vote ended in a tie. Nobody was eliminated.' : 'No judgement was cast. Nobody was eliminated.', 'vote');
    touch(state);
  }
  return {ok: true};
}

export function nextNight(state) {
  if (state.phase !== 'day-result') return {ok: false, error: 'Daylight has not ended.'};
  beginNight(state);
  return {ok: true};
}

export function checkWinner(state) {
  const alive = aliveIds(state);
  const aliveWolves = alive.filter(id => state.players[id].role === 'werewolf');
  const aliveVillage = alive.filter(id => state.players[id].role !== 'werewolf');
  if (state.lovers.length === 2) {
    const [a, b] = state.lovers;
    const mixed = (state.players[a]?.role === 'werewolf') !== (state.players[b]?.role === 'werewolf');
    if (mixed && state.players[a]?.alive && state.players[b]?.alive && alive.length === 2) {
      return {team: 'lovers', title: 'Love Conquers the Moon', text: `${state.players[a].name} and ${state.players[b].name} are the last souls alive.`};
    }
  }
  if (!alive.length) return {team: 'none', title: 'The Village Falls Silent', text: 'No soul survived the final chain of fate.'};
  if (!aliveWolves.length && aliveVillage.length) return {team: 'village', title: 'The Village Prevails', text: 'The last Werewolf has fallen.'};
  if (!aliveVillage.length && aliveWolves.length) return {team: 'wolves', title: 'The Pack Devours the Dawn', text: 'No Villager remains alive.'};
  return null;
}

function finishGame(state, winner) {
  state.winner = winner;
  enterPhase(state, 'game-over', {ready: true});
  log(state, winner.title, 'victory');
  touch(state);
}

export function resetToLobby(state) {
  enterPhase(state, 'lobby', {ready: true});
  state.schema = 3;
  state.storytellerId = null;
  state.night = 0;
  state.day = 0;
  state.extraCards = [];
  state.lovers = [];
  state.sheriffId = null;
  state.potions = {heal: true, poison: true};
  state.actions = freshActions();
  state.resolution = null;
  state.lastDeaths = [];
  state.lastVote = null;
  state.winner = null;
  for (const player of Object.values(state.players)) Object.assign(player, {role: null, alive: true, ready: false});
  log(state, 'The cards returned to the deck. A new tale may begin.', 'moon');
  touch(state);
}

function commandRoleGuard(state, actorId, roleId, phase) {
  if (state.phase !== phase) return `${ROLES[roleId].name} is not awake.`;
  if (state.players[actorId]?.role !== roleId || !state.players[actorId]?.alive) return `This action belongs to ${ROLES[roleId].name}.`;
  return null;
}

export function applyPlayerCommand(state, actorId, type, payload = {}) {
  if (!state.phaseReady) return {ok: false, error: 'Listen to the narrator. This turn has not opened yet.'};
  let error;
  if (type === 'seen-role') {
    if (state.phase !== 'role-reveal') return {ok: false, error: 'The card reveal has ended.'};
    state.actions.seen[actorId] = true;
    state.players[actorId].ready = true;
  } else if (type === 'thief-choice') {
    error = commandRoleGuard(state, actorId, 'thief', 'setup-thief');
    if (error) return {ok: false, error};
    const choice = payload.choice;
    const forced = state.extraCards.length === 2 && state.extraCards.every(role => role === 'werewolf');
    if (choice === 'keep' && forced) return {ok: false, error: 'Both spare cards are Werewolves. The Thief must take one.'};
    if (choice !== 'keep' && ![0, 1].includes(Number(choice))) return {ok: false, error: 'Choose one of the two spare cards.'};
    if (choice !== 'keep') {
      const index = Number(choice);
      const old = state.players[actorId].role;
      state.players[actorId].role = state.extraCards[index];
      state.extraCards[index] = old;
    }
    state.actions.thiefChoice = choice;
    state.actions.thiefDone = true;
  } else if (type === 'cupid-choose') {
    error = commandRoleGuard(state, actorId, 'cupid', 'setup-cupid');
    if (error) return {ok: false, error};
    const choices = unique(payload.choices || []);
    if (choices.length !== 2 || choices.some(id => !state.players[id] || id === state.storytellerId)) {
      return {ok: false, error: 'Cupid must choose exactly two characters.'};
    }
    state.lovers = choices;
    state.actions.cupidChoices = choices;
    state.actions.cupidDone = true;
  } else if (type === 'lovers-seen') {
    if (state.phase !== 'setup-lovers' || !state.lovers.includes(actorId)) return {ok: false, error: 'This secret belongs to the lovers.'};
    state.actions.loversSeen[actorId] = true;
  } else if (type === 'seer-choose') {
    error = commandRoleGuard(state, actorId, 'seer', 'night-seer');
    if (error) return {ok: false, error};
    const target = payload.target;
    if (!state.players[target]?.alive || target === actorId || target === state.storytellerId) return {ok: false, error: 'Choose another living character.'};
    state.actions.seerTarget = target;
    state.actions.seerRevealed = true;
  } else if (type === 'seer-done') {
    error = commandRoleGuard(state, actorId, 'seer', 'night-seer');
    if (error) return {ok: false, error};
    if (!state.actions.seerTarget) return {ok: false, error: 'Reveal one identity first.'};
    state.actions.seerDone = true;
  } else if (type === 'wolf-vote') {
    error = commandRoleGuard(state, actorId, 'werewolf', 'night-wolves');
    if (error) return {ok: false, error};
    const target = payload.target;
    if (target !== null && (!state.players[target]?.alive || state.players[target].role === 'werewolf' || target === state.storytellerId)) return {ok: false, error: 'The pack must choose a living non-Werewolf or unanimously spare the village.'};
    state.actions.wolfVotes[actorId] = target;
  } else if (type === 'little-girl-caught') {
    error = commandRoleGuard(state, actorId, 'werewolf', 'night-wolves');
    if (error) return {ok: false, error};
    if (!phaseHasLivingRole(state, 'little-girl')) return {ok: false, error: 'The Little Girl is not in the village.'};
    state.actions.littleGirlCaught = true;
  } else if (type === 'witch-submit') {
    error = commandRoleGuard(state, actorId, 'witch', 'night-witch');
    if (error) return {ok: false, error};
    const heal = Boolean(payload.heal);
    const poisonTarget = payload.poisonTarget || null;
    if (heal && !state.potions.heal) return {ok: false, error: 'The healing potion has already been used.'};
    if (heal && !state.actions.wolfVictim && !state.actions.littleGirlCaught) return {ok: false, error: 'There is no victim to heal tonight.'};
    if (poisonTarget && !state.potions.poison) return {ok: false, error: 'The poison has already been used.'};
    if (poisonTarget && (!state.players[poisonTarget]?.alive || poisonTarget === state.storytellerId)) return {ok: false, error: 'Choose a living character for the poison.'};
    state.actions.witchDraft = {heal, poisonTarget};
    state.actions.witchDone = true;
  } else if (type === 'cast-vote') {
    return castVote(state, actorId, payload.target);
  } else if (type === 'day-ready') {
    if (state.phase !== 'day-discussion' || !state.players[actorId]?.alive) return {ok: false, error: 'The village is not debating.'};
    state.actions.dayReady[actorId] = payload.ready !== false;
    if (aliveIds(state).every(id => state.actions.dayReady[id])) return startDayVote(state);
  } else if (type === 'resolve-pending') {
    return resolvePending(state, actorId, payload.target || null, false);
  } else {
    return {ok: false, error: 'Unknown action.'};
  }
  touch(state);
  return {ok: true};
}

function privateAction(state, seatId) {
  const player = state.players[seatId];
  const action = {type: null};
  if (!player) return action;
  if (!state.phaseReady) return action;
  if (state.resolution?.pending?.actorId === seatId) {
    return {type: state.resolution.pending.type, candidates: aliveIds(state)};
  }
  switch (state.phase) {
    case 'setup-thief':
      if (player.role === 'thief' && player.alive) return {type: 'thief', extras: [...state.extraCards], done: state.actions.thiefDone};
      break;
    case 'setup-cupid':
      if (player.role === 'cupid' && player.alive) return {type: 'cupid', choices: [...state.actions.cupidChoices], done: state.actions.cupidDone};
      break;
    case 'setup-lovers':
      if (state.lovers.includes(seatId)) return {type: 'lover', partnerId: state.lovers.find(id => id !== seatId), done: Boolean(state.actions.loversSeen[seatId])};
      break;
    case 'night-seer':
      if (player.role === 'seer' && player.alive) {
        const target = state.actions.seerTarget;
        return {type: 'seer', target, result: target ? state.players[target].role : null, done: state.actions.seerDone};
      }
      break;
    case 'night-wolves':
      if (player.role === 'werewolf' && player.alive) return {
        type: 'werewolf',
        teammates: roleIds(state, 'werewolf', true).filter(id => id !== seatId),
        votes: clone(state.actions.wolfVotes),
        consensus: wolvesHaveConsensus(state),
        littleGirlInPlay: phaseHasLivingRole(state, 'little-girl'),
        littleGirlCaught: state.actions.littleGirlCaught
      };
      if (player.role === 'little-girl' && player.alive) return {type: 'little-girl'};
      break;
    case 'night-witch':
      if (player.role === 'witch' && player.alive) {
        const victim = state.actions.littleGirlCaught ? playerByRole(state, 'little-girl', true) : state.actions.wolfVictim;
        return {type: 'witch', victim, potions: clone(state.potions), draft: clone(state.actions.witchDraft), done: state.actions.witchDone};
      }
      break;
    case 'sheriff-vote':
    case 'day-vote':
      if (player.alive && seatId !== state.storytellerId) return {
        type: 'vote',
        election: state.phase === 'sheriff-vote',
        candidates: state.phase === 'sheriff-vote' ? [...state.electionCandidates] : aliveIds(state),
        choice: state.actions.votes[seatId] || null
      };
      break;
    case 'day-discussion':
      if (player.alive) return {
        type: 'discussion',
        ready: Boolean(state.actions.dayReady[seatId]),
        readyCount: aliveIds(state).filter(id => state.actions.dayReady[id]).length,
        total: aliveIds(state).length
      };
      break;
  }
  return action;
}

function narratorPanel(state) {
  const alive = aliveIds(state);
  const voteCount = Object.keys(state.actions.votes || {}).filter(id => state.players[id]?.alive).length;
  return {
    cue: STORY_CUES[state.phase] || '',
    phaseReady: Boolean(state.phaseReady),
    canAdvance: canAdvance(state),
    voteProgress: {cast: voteCount, total: alive.length},
    pending: clone(state.resolution?.pending || null)
  };
}

export function viewFor(state, seatId, {coordinator = false} = {}) {
  const own = state.players[seatId];
  const publicPlayers = Object.fromEntries(allSeatIds(state).map(id => {
    const player = state.players[id];
    const deadRole = state.phase === 'game-over' || (!player.alive && state.settings.revealRoles) ? player.role : null;
    return [id, {
      id,
      name: player.name,
      connected: player.connected !== false,
      alive: player.alive,
      role: deadRole,
      storyteller: id === state.storytellerId,
      sheriff: id === state.sheriffId,
      ready: state.phase === 'role-reveal' ? Boolean(state.actions.seen[id]) : undefined
    }];
  }));
  const loverId = state.lovers.includes(seatId) ? state.lovers.find(id => id !== seatId) : null;
  return {
    schema: state.schema,
    roomCode: state.roomCode,
    revision: state.revision,
    phase: state.phase,
    phaseReady: Boolean(state.phaseReady),
    phaseSerial: Number(state.phaseSerial || 0),
    night: state.night,
    day: state.day,
    settings: clone(state.settings),
    storytellerId: state.storytellerId,
    sheriffId: state.sheriffId,
    players: publicPlayers,
    me: own ? {
      id: seatId,
      name: own.name,
      alive: own.alive,
      role: state.phase === 'lobby' ? null : own.role,
      seenRole: Boolean(state.actions.seen[seatId]),
      loverId,
      storyteller: false,
      tableVoice: coordinator,
      sheriff: seatId === state.sheriffId
    } : null,
    privateAction: privateAction(state, seatId),
    narrator: coordinator ? narratorPanel(state) : null,
    storyteller: null,
    coordinator,
    lobbyDeck: state.phase === 'lobby' ? lobbyDeckView(state) : null,
    lastDeaths: clone(state.lastDeaths),
    lastVote: clone(state.lastVote),
    winner: clone(state.winner),
    log: clone(state.log.filter(entry => entry.kind !== 'secret').slice(-12))
  };
}

export function lobbyDeckView(state) {
  const characterCount = allSeatIds(state).length;
  const wolves = state.settings.wolves === 'auto' ? suggestedWolfCount(characterCount) : Number(state.settings.wolves);
  const specials = [...state.settings.roles];
  return {
    people: allSeatIds(state).length,
    characterCount,
    wolves,
    specials,
    villagers: Math.max(0, characterCount - wolves - specials.length),
    valid: characterCount >= 6 && wolves + specials.length <= characterCount
  };
}
