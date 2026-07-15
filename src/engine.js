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
    schema: 4,
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
    chronicle: [],
    whispers: {},
    visions: {},
    nightResult: {healed: false, poisoned: false},
    lastVote: null,
    winner: null,
    pendingWinner: null,
    session: freshSession(),
    roundFacts: freshRoundFacts(),
    log: [{kind: 'moon', text: 'A new village gathered beneath the moon.', at: now}]
  };
}

export function freshSession() {
  return {round: 0, scores: {}, history: [], lastRound: null, ended: false};
}

export function freshRoundFacts() {
  return {visions: [], heals: [], poisons: [], hunterShots: [], dayVotes: []};
}

// Saved villages from the previous release remain playable. The migration is
// deliberately additive: no role, vote or in-progress resolution is changed.
export function upgradeState(state) {
  if (!state || typeof state !== 'object') return state;
  state.schema = 4;
  state.session ||= freshSession();
  state.session.round = Number(state.session.round || 0);
  state.session.scores ||= {};
  state.session.history ||= [];
  state.session.lastRound ||= null;
  state.session.ended = Boolean(state.session.ended);
  state.roundFacts ||= freshRoundFacts();
  state.pendingWinner ||= null;
  for (const key of ['visions', 'heals', 'poisons', 'hunterShots', 'dayVotes']) state.roundFacts[key] ||= [];
  state.actions ||= freshActions();
  state.actions.dayReady ||= {};
  return state;
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
  if (['lobby', 'game-over', 'session-over'].includes(state.phase)) return {ok: false, error: 'There is no turn to open.'};
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

function dealRound(state, characters, rng = Math.random) {
  upgradeState(state);
  state.storytellerId = null;
  let deck;
  try {
    deck = buildDeck(characters.length, state.settings, rng);
  } catch (error) {
    return {ok: false, error: error.message};
  }
  const seats = shuffle(characters, rng);
  seats.forEach((id, index) => {
    Object.assign(state.players[id], {role: deck.dealt[index], alive: true, ready: false});
    state.session.scores[id] ||= {id, name: state.players[id].name, total: 0};
    state.session.scores[id].name = state.players[id].name;
  });
  state.session.round += 1;
  state.session.lastRound = null;
  state.session.ended = false;
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
  state.chronicle = [];
  state.whispers = {};
  state.visions = {};
  state.nightResult = {healed: false, poisoned: false};
  state.lastVote = null;
  state.winner = null;
  state.pendingWinner = null;
  state.roundFacts = freshRoundFacts();
  log(state, `Round ${state.session.round} begins. The Moonfall narrator dealt every gathered player a character card.`, 'story');
  touch(state);
  return {ok: true};
}

export function startGame(state, rng = Math.random) {
  if (state.phase !== 'lobby') return {ok: false, error: 'This game has already begun.'};
  upgradeState(state);
  const connected = allSeatIds(state).filter(id => state.players[id].connected !== false);
  if (connected.length < 6) {
    return {ok: false, error: 'Moonfall needs at least six players. Eight or more gives the classic balance.'};
  }
  for (const id of allSeatIds(state)) {
    if (!connected.includes(id)) delete state.players[id];
  }
  // The narrator is automated on the coordinator phone. Nobody loses their
  // character card or has to operate a separate Storyteller seat.
  return dealRound(state, connected, rng);
}

export function startNextRound(state, rng = Math.random) {
  if (state.phase !== 'game-over') return {ok: false, error: 'Finish the current hunt before dealing again.'};
  upgradeState(state);
  const characters = characterIds(state);
  if (characters.length < 6) return {ok: false, error: 'Moonfall needs at least six players.'};
  if (characters.some(id => state.players[id]?.connected === false)) {
    return {ok: false, error: 'Wait for every seated player to reconnect before the next hunt.'};
  }
  return dealRound(state, characters, rng);
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
    case 'setup-lovers': return aliveIds(state).every(id => state.actions.loversSeen[id]);
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
  state.nightResult = {
    healed: Boolean(victim && state.actions.witchDraft.heal),
    poisoned: Boolean(state.actions.witchDraft.poisonTarget)
  };
  const witchId = playerByRole(state, 'witch', true);
  if (witchId && victim && state.actions.witchDraft.heal) {
    state.roundFacts.heals.push({actorId: witchId, targetId: victim, success: true});
  }
  if (witchId && state.actions.witchDraft.poisonTarget) {
    const targetId = state.actions.witchDraft.poisonTarget;
    state.roundFacts.poisons.push({actorId: witchId, targetId, targetRole: state.players[targetId]?.role || null});
  }
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
  // The village remembers: every loss is written into the chronicle so the
  // scenery (boarded windows, claw-marks, graves) reflects real game events.
  state.chronicle = state.chronicle || [];
  state.chronicle.push({id: item.id, cause: item.cause, night: state.night, day: state.day, source: state.resolution.source});
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

// ── Night whispers ─────────────────────────────────────────────────────────
// After every night resolves, each character privately receives one short
// observation. Some are fragments of what truly happened; some are ordinary
// village noise. Nobody can tell which kind they hold, nothing ever names a
// role, and shared fact-lines let two players corroborate each other — or
// catch each other lying. The whispers exist to feed the day's argument.
const WHISPER_AMBIENT = [
  'A dog barked twice after midnight, then fell suddenly and completely quiet.',
  'You woke once, certain a shutter had banged somewhere down the lane.',
  'The old well-rope creaked in the wind for most of the night.',
  'An owl called from the church tower until the small hours.',
  'You dreamed of running water and woke with cold feet, your door unlatched.',
  'A fox screamed in the far fields. At least, you think it was a fox.',
  'The candle you left burning was out by morning, though no window was open.',
  'Rain tapped your glass a while, yet the road was dry at sunrise.',
  'Somewhere before dawn, a gate swung and was carefully closed again.',
  'You heard the mill boards settle, like a weight crossing them slowly.'
];

const WHISPER_SPIRIT = [
  'The village looks smaller from where you watch now. Its secrets do not.',
  'You drifted down the lane all night. One chimney breathed when it should not have.',
  'The living lock their doors against the wrong things. You see that now.',
  'From the churchyard you counted the lit windows, and one went dark too quickly.',
  'No one hears you. But you hear everything now, and morning will prove you right.'
];

export function generateWhispers(state, rng = Math.random) {
  const pick = list => list[randomIndex(list.length, rng)];
  const living = aliveIds(state);
  const wolfKill = (state.lastDeaths || []).find(death => death.cause === 'the Werewolves');
  const packSize = roleIds(state, 'werewolf', true).length;
  const facts = [];
  if (wolfKill) {
    // One true trail and one false trail, built once per night so several
    // players can hold the same line and corroborate one another by day.
    const decoys = living.filter(id => id !== wolfKill.id);
    const decoy = decoys.length ? state.players[pick(decoys)] : null;
    facts.push(`Something crossed the lane by ${state.players[wolfKill.id]?.name || 'a dark cottage'}’s home in the dark — quick, and heavier than a neighbour.`);
    if (decoy) facts.push(`You heard a door open near ${decoy.name}’s home long after the lamps went out.`);
    if (packSize > 1) facts.push('You are certain of one thing: there was more than one set of footsteps.');
    facts.push('Toward dawn, something ran for the treeline. You did not look out to count its legs.');
  }
  if (state.nightResult?.healed) facts.push('Long after midnight, smoke rose from one chimney — sweet, like herbs thrown on embers.');
  if (state.nightResult?.poisoned) facts.push('A bitter smell clung to the morning air, like crushed green stems.');
  if (state.actions?.seerDone) facts.push('A pale light moved behind a window, was held high a moment, then went dark.');
  if (!wolfKill && !(state.lastDeaths || []).length) facts.push('The night felt held-of-breath, as if the whole village were pretending to sleep.');
  state.whispers = {};
  for (const id of characterIds(state)) {
    const player = state.players[id];
    if (!player.alive) {
      state.whispers[id] = pick(WHISPER_SPIRIT);
    } else {
      state.whispers[id] = facts.length && rng() < .55 ? pick(facts) : pick(WHISPER_AMBIENT);
    }
  }
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
  // Deaths must be witnessed before victory. Hold the terminal result through
  // the public dawn/judgement scene, then open the scoreboard afterwards.
  state.pendingWinner = winner || null;
  if (source === 'night') {
    state.day += 1;
    generateWhispers(state);
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
    if (targetId) {
      state.resolution.queue.push({id: targetId, cause: `${state.players[pending.actorId].name}’s final shot`});
      state.roundFacts.hunterShots.push({actorId: pending.actorId, targetId, targetRole: state.players[targetId]?.role || null});
    }
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
  if (state.pendingWinner) {
    const winner = state.pendingWinner;
    state.pendingWinner = null;
    finishGame(state, winner);
    return {ok: true};
  }
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
  if (state.phase === 'day-vote' && actorId !== targetId && state.lovers.includes(actorId) && state.lovers.includes(targetId)) {
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
  const votes = clone(state.actions.votes || {});
  state.lastVote = {tally, leaders, max, eliminated: leaders.length === 1 ? leaders[0] : null, votes};
  state.roundFacts.dayVotes.push({votes, eliminatedId: state.lastVote.eliminated});
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
  if (state.pendingWinner) {
    const winner = state.pendingWinner;
    state.pendingWinner = null;
    finishGame(state, winner);
    return {ok: true};
  }
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
  // At parity the pack controls the vote and the remaining village can no
  // longer stop it. This is the classic Werewolf terminal condition.
  if (aliveWolves.length >= aliveVillage.length) return {team: 'wolves', title: 'The Pack Devours the Dawn', text: 'The Werewolves have reached parity and seized the village.'};
  return null;
}

export function scoreRound(state, winner = state.winner) {
  upgradeState(state);
  const round = Math.max(1, state.session.round || 1);
  if (state.session.lastRound?.round === round) return state.session.lastRound;
  const facts = state.roundFacts || freshRoundFacts();
  const results = {};
  const add = (id, points, label) => {
    if (!state.players[id] || !points) return;
    results[id] ||= {id, name: state.players[id].name, delta: 0, reasons: []};
    results[id].delta += points;
    results[id].reasons.push({label, points});
  };
  for (const id of characterIds(state)) {
    const player = state.players[id];
    results[id] = {id, name: player.name, delta: 0, reasons: []};
    const won = winner?.team === 'lovers'
      ? state.lovers.includes(id)
      : winner?.team === 'wolves'
        ? player.role === 'werewolf'
        : winner?.team === 'village' && player.role !== 'werewolf';
    if (won) add(id, 3, 'Team victory');
    add(id, player.alive ? 2 : -1, player.alive ? 'Survived the hunt' : 'Fell before the end');
    if (player.role === 'werewolf' && player.alive) add(id, 1, 'Living wolf');
  }
  const seenWolves = new Map();
  for (const fact of facts.visions || []) {
    if (fact.targetRole !== 'werewolf') continue;
    const key = `${fact.actorId}:${fact.targetId}`;
    if (!seenWolves.has(key)) seenWolves.set(key, fact);
  }
  for (const fact of seenWolves.values()) add(fact.actorId, 1, 'Seer found a Werewolf');
  for (const fact of facts.heals || []) if (fact.success) add(fact.actorId, 1, 'Witch saved a life');
  for (const fact of facts.poisons || []) if (fact.targetRole === 'werewolf') add(fact.actorId, 1, 'Witch poisoned a Werewolf');
  for (const fact of facts.hunterShots || []) if (fact.targetRole === 'werewolf') add(fact.actorId, 2, 'Hunter struck a Werewolf');
  if (state.lovers.length === 2 && state.lovers.every(id => state.players[id]?.alive)) {
    for (const id of state.lovers) add(id, 2, 'Both lovers survived');
  }
  for (const ballot of facts.dayVotes || []) {
    const eliminated = state.players[ballot.eliminatedId];
    if (eliminated?.role !== 'werewolf') continue;
    for (const [voterId, targetId] of Object.entries(ballot.votes || {})) {
      if (targetId === ballot.eliminatedId) add(voterId, 1, 'Voted out a Werewolf');
    }
  }
  for (const result of Object.values(results)) {
    state.session.scores[result.id] ||= {id: result.id, name: result.name, total: 0};
    state.session.scores[result.id].name = result.name;
    state.session.scores[result.id].total += result.delta;
    result.total = state.session.scores[result.id].total;
  }
  const snapshot = {
    round,
    winner: clone(winner),
    results: Object.values(results).sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name)),
    completedAt: Date.now()
  };
  state.session.lastRound = snapshot;
  state.session.history.push(clone(snapshot));
  return snapshot;
}

function finishGame(state, winner) {
  state.winner = winner;
  scoreRound(state, winner);
  enterPhase(state, 'game-over', {ready: true});
  log(state, winner.title, 'victory');
  touch(state);
}

export function endSession(state) {
  if (state.phase !== 'game-over') return {ok: false, error: 'Finish the hunt before ending the table.'};
  upgradeState(state);
  state.session.ended = true;
  enterPhase(state, 'session-over', {ready: true});
  log(state, `The table closed after ${state.session.round} ${state.session.round === 1 ? 'hunt' : 'hunts'}.`, 'victory');
  touch(state);
  return {ok: true};
}

export function resetToLobby(state, {preserveSession = false} = {}) {
  enterPhase(state, 'lobby', {ready: true});
  state.schema = 4;
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
  state.chronicle = [];
  state.whispers = {};
  state.visions = {};
  state.nightResult = {healed: false, poisoned: false};
  state.lastVote = null;
  state.winner = null;
  state.pendingWinner = null;
  state.roundFacts = freshRoundFacts();
  if (!preserveSession) state.session = freshSession();
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
    // Everyone turns a fate card during the arrow reveal, so nobody can tell
    // who the lovers are from behaviour — the card itself carries the secret.
    if (state.phase !== 'setup-lovers' || !state.players[actorId]?.alive) return {ok: false, error: 'The arrow reveal is not open.'};
    state.actions.loversSeen[actorId] = true;
  } else if (type === 'seer-choose') {
    error = commandRoleGuard(state, actorId, 'seer', 'night-seer');
    if (error) return {ok: false, error};
    const target = payload.target;
    if (!state.players[target]?.alive || target === actorId || target === state.storytellerId) return {ok: false, error: 'Choose another living character.'};
    state.actions.seerTarget = target;
    state.actions.seerRevealed = true;
    // The Seer's knowledge is permanent: from now on her own phone shows
    // this soul's true form in the town square.
    state.visions = state.visions || {};
    state.visions[target] = state.players[target].role;
    state.roundFacts.visions.push({actorId, targetId: target, targetRole: state.players[target].role});
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
      if (player.alive) {
        const chosen = state.lovers.includes(seatId);
        return {
          type: 'lover',
          chosen,
          partnerId: chosen ? state.lovers.find(id => id !== seatId) : null,
          done: Boolean(state.actions.loversSeen[seatId])
        };
      }
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
  upgradeState(state);
  const own = state.players[seatId];
  const publicPlayers = Object.fromEntries(allSeatIds(state).map(id => {
    const player = state.players[id];
    const deadRole = ['game-over', 'session-over'].includes(state.phase) || (!player.alive && state.settings.revealRoles) ? player.role : null;
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
      whisper: (state.whispers || {})[seatId] || null,
      // Private world-knowledge for the town square: the Seer's accumulated
      // visions, and a werewolf's awareness of the rest of the pack.
      visions: own.role === 'seer' ? clone(state.visions || {}) : null,
      pack: own.role === 'werewolf' ? roleIds(state, 'werewolf', false).filter(id => id !== seatId) : null,
      storyteller: false,
      tableVoice: coordinator,
      sheriff: seatId === state.sheriffId
    } : null,
    privateAction: privateAction(state, seatId),
    narrator: coordinator ? narratorPanel(state) : null,
    storyteller: null,
    coordinator,
    lobbyDeck: state.phase === 'lobby' ? lobbyDeckView(state) : null,
    chronicle: clone(state.chronicle || []),
    lastDeaths: clone(state.lastDeaths),
    nightResult: clone(state.nightResult || {healed: false, poisoned: false}),
    lastVote: clone(state.lastVote),
    winner: clone(state.winner),
    session: {
      round: state.session.round,
      ended: state.session.ended,
      scores: clone(state.session.scores),
      lastRound: ['game-over', 'session-over'].includes(state.phase) ? clone(state.session.lastRound) : null,
      history: state.phase === 'session-over' ? clone(state.session.history) : []
    },
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
