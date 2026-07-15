import {joinRoom, selfId} from 'trystero';
import {
  advanceFromDawn,
  applyPlayerCommand,
  endSession,
  isCoordinator,
  makeState,
  nextNight,
  narratorUnlock,
  resetToLobby,
  setPreset,
  startGame,
  startNextRound,
  storytellerAdvance,
  upgradeState,
  updateSettings,
  viewFor
} from './engine.js';
import {PHASE_META, PRESETS, ROLES, SPECIAL_ROLE_IDS, STORY_CUES} from './roles.js';
import {morningLine, townSquare} from './village.js';
import {cupidCinematic, deathCinematic, hunterCinematic, seerCinematic} from './cutscene.js';
import {narrate, narrationSupported, stopNarration} from './narrator.js';
import {initVoicePack, playVoicePack, stopVoicePack, voicePackCovers, voicePackEngine, voicePackReady, warmVoicePack} from './voicepack.js';
import qrFactory from 'qrcode-generator';

const APP_ID = 'moonfall-steven-werewolf-v2-2026';
const MAX_PEOPLE = 19;
const HOST_STATE_PREFIX = 'moonfall:host:';
const IDENTITY_PREFIX = 'moonfall:seat:';
const LAST_HOST_KEY = 'moonfall:last-host';
const NAME_KEY = 'moonfall:last-name';
const SOUND_KEY = 'moonfall:sound-enabled';
const VOICE_KEY = 'moonfall:voice-enabled';
const AMBIENCE_KEY = 'moonfall:ambience-enabled';
const APP_VERSION = '3.0.0';
const RELAY_REDUNDANCY = 7;
const STALE_CONNECTION_MS = 25000;
const RECONNECT_DELAY_MS = 180;

const app = document.querySelector('#app');
const toastRoot = document.querySelector('#toast-root');
const modalRoot = document.querySelector('#modal-root');
const villageRoot = document.querySelector('#village');
const sceneFxRoot = document.querySelector('#scene-fx');
let lastVillageHtml = null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[char]));
const cleanCode = value => String(value || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let mode = null;
let room = null;
let roomLeavePromise = null;
let net = null;
let roomCode = '';
let hostPeerId = null;
let serverState = null;
let currentView = null;
let identity = null;
let hostEpoch = null;
let peerToSeat = new Map();
let seatToPeer = new Map();
let beaconTimer = null;
let healthTimer = null;
let reconnectTimer = null;
let helloTimers = [];
let connectionState = 'idle';
let networkGeneration = 0;
let networkStartedAt = 0;
let lastHostSignalAt = 0;
let hiddenAt = null;
let wakeLock = null;
let deferredInstallPrompt = null;
let agentTest = false;
let agentTimer = null;
const agentActionKeys = new Map();
let audioContext = null;
let noiseBuffer = null;
let sfxBus = null;
let sfxCompressor = null;
const sfxSamples = new Map();
const SFX_FILES = {
  soft: 'assets/sfx/impactSoft_medium_002.ogg',
  punch: 'assets/sfx/impactPunch_heavy_000.ogg',
  glass: 'assets/sfx/impactGlass_medium_003.ogg',
  bell: 'assets/sfx/impactBell_heavy_001.ogg'
};
// Optional generated audio (assets/ambience/pack.json): looping night/day
// beds plus hero stings. Everything degrades to the procedural soundscape.
const premiumLoops = {};
const premiumStings = {};
const roleSfxVariants = {};
let renderQueued = false;
let soundEnabled = safeRead(SOUND_KEY, true) !== false;
let voiceEnabled = safeRead(VOICE_KEY, true) !== false;
let ambienceEnabled = safeRead(AMBIENCE_KEY, true) !== false;
let ambience = null;
let phaseFxTimer = null;
let narratorAutomationKey = null;
let narratorAutomationGeneration = 0;
const recentCommandIds = new Map();
const diagnosticEvents = [];

const ui = {
  homeTab: new URLSearchParams(location.search).get('room') ? 'join' : 'create',
  roleFaceUp: false,
  thiefRevealed: false,
  seerFlipped: false,
  loverFlipped: false,
  cupidChoices: [],
  witchHeal: false,
  witchPoisonTarget: null,
  poisonOpen: false,
  whisperOpen: false,
  headerOpen: false,
  previousPhase: null,
  transitionFrom: null,
  phaseFresh: false,
  modal: null,
  cupidLoosed: false,
  sceneBusy: null,
  busy: false
};

function randomToken(length = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

function randomCode() {
  return randomToken(6).toUpperCase().replace(/[a-z]/g, char => char.toUpperCase());
}

function safeRead(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private mode may refuse storage. */ }
}

function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* no-op */ }
}

function diagnostic(type, details = {}) {
  diagnosticEvents.push({at: new Date().toISOString(), type, ...details});
  if (diagnosticEvents.length > 160) diagnosticEvents.splice(0, diagnosticEvents.length - 160);
}

function diagnosticReport() {
  const peerStates = Object.fromEntries(Object.entries(room?.getPeers?.() || {}).map(([peerId, connection]) => [peerId, {
    connectionState: connection?.connectionState || null,
    iceConnectionState: connection?.iceConnectionState || null,
    signalingState: connection?.signalingState || null
  }]));
  return JSON.stringify({
    moonfallVersion: APP_VERSION,
    generatedAt: new Date().toISOString(),
    roomCode,
    mode,
    phase: currentView?.phase || serverState?.phase || null,
    connectionState,
    online: navigator.onLine,
    visibility: document.visibilityState,
    standalone: isStandalone(),
    userAgent: navigator.userAgent,
    network: navigator.connection ? {
      effectiveType: navigator.connection.effectiveType,
      downlink: navigator.connection.downlink,
      rtt: navigator.connection.rtt,
      saveData: navigator.connection.saveData
    } : null,
    peerStates,
    events: diagnosticEvents
  }, null, 2);
}

window.addEventListener('error', event => {
  diagnostic('js-error', {message: String(event.message || 'unknown').slice(0, 220)});
});

window.addEventListener('unhandledrejection', event => {
  diagnostic('promise-rejection', {message: String(event.reason?.message || event.reason || 'unknown').slice(0, 220)});
});

function seatIdentity(code, name) {
  const key = `${IDENTITY_PREFIX}${code}`;
  const existing = safeRead(key);
  if (existing?.seatId && existing?.seatKey) {
    existing.name = name || existing.name;
    safeWrite(key, existing);
    return existing;
  }
  const created = {seatId: `s_${randomToken(14)}`, seatKey: randomToken(28), name};
  safeWrite(key, created);
  return created;
}

function persistHost() {
  if (mode !== 'coordinator' || !serverState || agentTest) return;
  const persisted = JSON.parse(JSON.stringify(serverState));
  for (const player of Object.values(persisted.players)) {
    player.peerId = null;
    player.connected = player.id === persisted.coordinatorId;
  }
  safeWrite(`${HOST_STATE_PREFIX}${serverState.roomCode}`, persisted);
  safeWrite(LAST_HOST_KEY, {code: serverState.roomCode, phase: serverState.phase, updatedAt: Date.now()});
}

function toast(text, type = '') {
  if (!text) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = text;
  toastRoot.appendChild(node);
  setTimeout(() => node.remove(), 3400);
}

function vibrate(pattern = 24) {
  // A buzzing phone can betray a private wake or confirm across a quiet
  // table. Live Moonfall therefore uses visual feedback only; the home screen
  // may still use the device's ordinary tactile tap response.
  if (mode) return;
  try { navigator.vibrate?.(pattern); } catch { /* no-op */ }
}

let sceneFxClear = null;
function playSceneAction(kind, target = null, duration = 1100) {
  if (!sceneFxRoot || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const node = target?.closest?.('.sprite') || target;
  const rect = node?.getBoundingClientRect?.();
  sceneFxRoot.style.setProperty('--fx-x', `${rect ? rect.left + rect.width / 2 : innerWidth / 2}px`);
  sceneFxRoot.style.setProperty('--fx-y', `${rect ? rect.top + rect.height / 2 : innerHeight / 2}px`);
  sceneFxRoot.className = '';
  void sceneFxRoot.offsetWidth;
  sceneFxRoot.className = kind;
  clearTimeout(sceneFxClear);
  sceneFxClear = setTimeout(() => { sceneFxRoot.className = ''; }, duration);
}

function unlockAudio(force = false) {
  if (!soundEnabled && !force) return null;
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    audioContext ||= new AudioCtor();
    if (!sfxBus) {
      sfxBus = audioContext.createGain();
      sfxCompressor = audioContext.createDynamicsCompressor();
      sfxBus.gain.value = 1.55;
      sfxCompressor.threshold.value = -20;
      sfxCompressor.knee.value = 14;
      sfxCompressor.ratio.value = 5;
      sfxCompressor.attack.value = .004;
      sfxCompressor.release.value = .24;
      sfxBus.connect(sfxCompressor).connect(audioContext.destination);
      warmSfxSamples(audioContext);
    }
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  } catch { return null; }
}

function sfxOutput(context) {
  return context === audioContext && sfxBus ? sfxBus : context.destination;
}

function master(context, at, duration, volume = .12) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), at + Math.min(.04, duration * .12));
  gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
  gain.connect(sfxOutput(context));
  return gain;
}

function tone(context, {at, frequency, endFrequency = frequency, duration = .2, volume = .08, type = 'sine', attack = .02, destination = null, detune = 0}) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(20, frequency), at);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), at + duration);
  oscillator.detune.setValueAtTime(detune, at);
  gain.gain.setValueAtTime(.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), at + Math.min(attack, duration * .4));
  gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
  oscillator.connect(gain).connect(destination || sfxOutput(context));
  oscillator.start(at);
  oscillator.stop(at + duration + .05);
  return oscillator;
}

function ensureNoiseBuffer(context) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== context.sampleRate) {
    noiseBuffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

const sfxReady = new Map();

function sfxSampleBuffer(context, id) {
  if (sfxSamples.has(id)) return sfxSamples.get(id);
  const url = SFX_FILES[id];
  if (!url) return Promise.resolve(null);
  const pending = fetch(url)
    .then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`missing SFX ${id}`)))
    .then(bytes => context.decodeAudioData(bytes))
    .then(buffer => {
      sfxReady.set(id, buffer);
      return buffer;
    })
    .catch(() => null);
  sfxSamples.set(id, pending);
  return pending;
}

function warmSfxSamples(context) {
  if (!context) return;
  for (const id of Object.keys(SFX_FILES)) sfxSampleBuffer(context, id);
}

async function initPremiumAudio() {
  try {
    const response = await fetch('assets/ambience/pack.json', {cache: 'no-cache'});
    if (!response.ok) return;
    const data = await response.json();
    for (const [slot, file] of Object.entries(data?.loops || {})) {
      SFX_FILES[`loop-${slot}`] = `assets/ambience/${file}`;
      premiumLoops[slot] = `loop-${slot}`;
    }
    for (const [slot, file] of Object.entries(data?.stings || {})) {
      SFX_FILES[`sting-${slot}`] = `assets/ambience/${file}`;
      premiumStings[slot] = `sting-${slot}`;
    }
    const roleResponse = await fetch('assets/role-sfx/pack.json', {cache: 'no-cache'});
    if (roleResponse.ok) {
      const roleData = await roleResponse.json();
      for (const [slot, files] of Object.entries(roleData?.variants || {})) {
        roleSfxVariants[slot] = (Array.isArray(files) ? files : [files]).map((file, index) => {
          const id = `role-${slot}-${index}`;
          SFX_FILES[id] = `assets/role-sfx/${file}`;
          return id;
        });
      }
    }
    diagnostic('premium-audio-ready', {loops: Object.keys(premiumLoops), stings: Object.keys(premiumStings), roleSfx: Object.keys(roleSfxVariants)});
    if (audioContext) warmSfxSamples(audioContext);
  } catch { /* Procedural soundscape remains the fallback. */ }
}

function sample(context, id, {at = context.currentTime, volume = .18, rate = 1} = {}) {
  sfxSampleBuffer(context, id).then(buffer => {
    if (!buffer || context.state === 'closed') return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain).connect(sfxOutput(context));
    source.start(Math.max(context.currentTime, at));
  });
}

function noise(context, {at, duration = .2, volume = .05, filterType = 'bandpass', frequency = 1200, endFrequency = frequency, q = 1.2, destination = null}) {
  ensureNoiseBuffer(context);
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = noiseBuffer;
  filter.type = filterType;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(frequency, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), at + duration);
  gain.gain.setValueAtTime(.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + Math.min(.025, duration * .2));
  gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
  source.connect(filter).connect(gain).connect(destination || sfxOutput(context));
  source.start(at);
  source.stop(at + duration + .03);
}

function bell(context, at, frequency, volume = .07, duration = 1, destination = null) {
  tone(context, {at, frequency, duration, volume, type: 'sine', destination});
  tone(context, {at, frequency: frequency * 2.01, duration: duration * .72, volume: volume * .32, type: 'sine', destination});
  tone(context, {at, frequency: frequency * 3.98, duration: duration * .42, volume: volume * .13, type: 'sine', destination});
}

function premiumVariant(slot) {
  const variants = roleSfxVariants[slot];
  if (!variants?.length) return null;
  return variants[Math.floor(Math.random() * variants.length)];
}

// HARD RULE — the storyteller device is the only speaker. Every other phone
// in a live game is silent no matter which handler asks for audio, so no tap,
// confirm or kill effect can ever leak a player's secret from their own
// pocket. Feedback on player phones is visual only.
function deviceMaySpeak() {
  if (!mode) return true;                    // home screen previews
  return Boolean(currentView && isTableVoice(currentView));
}

function sound(kind = 'tap', delay = 0) {
  if (!soundEnabled || !deviceMaySpeak()) return;
  const context = unlockAudio();
  if (!context) return;
  const at = context.currentTime + Math.max(0, delay);
  try {
    const roleSlot = {keys: 'thief', cupid: 'cupid', lovers: 'lovers', seer: 'seer', 'wolf-cue': 'wolves', 'little-girl': 'little-girl', witch: 'witch', kill: 'death', heal: 'revive', hunter: 'hunter', sheriff: 'sheriff', vote: 'judgement'}[kind];
    const roleSample = premiumVariant(roleSlot);
    if (roleSample) {
      const volume = {wolves: .54, death: .5, revive: .42, 'little-girl': .32, cupid: .38, lovers: .32, seer: .34, witch: .4, thief: .35, hunter: .48, sheriff: .36, judgement: .36}[roleSlot] || .4;
      sample(context, roleSample, {at, volume});
      return;
    }
    // Generated hero effects replace the procedural versions when present.
    const sting = {howl: ['howl', .5], kill: ['kill', .55], heal: ['heal', .42], victory: ['victory', .5]}[kind];
    if (sting && sfxReady.get(premiumStings[sting[0]])) {
      sample(context, premiumStings[sting[0]], {at, volume: sting[1]});
      return;
    }
    if (kind === 'tap') {
      tone(context, {at, frequency: 310, endFrequency: 190, duration: .055, volume: .025, type: 'triangle', attack: .006});
    } else if (kind === 'flip') {
      noise(context, {at, duration: .16, volume: .045, frequency: 2600, endFrequency: 650, q: .7});
      tone(context, {at: at + .09, frequency: 180, endFrequency: 115, duration: .08, volume: .035, type: 'triangle', attack: .004});
    } else if (kind === 'shuffle') {
      for (let index = 0; index < 7; index += 1) noise(context, {at: at + index * .075, duration: .09, volume: .025, frequency: 1600 + index * 90, endFrequency: 520, q: .8});
      tone(context, {at: at + .58, frequency: 240, endFrequency: 135, duration: .12, volume: .04, type: 'triangle'});
    } else if (kind === 'decision') {
      sample(context, 'bell', {at, volume: .08, rate: 1.18});
      bell(context, at, 392, .055, .75);
      bell(context, at + .18, 587.3, .05, .9);
    } else if (kind === 'keys') {
      [1180, 1430, 1710].forEach((frequency, index) => bell(context, at + index * .07, frequency, .022, .34));
      noise(context, {at: at + .19, duration: .12, volume: .02, frequency: 4200, endFrequency: 1800, q: 2});
    } else if (kind === 'cupid') {
      [523.3, 659.3, 784].forEach((frequency, index) => bell(context, at + index * .15, frequency, .045, .85));
      tone(context, {at: at + .48, frequency: 1046.5, endFrequency: 880, duration: .7, volume: .035, type: 'sine'});
    } else if (kind === 'seer') {
      [659.3, 987.8, 1318.5, 1760].forEach((frequency, index) => bell(context, at + index * .11, frequency, .03, .65));
      noise(context, {at, duration: .75, volume: .018, filterType: 'highpass', frequency: 2500, endFrequency: 7800, q: .5});
    } else if (kind === 'wolf-cue') {
      tone(context, {at, frequency: 98, endFrequency: 72, duration: .75, volume: .075, type: 'sawtooth', attack: .08});
      noise(context, {at: at + .08, duration: .6, volume: .025, filterType: 'lowpass', frequency: 650, endFrequency: 210, q: 1.4});
    } else if (kind === 'witch') {
      [0, .11, .23, .39, .56].forEach((offset, index) => tone(context, {at: at + offset, frequency: 230 + index * 57, endFrequency: 510 + index * 45, duration: .18, volume: .025, type: 'sine', attack: .015}));
      bell(context, at + .66, 740, .035, .72);
    } else if (kind === 'howl') {
      const output = master(context, at, 3.05, .82);
      const filter = context.createBiquadFilter();
      const delayNode = context.createDelay(.5);
      const feedback = context.createGain();
      filter.type = 'lowpass';
      filter.frequency.value = 1050;
      delayNode.delayTime.value = .19;
      feedback.gain.value = .19;
      filter.connect(output);
      filter.connect(delayNode).connect(feedback).connect(delayNode);
      delayNode.connect(output);
      const voice = tone(context, {at, frequency: 155, endFrequency: 235, duration: 2.9, volume: .14, type: 'sawtooth', attack: .28, destination: filter});
      voice.frequency.setValueAtTime(155, at);
      voice.frequency.exponentialRampToValueAtTime(320, at + .52);
      voice.frequency.exponentialRampToValueAtTime(255, at + 1.05);
      voice.frequency.exponentialRampToValueAtTime(395, at + 1.72);
      voice.frequency.exponentialRampToValueAtTime(285, at + 2.25);
      voice.frequency.exponentialRampToValueAtTime(170, at + 2.9);
      const vibrato = context.createOscillator();
      const vibratoDepth = context.createGain();
      vibrato.frequency.value = 5.1;
      vibratoDepth.gain.value = 18;
      vibrato.connect(vibratoDepth).connect(voice.detune);
      vibrato.start(at + .35);
      vibrato.stop(at + 2.9);
      tone(context, {at: at + .05, frequency: 78, endFrequency: 108, duration: 2.65, volume: .045, type: 'sine', attack: .35, destination: filter});
      noise(context, {at, duration: 3, volume: .018, filterType: 'lowpass', frequency: 520, endFrequency: 170, q: .7, destination: filter});
    } else if (kind === 'kill') {
      // Two heartbeats, a close slash and a cinematic sub drop. The layered
      // transient survives small phone speakers while the low tail adds weight.
      tone(context, {at, frequency: 68, endFrequency: 54, duration: .16, volume: .17, type: 'sine', attack: .006});
      tone(context, {at: at + .24, frequency: 72, endFrequency: 52, duration: .2, volume: .2, type: 'sine', attack: .006});
      noise(context, {at: at + .5, duration: .16, volume: .2, filterType: 'highpass', frequency: 1450, endFrequency: 6900, q: .45});
      tone(context, {at: at + .52, frequency: 132, endFrequency: 34, duration: .9, volume: .21, type: 'sine', attack: .006});
      tone(context, {at: at + .55, frequency: 83, endFrequency: 38, duration: 1.15, volume: .11, type: 'sawtooth', attack: .012});
      noise(context, {at: at + .68, duration: .82, volume: .055, filterType: 'lowpass', frequency: 680, endFrequency: 120, q: .7});
      sample(context, 'punch', {at: at + .5, volume: .42, rate: .82});
      sample(context, 'glass', {at: at + .54, volume: .14, rate: .66});
    } else if (kind === 'select') {
      noise(context, {at, duration: .13, volume: .075, frequency: 1700, endFrequency: 420, q: .8});
      tone(context, {at: at + .015, frequency: 215, endFrequency: 112, duration: .2, volume: .1, type: 'triangle', attack: .004});
      tone(context, {at: at + .08, frequency: 71, endFrequency: 54, duration: .28, volume: .07, type: 'sine', attack: .006});
      sample(context, 'soft', {at, volume: .24, rate: .82});
    } else if (kind === 'heal') {
      [523.3, 659.3, 784, 1046.5].forEach((frequency, index) => bell(context, at + index * .13, frequency, .065 - index * .007, 1.05));
      noise(context, {at: at + .08, duration: .72, volume: .026, filterType: 'highpass', frequency: 2200, endFrequency: 7600, q: .45});
      tone(context, {at: at + .5, frequency: 196, endFrequency: 392, duration: .8, volume: .055, type: 'sine', attack: .08});
      sample(context, 'bell', {at: at + .08, volume: .22, rate: 1.14});
    } else if (kind === 'hunter') {
      noise(context, {at, duration: .12, volume: .18, filterType: 'highpass', frequency: 1100, endFrequency: 4800, q: .4});
      tone(context, {at, frequency: 92, endFrequency: 36, duration: .8, volume: .12, type: 'square', attack: .004});
      noise(context, {at: at + .16, duration: .72, volume: .035, filterType: 'lowpass', frequency: 780, endFrequency: 140, q: .6});
      sample(context, 'punch', {at, volume: .5, rate: .72});
      sample(context, 'glass', {at: at + .04, volume: .12, rate: .9});
    } else if (kind === 'dawn') {
      [392, 493.9, 587.3, 784].forEach((frequency, index) => bell(context, at + index * .2, frequency, .052, 1.25));
      tone(context, {at: at + .25, frequency: 196, endFrequency: 392, duration: 1.4, volume: .035, type: 'sine', attack: .22});
    } else if (kind === 'vote') {
      bell(context, at, 311.1, .085, 1.35);
      bell(context, at + .34, 311.1, .065, 1.1);
      tone(context, {at: at + .66, frequency: 126, endFrequency: 72, duration: .38, volume: .075, type: 'triangle', attack: .006});
    } else if (kind === 'sheriff') {
      bell(context, at, 440, .075, 1.4);
      bell(context, at + .28, 659.3, .055, 1.25);
      bell(context, at + .55, 880, .04, 1.05);
    } else if (kind === 'victory') {
      [261.6, 329.6, 392, 523.3].forEach((frequency, index) => bell(context, at + index * .14, frequency, .06, 1.5));
      [523.3, 659.3, 784].forEach(frequency => tone(context, {at: at + .72, frequency, duration: 1.5, volume: .038, type: 'sine', attack: .08}));
    }
  } catch { /* Sound effects are decorative and must never interrupt play. */ }
}

function isTableVoice(view) {
  return Boolean(view?.me?.tableVoice || view?.coordinator || view?.me?.storyteller);
}

function transitionSound(view, previous) {
  if (!previous || !isTableVoice(view) || !soundEnabled) return;
  const next = view.phase;
  const enteringNight = (previous === 'role-reveal' || previous === 'day-result') && (next.startsWith('setup-') || next.startsWith('night-'));
  if (enteringNight) return sound('howl');
  if (next === 'role-reveal') return sound('shuffle');
  if (next === 'setup-thief') return sound('keys');
  if (next === 'setup-cupid') return sound('cupid');
  if (next === 'setup-lovers') return sound('lovers');
  if (next === 'night-seer') return sound('seer');
  if (next === 'night-wolves') {
    sound('wolf-cue');
    if (view.settings?.roles?.includes('little-girl')) sound('little-girl', 2.1);
    return;
  }
  if (next === 'night-witch') return sound('witch');
  if (next === 'resolution') return sound(view.narrator?.pending?.type === 'hunter' ? 'hunter' : 'kill');
  if (next === 'dawn') {
    const deathAtDawn = Boolean(view.lastDeaths?.length);
    const healedAtDawn = Boolean(view.nightResult?.healed);
    if (deathAtDawn) sound('kill');
    else if (healedAtDawn) sound('heal');
    return sound('dawn', deathAtDawn ? 3.8 : healedAtDawn ? 3.1 : 0);
  }
  if (next === 'sheriff-vote') return sound('sheriff');
  if (next === 'day-vote') return sound('vote');
  if (next === 'day-result') {
    if (view.lastDeaths?.length) {
      sound('kill');
      return sound('decision', 3.8);
    }
    return sound('decision');
  }
  if (next === 'game-over') return sound('victory');
  return sound('decision');
}

function cricketChirp(context, at, destination) {
  const base = 4100 + Math.random() * 500;
  for (let index = 0; index < 4; index += 1) {
    tone(context, {at: at + index * .052, frequency: base, endFrequency: base * .97, duration: .038, volume: .0022, type: 'sine', attack: .006, destination});
  }
}

function owlHoot(context, at, destination) {
  tone(context, {at, frequency: 340, endFrequency: 300, duration: .38, volume: .012, type: 'sine', attack: .09, destination});
  tone(context, {at: at + .5, frequency: 320, endFrequency: 270, duration: .55, volume: .011, type: 'sine', attack: .09, destination});
}

function birdChirp(context, at, destination) {
  const count = 2 + Math.floor(Math.random() * 3);
  for (let index = 0; index < count; index += 1) {
    const start = 2300 + Math.random() * 1500;
    tone(context, {at: at + index * .14, frequency: start, endFrequency: start + 500 + Math.random() * 700, duration: .09, volume: .008, type: 'sine', attack: .012, destination});
  }
}

function stopAmbience() {
  const current = ambience;
  if (!current) return;
  ambience = null;
  clearTimeout(current.timer);
  try {
    const now = audioContext.currentTime;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(Math.max(.0001, current.gain.gain.value), now);
    current.gain.gain.exponentialRampToValueAtTime(.0001, now + 1.1);
    setTimeout(() => {
      for (const node of current.stoppables || []) {
        try { node?.stop(); } catch { /* no-op */ }
      }
      try { current.gain.disconnect(); } catch { /* no-op */ }
    }, 1300);
  } catch { /* Ambience teardown must never interrupt play. */ }
}

function setAmbienceDuck(active) {
  const current = ambience;
  if (!current || !audioContext) return;
  try {
    const now = audioContext.currentTime;
    const baseGain = current.baseGain ?? 1;
    const target = active ? Math.max(.012, baseGain * .11) : baseGain;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setTargetAtTime(target, now, active ? .07 : .38);
  } catch { /* Narrator ducking must never interrupt play. */ }
}

function startAmbience(kind) {
  if (ambience?.kind === kind) return;
  stopAmbience();
  if (!kind || !soundEnabled || !ambienceEnabled) return;
  const context = unlockAudio();
  if (!context) return;
  // A generated ambience loop replaces the whole procedural bed when present.
  const loopBuffer = sfxReady.get(premiumLoops[kind]);
  if (loopBuffer) {
    try {
      const gain = context.createGain();
      const now = context.currentTime;
      const baseGain = kind === 'night' ? .18 : kind === 'day' ? .14 : .15;
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(baseGain, now + 2.5);
      gain.connect(sfxOutput(context));
      const loop = context.createBufferSource();
      loop.buffer = loopBuffer;
      loop.loop = true;
      if (kind === 'night') {
        const mellow = context.createBiquadFilter();
        mellow.type = 'lowpass';
        mellow.frequency.value = 2600;
        mellow.Q.value = .45;
        loop.connect(mellow).connect(gain);
      } else {
        loop.connect(gain);
      }
      loop.start();
      ambience = {kind, gain, baseGain, timer: null, stoppables: [loop]};
      return;
    } catch { /* Fall through to the procedural bed. */ }
  }
  if (kind === 'theme') return;
  try {
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.72, now + 2.5);
    gain.connect(context.destination);
    ensureNoiseBuffer(context);
    const wind = context.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'lowpass';
    // Keep enough midrange in the wind for tiny phone speakers. The earlier
    // sub-heavy bed disappeared almost entirely below about 400 Hz, leaving
    // the sparse cricket layer as the only audible ambience.
    windFilter.frequency.value = kind === 'night' ? 620 : 880;
    windFilter.Q.value = .4;
    const windGain = context.createGain();
    windGain.gain.value = kind === 'night' ? .046 : .029;
    const lfo = context.createOscillator();
    const lfoDepth = context.createGain();
    lfo.frequency.value = .07;
    lfoDepth.gain.value = kind === 'night' ? 230 : 290;
    lfo.connect(lfoDepth).connect(windFilter.frequency);
    wind.connect(windFilter).connect(windGain).connect(gain);
    const airFilter = context.createBiquadFilter();
    const airGain = context.createGain();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = kind === 'night' ? 1120 : 1540;
    airFilter.Q.value = .55;
    airGain.gain.value = kind === 'night' ? .019 : .012;
    wind.connect(airFilter).connect(airGain).connect(gain);
    const drone = context.createOscillator();
    const droneGain = context.createGain();
    const droneLfo = context.createOscillator();
    const droneDepth = context.createGain();
    drone.type = kind === 'night' ? 'sine' : 'triangle';
    drone.frequency.value = kind === 'night' ? 112 : 147;
    droneGain.gain.value = kind === 'night' ? .009 : .0045;
    droneLfo.frequency.value = .045;
    droneDepth.gain.value = kind === 'night' ? 8 : 4;
    droneLfo.connect(droneDepth).connect(drone.detune);
    drone.connect(droneGain).connect(gain);
    wind.start();
    lfo.start();
    drone.start();
    droneLfo.start();
    const state = {kind, gain, baseGain: .72, timer: null, stoppables: [wind, lfo, drone, droneLfo]};
    const schedule = () => {
      if (ambience !== state) return;
      const at = context.currentTime + .05;
      if (kind === 'night') {
        if (Math.random() < .2) cricketChirp(context, at, gain);
        if (Math.random() < .14) owlHoot(context, at, gain);
        if (Math.random() < .07) bell(context, at + .3, 392, .012, 2.2);
      } else if (Math.random() < .8) {
        birdChirp(context, at, gain);
      }
      state.timer = setTimeout(schedule, kind === 'night' ? 1000 + Math.random() * 2300 : 900 + Math.random() * 2600);
    };
    state.timer = setTimeout(schedule, 1500);
    ambience = state;
  } catch {
    ambience = null;
  }
}

function updateAmbience(view) {
  if (!view || !isTableVoice(view) || !soundEnabled || !ambienceEnabled) return stopAmbience();
  const phase = view.phase;
  // 'theme' plays the generated title-music loop when one exists; there is no
  // procedural fallback for it, so the lobby stays quiet on fresh clones.
  const kind = ['lobby', 'game-over'].includes(phase) ? 'theme'
    : ['dawn', 'sheriff-vote', 'day-discussion', 'day-vote', 'day-result'].includes(phase) ? 'day' : 'night';
  startAmbience(kind);
}

function narrationFor(view) {
  const phase = view.phase;
  const roleAloud = roleId => ROLES[roleId]?.name || 'Villager';
  if (phase === 'dawn') {
    const deaths = view.lastDeaths || [];
    if (!deaths.length) return 'The sun rises, and the village wakes to a miracle. Nobody died in the night.';
    return `The sun rises. ${deaths.map(death => `${death.name} was claimed by ${death.cause}, and is revealed as the ${roleAloud(death.role)}`).join('. ')}.`;
  }
  if (phase === 'day-result') {
    if (view.lastVote?.leaders?.length > 1) return 'The vote is tied. By the old law of the village, nobody is eliminated today.';
    const deaths = view.lastDeaths || [];
    if (!deaths.length) return 'No judgement was cast. Nobody leaves the village today.';
    return `The village has spoken. ${deaths.map(death => `${death.name} faces the judgement, and is revealed as the ${roleAloud(death.role)}`).join('. ')}.`;
  }
  if (phase === 'game-over') return view.winner ? `${view.winner.title}. ${view.winner.text}` : 'The tale is ended.';
  if (phase === 'resolution') return null;
  return STORY_CUES[phase] || null;
}

function narrationIdsFor(view) {
  const phase = view.phase;
  const deathIds = deaths => {
    const ids = [];
    deaths.forEach((death, index) => {
      if (index > 0) ids.push('another-death');
      ids.push('reveal', `role-${death.role || 'villager'}`);
    });
    return ids;
  };
  if (phase === 'dawn') {
    const deaths = view.lastDeaths || [];
    return deaths.length ? ['dawn-death', ...deathIds(deaths)] : ['dawn-none'];
  }
  if (phase === 'day-result') {
    if (view.lastVote?.leaders?.length > 1) return ['vote-tied'];
    const deaths = view.lastDeaths || [];
    return deaths.length ? ['vote-death', ...deathIds(deaths)] : ['vote-none'];
  }
  if (phase === 'game-over') return [`win-${view.winner?.team || 'none'}`];
  if (phase === 'resolution') return null;
  return STORY_CUES[phase] ? [`cue-${phase}`] : null;
}

const SLEEP_CUES = {
  'setup-thief': ['sleep-setup-thief', 'The Thief falls back asleep.'],
  'setup-cupid': ['sleep-setup-cupid', 'Cupid falls back asleep.'],
  'setup-lovers': ['sleep-setup-lovers', 'The lovers close their eyes.'],
  'night-seer': ['sleep-night-seer', 'The Seer closes their eyes.'],
  'night-wolves': ['sleep-night-wolves', 'The Werewolves close their eyes.'],
  'night-witch': ['sleep-night-witch', 'The Witch closes their eyes.']
};

function openingNarration(view) {
  if (view.phase === 'resolution') {
    const pending = view.narrator?.pending;
    if (pending?.type === 'hunter') return {ids: ['cue-hunter-shot'], text: 'The Hunter has fallen, but one final shot remains. Hunter, open your eyes and choose.'};
    if (pending?.type === 'sheriff-successor') return {ids: ['cue-sheriff-successor'], text: 'The Sheriff has fallen. Sheriff, open your eyes and pass the badge to a living soul.'};
    return {ids: [], text: ''};
  }
  const enteringNight = (ui.transitionFrom === 'role-reveal' || ui.transitionFrom === 'day-result')
    && (view.phase.startsWith('setup-') || view.phase.startsWith('night-'));
  let ids = narrationIdsFor(view) || [];
  let text = narrationFor(view) || '';
  if (view.phase === 'dawn') {
    ids = ['wake-village', ...ids];
    text = `Everyone, open your eyes. ${text}`;
  }
  if (enteringNight) {
    ids = ['nightfall', ...ids];
    text = `Night falls on the village. Everyone, close your eyes. ${text}`;
  }
  return {ids, text};
}

async function playNarratorSequence(ids, text, {delay = 350} = {}) {
  const fallbackMs = Math.max(900, String(text || '').trim().split(/\s+/).filter(Boolean).length * 510);
  setAmbienceDuck(true);
  try {
    if (!voiceEnabled || (!ids?.length && !text)) {
      await sleep(Math.min(900, fallbackMs));
      return;
    }
    const context = unlockAudio(true);
    if (context && ids?.length && voicePackCovers(ids)) {
      stopNarration();
      const duration = await playVoicePack(context, ids, {delay, gap: .24, volume: 1});
      if (duration) {
        await sleep(duration + 180);
        return;
      }
    }
    stopVoicePack();
    const duration = await narrate(text, {delay, volume: 1});
    if (!duration) await sleep(Math.min(900, delay + fallbackMs));
  } finally {
    setAmbienceDuck(false);
  }
}

function narratorAutomationStage(view) {
  if (!view || mode !== 'coordinator' || !view.coordinator || view.phase === 'lobby') return null;
  if (view.phase === 'game-over') return 'opening';
  if (!view.phaseReady) return 'opening';
  if (['role-reveal', 'setup-thief', 'setup-cupid', 'setup-lovers', 'night-seer', 'night-wolves', 'night-witch'].includes(view.phase)
      && view.narrator?.canAdvance) return 'closing';
  return null;
}

function scheduleNarratorAutomation() {
  const view = currentView;
  const stage = narratorAutomationStage(view);
  if (!stage) return;
  const key = `${view.phaseSerial}:${view.phase}:${stage}`;
  if (narratorAutomationKey === key) return;
  narratorAutomationKey = key;
  const generation = ++narratorAutomationGeneration;
  const phaseSerial = view.phaseSerial;
  const phase = view.phase;
  void (async () => {
    if (stage === 'opening') {
      const opening = openingNarration(view);
      const phaseCueLead = {'setup-thief': 2100, 'setup-cupid': 2700, 'setup-lovers': 2500, 'night-seer': 2300, 'night-wolves': 4800, 'night-witch': 2700, 'sheriff-vote': 2100, 'day-vote': 1900, resolution: 2700};
      const deathReveal = (phase === 'dawn' || phase === 'day-result') && Boolean(view.lastDeaths?.length);
      const healedReveal = phase === 'dawn' && Boolean(view.nightResult?.healed) && !deathReveal;
      // Dawn visuals begin with the wake line, then collapse and true-form
      // reveal on the following recorded clips. There is no dead-air card wait.
      const delay = opening.ids?.[0] === 'nightfall' ? 2300 : deathReveal ? 650 : healedReveal ? 900 : phase === 'dawn' ? 650 : phaseCueLead[phase] || 350;
      await playNarratorSequence(opening.ids, opening.text, {delay});
      if (phase === 'dawn' || phase === 'day-result') await sleep(Math.max(900, (view.lastDeaths?.length || 0) * 700));
    } else {
      const [id, text] = SLEEP_CUES[phase] || [null, ''];
      if (id) await playNarratorSequence([id], text, {delay: 180});
      else await sleep(500);
    }
    if (generation !== narratorAutomationGeneration || currentView?.phaseSerial !== phaseSerial || currentView?.phase !== phase) return;
    if (stage === 'closing') return sendOwnCommand('auto:advance');
    if (phase === 'dawn') return sendOwnCommand('auto:dawn');
    if (phase === 'day-result') return sendOwnCommand('auto:next-night');
    if (phase === 'game-over') return;
    sendOwnCommand('auto:unlock');
  })();
}

function playPhaseFx(kind) {
  const fx = document.querySelector('#phase-fx');
  if (!fx || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  fx.className = '';
  void fx.offsetWidth;
  fx.className = kind;
  clearTimeout(phaseFxTimer);
  phaseFxTimer = setTimeout(() => { fx.className = ''; }, 2700);
}

function phaseFxFor(view, previous) {
  if (!previous) return null;
  const toNight = view.phase.startsWith('setup-') || view.phase.startsWith('night-');
  const fromDayOrDeal = previous === 'role-reveal' || previous === 'day-result';
  if (toNight && fromDayOrDeal) return 'nightfall';
  if (view.phase === 'dawn') return 'dawnrise';
  return null;
}

async function holdWakeLock() {
  if (!mode || wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    wakeLock = sentinel;
    sentinel.addEventListener?.('release', () => {
      if (wakeLock === sentinel) wakeLock = null;
    }, {once: true});
  } catch { /* A later tap or visibility change will try again. */ }
}

function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* no-op */ }
  wakeLock = null;
}

function isStandalone() {
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || navigator.standalone);
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
  return Boolean(window.matchMedia?.('(pointer: coarse)').matches || /android|iphone|ipad|ipod/i.test(navigator.userAgent));
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function fullscreenAvailable() {
  return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled || document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
}

async function toggleFullscreen() {
  try {
    if (fullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) await exit.call(document);
      try { screen.orientation?.unlock?.(); } catch { /* no-op */ }
      return;
    }
    const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    if (!request) throw new Error('unsupported');
    await request.call(document.documentElement, {navigationUI: 'hide'});
    try { await screen.orientation?.lock?.('landscape'); } catch { /* Orientation lock is optional. */ }
  } catch {
    ui.modal = 'install';
    renderModal();
  }
}

async function enterImmersiveMode() {
  if (!isMobileDevice()) return;
  try {
    if (!fullscreenElement()) {
      const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      if (request) await request.call(document.documentElement, {navigationUI: 'hide'});
    }
  } catch { /* Installed mode and iOS use the manifest fullscreen shell. */ }
  try { await screen.orientation?.lock?.('landscape'); } catch { /* The portrait shield remains the fallback. */ }
}

async function installApp() {
  if (deferredInstallPrompt) {
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await prompt.prompt();
    await prompt.userChoice.catch(() => null);
    queueRender();
    return;
  }
  ui.modal = 'install';
  renderModal();
}

function registerPwa() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  navigator.serviceWorker.register('./sw.js', {scope: './'}).catch(() => {
    /* Installation is an enhancement; the live game still works without it. */
  });
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  queueRender();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  toast('Moonfall is installed. Open it from your home screen.', 'success');
  queueRender();
});

document.addEventListener('fullscreenchange', () => {
  if (ui.modal === 'menu') renderModal();
});

document.addEventListener('webkitfullscreenchange', () => {
  if (ui.modal === 'menu') renderModal();
});

function clearNetworkTimers() {
  clearInterval(beaconTimer);
  clearInterval(healthTimer);
  clearTimeout(reconnectTimer);
  helloTimers.forEach(clearTimeout);
  beaconTimer = null;
  healthTimer = null;
  reconnectTimer = null;
  helloTimers = [];
}

function scheduleNetworkRestart(delay = RECONNECT_DELAY_MS) {
  if (!mode || !roomCode || document.visibilityState !== 'visible' || navigator.onLine === false || reconnectTimer) return;
  connectionState = 'connecting';
  diagnostic('recovery-scheduled', {delay});
  queueRender();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!mode || !roomCode || document.visibilityState !== 'visible') return;
    if (mode === 'coordinator') {
      diagnostic('host-beacon-recovery');
      connectionState = 'connected';
      sendHostBeacon();
    } else {
      diagnostic('guest-relay-recovery');
      hostPeerId = null;
      scheduleHelloBursts();
    }
    queueRender();
  }, delay);
}

function recoverVisibleSession() {
  const awayFor = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = null;
  holdWakeLock();
  if (!mode) return;
  if (awayFor > 1500 || connectionState === 'offline') {
    scheduleNetworkRestart(100);
  } else if (mode === 'coordinator') {
    sendHostBeacon();
  } else if (connectionState === 'connected' && hostPeerId && net) {
    net.sendHello({...identity, code: roomCode}, hostPeerId);
  } else {
    scheduleHelloBursts();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    wakeLock = null;
    diagnostic('visibility-hidden');
    return;
  }
  diagnostic('visibility-visible', {awayMs: hiddenAt ? Date.now() - hiddenAt : 0});
  recoverVisibleSession();
});

window.addEventListener('pageshow', event => {
  if (event.persisted) recoverVisibleSession();
});

window.addEventListener('offline', () => {
  if (!mode) return;
  connectionState = 'offline';
  diagnostic('browser-offline');
  queueRender();
});

window.addEventListener('online', () => {
  diagnostic('browser-online');
  scheduleNetworkRestart(100);
});

document.addEventListener('pointerdown', () => {
  if (mode && !wakeLock) holdWakeLock();
}, {passive: true});

let lastWakePulseKey = null;

// Deliberately empty: private haptics can be heard or felt across a table and
// become a role/timing side channel. The narrator alone calls each wake.
function updateHaptics(view) {
  void view;
}

function phaseChanged(view) {
  if (!view || ui.previousPhase === view.phase) return;
  const previous = ui.previousPhase;
  ui.transitionFrom = previous;
  ui.previousPhase = view.phase;
  ui.roleFaceUp = false;
  ui.thiefRevealed = false;
  ui.seerFlipped = false;
  ui.loverFlipped = false;
  ui.cupidChoices = [];
  ui.witchHeal = Boolean(view.privateAction?.draft?.heal);
  ui.witchPoisonTarget = view.privateAction?.draft?.poisonTarget || null;
  ui.poisonOpen = false;
  ui.cupidLoosed = false;
  ui.sceneBusy = null;
  ui.whisperOpen = false;
  ui.headerOpen = false;
  document.body.dataset.phase = view.phase;
  document.body.dataset.outcome = view.winner?.team || '';
  ui.phaseFresh = true;
  updateAmbience(view);
  if (view.phase === 'role-reveal' && isTableVoice(view) && voiceEnabled && voicePackReady()) {
    warmVoicePack(unlockAudio(true));
  }
  if (previous) {
    transitionSound(view, previous);
    const fx = phaseFxFor(view, previous);
    if (fx) playPhaseFx(fx);
  }
  scheduleNarratorAutomation();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

async function setupNetwork(code) {
  const generation = ++networkGeneration;
  clearNetworkTimers();
  const previousRoom = room;
  room = null;
  net = null;
  if (previousRoom) {
    diagnostic('room-leave-start');
    roomLeavePromise = Promise.resolve(previousRoom.leave()).catch(() => {});
  }
  if (roomLeavePromise) {
    await roomLeavePromise;
    roomLeavePromise = null;
    diagnostic('room-leave-complete');
  }
  if (generation !== networkGeneration || !mode) return;
  roomCode = code;
  hostPeerId = mode === 'coordinator' ? selfId : null;
  hostEpoch = mode === 'coordinator' ? randomToken(12) : null;
  peerToSeat = new Map();
  seatToPeer = new Map();
  connectionState = 'connecting';
  networkStartedAt = Date.now();
  lastHostSignalAt = mode === 'coordinator' ? networkStartedAt : 0;
  diagnostic('room-join-start', {mode, generation});
  room = joinRoom({appId: APP_ID, password: `moonfall:${code}`, relayRedundancy: RELAY_REDUNDANCY}, code, error => {
    if (generation !== networkGeneration) return;
    console.error('Room join failed', error);
    connectionState = 'offline';
    diagnostic('room-join-error', {message: String(error?.message || error)});
    toast('The village could not reach the peer network. Check the internet connection.', 'error');
    queueRender();
  });
  const [sendHost, receiveHost] = room.makeAction('mfhost');
  const [sendHello, receiveHello] = room.makeAction('mfhello');
  const [sendView, receiveView] = room.makeAction('mfview');
  const [sendCommand, receiveCommand] = room.makeAction('mfcmd');
  const [sendNotice, receiveNotice] = room.makeAction('mfnotice');
  net = {sendHost, sendHello, sendView, sendCommand, sendNotice};

  receiveHost((data, peerId) => {
    if (generation !== networkGeneration || mode !== 'guest' || data?.code !== roomCode) return;
    if (hostPeerId && hostPeerId !== peerId && data.epoch !== hostEpoch && Date.now() - lastHostSignalAt < 5000) return;
    const needsResync = connectionState !== 'connected' || hostPeerId !== peerId || hostEpoch !== data.epoch;
    hostPeerId = peerId;
    hostEpoch = data.epoch;
    lastHostSignalAt = Date.now();
    diagnostic('host-signal', {peerId, resync: needsResync, revision: data.revision});
    if (connectionState !== 'connected') connectionState = 'connecting';
    if (needsResync) sendHello({...identity, code: roomCode}, peerId);
    if (connectionState !== 'connected') queueRender();
  });

  receiveHello((data, peerId) => {
    if (generation !== networkGeneration || mode !== 'coordinator') return;
    acceptHello(data, peerId);
  });

  receiveView((data, peerId) => {
    if (generation !== networkGeneration || mode !== 'guest' || peerId !== hostPeerId || !data?.me) return;
    currentView = data;
    lastHostSignalAt = Date.now();
    connectionState = 'connected';
    diagnostic('view-received', {peerId, revision: data.revision, phase: data.phase});
    phaseChanged(currentView);
    queueRender();
  });

  receiveCommand((data, peerId) => {
    if (generation !== networkGeneration || mode !== 'coordinator') return;
    handleRemoteCommand(data, peerId);
  });

  receiveNotice((data, peerId) => {
    if (generation !== networkGeneration || mode !== 'guest' || peerId !== hostPeerId) return;
    toast(data?.text, data?.type || '');
  });

  room.onPeerJoin(peerId => {
    if (generation !== networkGeneration) return;
    diagnostic('peer-joined', {peerId});
    if (mode === 'coordinator') {
      sendHostBeacon(peerId);
    } else {
      net.sendHello({...identity, code: roomCode}, peerId);
    }
  });

  room.onPeerLeave(peerId => {
    if (generation !== networkGeneration) return;
    diagnostic('peer-left', {peerId, wasHost: peerId === hostPeerId});
    if (mode === 'coordinator') {
      const seatId = peerToSeat.get(peerId);
      peerToSeat.delete(peerId);
      if (seatId && serverState?.players[seatId]) {
        seatToPeer.delete(seatId);
        serverState.players[seatId].connected = false;
        serverState.players[seatId].peerId = null;
        serverState.revision += 1;
        persistAndBroadcast();
      }
    } else if (peerId === hostPeerId) {
      connectionState = 'offline';
      hostPeerId = null;
      toast('The host phone disconnected. The game will return when it reconnects.', 'error');
      scheduleHelloBursts();
      queueRender();
    }
  });

  if (mode === 'coordinator') {
    sendHostBeacon();
    beaconTimer = setInterval(() => sendHostBeacon(), 2800);
    connectionState = 'connected';
  } else {
    scheduleHelloBursts();
  }
  healthTimer = setInterval(() => {
    if (generation !== networkGeneration || !mode || document.visibilityState !== 'visible') return;
    if (navigator.onLine === false) {
      connectionState = 'offline';
      queueRender();
      return;
    }
    if (mode === 'guest' && Date.now() - (lastHostSignalAt || networkStartedAt) > STALE_CONNECTION_MS) {
      connectionState = 'offline';
      diagnostic('host-signal-stale', {staleMs: Date.now() - (lastHostSignalAt || networkStartedAt)});
      queueRender();
      scheduleNetworkRestart(100);
    }
  }, 3500);
}

function sendHostBeacon(target = undefined) {
  if (mode !== 'coordinator' || !net) return;
  net.sendHost({code: roomCode, epoch: hostEpoch, revision: serverState?.revision || 0}, target);
}

function scheduleHelloBursts() {
  helloTimers.forEach(clearTimeout);
  helloTimers = [200, 900, 2200, 5000, 10000, 18000].map(delay => setTimeout(() => {
    if (mode === 'guest' && net) net.sendHello({...identity, code: roomCode}, hostPeerId || undefined);
  }, delay));
}

function uniquePlayerName(requested, seatId) {
  const base = String(requested || 'Villager').trim().slice(0, 24) || 'Villager';
  const taken = new Set(Object.values(serverState.players).filter(player => player.id !== seatId).map(player => player.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`.toLowerCase())) index += 1;
  return `${base} ${index}`.slice(0, 24);
}

function acceptHello(data, peerId) {
  if (!data?.seatId || !data?.seatKey || data.code !== roomCode) return;
  let player = serverState.players[data.seatId];
  if (player && player.seatKey !== data.seatKey) {
    net.sendNotice({text: 'That saved seat belongs to another device. Rejoin with a fresh link.', type: 'error'}, peerId);
    return;
  }
  if (!player) {
    if (serverState.phase !== 'lobby') {
      net.sendNotice({text: 'This tale has already begun. Only existing players can reconnect.', type: 'error'}, peerId);
      return;
    }
    if (Object.keys(serverState.players).length >= MAX_PEOPLE) {
      net.sendNotice({text: 'This village is full.', type: 'error'}, peerId);
      return;
    }
    const name = uniquePlayerName(data.name, data.seatId);
    player = serverState.players[data.seatId] = {
      id: data.seatId,
      seatKey: data.seatKey,
      name,
      connected: true,
      peerId,
      joinedAt: Date.now(),
      alive: true,
      role: null,
      ready: false
    };
    serverState.revision += 1;
    toast(`${name} entered the village.`, 'success');
  } else {
    player.connected = true;
    player.peerId = peerId;
    if (serverState.phase === 'lobby') player.name = uniquePlayerName(data.name || player.name, data.seatId);
  }
  const oldPeer = seatToPeer.get(data.seatId);
  if (oldPeer && oldPeer !== peerId) peerToSeat.delete(oldPeer);
  peerToSeat.set(peerId, data.seatId);
  seatToPeer.set(data.seatId, peerId);
  diagnostic('seat-synchronised', {peerId, seatId: data.seatId});
  net.sendNotice({text: `Joined room ${roomCode}`, type: 'success'}, peerId);
  persistAndBroadcast();
}

function validateRemote(data, peerId) {
  const seatId = peerToSeat.get(peerId);
  if (!seatId || seatId !== data?.seatId) return null;
  const player = serverState.players[seatId];
  if (!player || player.seatKey !== data.seatKey) return null;
  return seatId;
}

function handleRemoteCommand(data, peerId) {
  const seatId = validateRemote(data, peerId);
  if (!seatId) return;
  if (data.commandId) {
    if (recentCommandIds.has(data.commandId)) return;
    recentCommandIds.set(data.commandId, Date.now());
    if (recentCommandIds.size > 240) {
      for (const key of [...recentCommandIds.keys()].slice(0, 120)) recentCommandIds.delete(key);
    }
  }
  const result = processCommand(seatId, data.type, data.payload || {});
  if (!result.ok) net.sendNotice({text: result.error, type: 'error'}, peerId);
  else if (result.message) net.sendNotice({text: result.message, type: 'success'}, peerId);
}

function processCommand(actorId, type, payload = {}) {
  let result = {ok: false, error: 'That action is not available.'};
  const coordinator = isCoordinator(serverState, actorId);
  if (type.startsWith('player:')) {
    result = applyPlayerCommand(serverState, actorId, type.slice(7), payload);
  }
  if (coordinator) {
    if (type === 'auto:unlock') result = narratorUnlock(serverState);
    if (type === 'auto:advance') result = storytellerAdvance(serverState);
    if (type === 'auto:dawn') result = advanceFromDawn(serverState);
    if (type === 'auto:next-night') result = nextNight(serverState);
    if (type === 'host:settings') result = updateSettings(serverState, payload);
    if (type === 'host:preset') result = setPreset(serverState, payload.preset) ? {ok: true} : result;
    if (type === 'host:start') result = startGame(serverState, agentTest ? () => 0 : Math.random);
    if (type === 'host:next-round') result = startNextRound(serverState, agentTest ? () => 0 : Math.random);
    if (type === 'host:between-rounds') { resetToLobby(serverState, {preserveSession: true}); result = {ok: true}; }
    if (type === 'host:end-session') result = endSession(serverState);
    if (type === 'host:clear-session') { resetToLobby(serverState); result = {ok: true}; }
    if (type === 'host:reset') { resetToLobby(serverState); result = {ok: true}; }
    if (type === 'host:remove') result = removePlayer(payload.seatId);
  }
  if (result.ok) persistAndBroadcast();
  return result;
}

function removePlayer(seatId) {
  if (serverState.phase !== 'lobby') return {ok: false, error: 'Players cannot be removed after the cards are dealt.'};
  if (!serverState.players[seatId] || seatId === serverState.coordinatorId) return {ok: false, error: 'That seat cannot be removed.'};
  const peerId = seatToPeer.get(seatId);
  if (peerId) net.sendNotice({text: 'The host removed this seat from the lobby.', type: 'error'}, peerId);
  delete serverState.players[seatId];
  seatToPeer.delete(seatId);
  if (peerId) peerToSeat.delete(peerId);
  serverState.revision += 1;
  return {ok: true};
}

function sendOwnCommand(type, payload = {}) {
  if (!identity) return;
  if (mode === 'coordinator') {
    diagnostic('command-local', {command: type});
    const result = processCommand(identity.seatId, type, payload);
    if (!result.ok) toast(result.error, 'error');
    if (result.message) toast(result.message, 'success');
  } else if (hostPeerId && net && connectionState === 'connected') {
    diagnostic('command-sent', {command: type, peerId: hostPeerId});
    net.sendCommand({seatId: identity.seatId, seatKey: identity.seatKey, commandId: randomToken(10), type, payload}, hostPeerId);
  } else {
    diagnostic('command-blocked', {command: type, connectionState});
    toast('Reconnecting to the host. Your choice was not sent—tap it again when the link turns green.', 'error');
    scheduleNetworkRestart(100);
  }
}

function persistAndBroadcast() {
  if (mode !== 'coordinator' || !serverState) return;
  persistHost();
  currentView = viewFor(serverState, identity.seatId, {coordinator: true});
  phaseChanged(currentView);
  scheduleNarratorAutomation();
  if (!agentTest && net) {
    for (const [seatId, peerId] of seatToPeer.entries()) {
      if (serverState.players[seatId]?.connected) net.sendView(viewFor(serverState, seatId), peerId);
    }
  }
  queueRender();
}

async function createVillage(name) {
  if (!name.trim()) return toast('Give the host seat a name first.', 'error');
  mode = 'coordinator';
  roomCode = randomCode();
  identity = seatIdentity(roomCode, name.trim().slice(0, 24));
  safeWrite(NAME_KEY, identity.name);
  serverState = makeState({roomCode, coordinatorId: identity.seatId, coordinatorName: identity.name});
  serverState.players[identity.seatId].seatKey = identity.seatKey;
  serverState.players[identity.seatId].peerId = selfId;
  currentView = viewFor(serverState, identity.seatId, {coordinator: true});
  setupNetwork(roomCode);
  holdWakeLock();
  persistAndBroadcast();
  history.replaceState(null, '', `${location.pathname}?room=${roomCode}`);
}

function runTestAgents() {
  if (!agentTest || !serverState || !identity || ['lobby', 'game-over', 'session-over'].includes(serverState.phase)) return;
  const botIds = Object.keys(serverState.players).filter(id => id.startsWith('test-agent-'));
  for (const botId of botIds) {
    const view = viewFor(serverState, botId);
    const action = view.privateAction || {};
    const actionKey = JSON.stringify([view.phaseSerial, view.phaseReady, view.phase, view.me.seenRole, action]);
    if (agentActionKeys.get(botId) === actionKey) continue;
    agentActionKeys.set(botId, actionKey);
    const candidates = Object.values(view.players).filter(player => player.alive && !player.storyteller && player.id !== botId).map(player => player.id);
    let command = null;
    let payload = {};
    if (view.phase === 'role-reveal' && !view.me.seenRole) command = 'player:seen-role';
    else if (action.done) continue;
    else if (action.type === 'cupid') { command = 'player:cupid-choose'; payload = {choices: candidates.slice(0, 2)}; }
    else if (action.type === 'lover') command = 'player:lovers-seen';
    else if (action.type === 'seer' && !action.target) { command = 'player:seer-choose'; payload = {target: candidates[0]}; }
    else if (action.type === 'seer') command = 'player:seer-done';
    else if (action.type === 'werewolf') {
      const blocked = new Set([botId, ...(action.teammates || [])]);
      const target = Object.values(view.players).find(player => player.alive && !player.storyteller && !blocked.has(player.id))?.id;
      if (target) { command = 'player:wolf-vote'; payload = {target}; }
    } else if (action.type === 'witch') { command = 'player:witch-submit'; payload = {heal: false, poisonTarget: null}; }
    else if (action.type === 'discussion' && !action.ready) { command = 'player:day-ready'; payload = {ready: true}; }
    else if (action.type === 'vote') { command = 'player:cast-vote'; payload = {target: action.candidates.find(id => id !== botId && id !== view.me.loverId)}; }
    else if (action.type === 'hunter' || action.type === 'sheriff-successor') { command = 'player:resolve-pending'; payload = {target: action.candidates.find(id => id !== botId) || null}; }
    if (command) {
      setTimeout(() => {
        if (!agentTest || !serverState?.players[botId]) return;
        processCommand(botId, command, payload);
      }, 280 + botIds.indexOf(botId) * 110);
    }
  }
}

function startAgentTest(name) {
  const playerName = name.trim().slice(0, 24) || safeRead(NAME_KEY, '') || 'Steven';
  mode = 'coordinator';
  agentTest = true;
  room = null;
  net = null;
  peerToSeat = new Map();
  seatToPeer = new Map();
  roomCode = 'AGENTS';
  identity = seatIdentity(roomCode, playerName);
  safeWrite(NAME_KEY, identity.name);
  serverState = makeState({roomCode, coordinatorId: identity.seatId, coordinatorName: identity.name});
  serverState.players[identity.seatId].seatKey = identity.seatKey;
  const names = ['Agent Rowan', 'Agent Lyra', 'Agent Fen', 'Agent Mara', 'Agent Orin'];
  names.forEach((agentName, index) => {
    const id = `test-agent-${index + 1}`;
    serverState.players[id] = {id, seatKey: `local-${index + 1}`, name: agentName, connected: true, peerId: null, joinedAt: Date.now() + index, alive: true, role: null, ready: false};
  });
  setPreset(serverState, 'classic');
  const result = startGame(serverState, () => 0);
  if (!result.ok) {
    agentTest = false;
    mode = null;
    return toast(result.error, 'error');
  }
  currentView = viewFor(serverState, identity.seatId, {coordinator: true});
  connectionState = 'connected';
  ui.previousPhase = 'lobby';
  holdWakeLock();
  clearInterval(agentTimer);
  agentActionKeys.clear();
  agentTimer = setInterval(runTestAgents, 650);
  runTestAgents();
  history.replaceState(null, '', location.pathname);
  diagnostic('agent-test-started');
  phaseChanged(currentView);
  scheduleNarratorAutomation();
  queueRender();
}

async function joinVillage(name, code) {
  const cleaned = cleanCode(code);
  if (!name.trim()) return toast('Add your name first.', 'error');
  if (cleaned.length !== 6) return toast('Enter the six-character village code.', 'error');
  mode = 'guest';
  identity = seatIdentity(cleaned, name.trim().slice(0, 24));
  safeWrite(NAME_KEY, identity.name);
  currentView = null;
  setupNetwork(cleaned);
  holdWakeLock();
  history.replaceState(null, '', `${location.pathname}?room=${cleaned}`);
  queueRender();
}

function resumeVillage(code) {
  const restored = safeRead(`${HOST_STATE_PREFIX}${code}`);
  if (!restored?.coordinatorId || !restored?.players?.[restored.coordinatorId]) {
    safeRemove(LAST_HOST_KEY);
    return toast('That saved village could not be restored.', 'error');
  }
  const upgradedFromStoryteller = Number(restored.schema || 0) < 3;
  if (upgradedFromStoryteller) resetToLobby(restored);
  upgradeState(restored);
  restored.actions.dayReady ||= {};
  restored.phaseReady = typeof restored.phaseReady === 'boolean' ? restored.phaseReady : restored.phase === 'lobby';
  restored.phaseSerial = Number(restored.phaseSerial || 0);
  mode = 'coordinator';
  serverState = restored;
  roomCode = restored.roomCode;
  const hostPlayer = restored.players[restored.coordinatorId];
  identity = {seatId: restored.coordinatorId, seatKey: hostPlayer.seatKey, name: hostPlayer.name};
  hostPlayer.connected = true;
  hostPlayer.peerId = selfId;
  for (const [id, player] of Object.entries(restored.players)) if (id !== restored.coordinatorId) {
    player.connected = false;
    player.peerId = null;
  }
  currentView = viewFor(serverState, identity.seatId, {coordinator: true});
  setupNetwork(roomCode);
  holdWakeLock();
  persistAndBroadcast();
  history.replaceState(null, '', `${location.pathname}?room=${roomCode}`);
  toast(upgradedFromStoryteller ? 'Moonfall was upgraded. Everyone now plays; gather the village and deal again.' : 'The village has been restored. Other players can reconnect.', 'success');
}

function leaveToHome() {
  const previousRoom = room;
  room = null;
  if (previousRoom) roomLeavePromise = Promise.resolve(previousRoom.leave()).catch(() => {});
  networkGeneration += 1;
  clearNetworkTimers();
  net = null;
  peerToSeat = new Map();
  seatToPeer = new Map();
  mode = null;
  serverState = null;
  currentView = null;
  identity = null;
  hostPeerId = null;
  connectionState = 'idle';
  agentTest = false;
  clearInterval(agentTimer);
  agentTimer = null;
  agentActionKeys.clear();
  hiddenAt = null;
  lastHostSignalAt = 0;
  releaseWakeLock();
  stopNarration();
  stopVoicePack();
  stopAmbience();

  lastWakePulseKey = null;
  seenInSquare.clear();
  squareShownFor = null;
  clearTimeout(arrivalTimer);
  narratorAutomationGeneration += 1;
  narratorAutomationKey = null;
  recentCommandIds.clear();
  ui.previousPhase = null;
  ui.transitionFrom = null;
  document.body.dataset.phase = 'home';
  history.replaceState(null, '', location.pathname);
  queueRender();
}

function connectionMarkup() {
  const offline = connectionState === 'offline';
  const text = connectionState === 'connected' ? 'Linked' : connectionState === 'connecting' ? 'Finding host' : offline ? 'Host away' : 'Local';
  return `<span class="connection ${offline ? 'offline' : ''}"><i></i>${text}</span>`;
}

// The header lives in a small floating tab: a glance shows the connection
// dot; a tap unfolds name, seat, room code and the menu.
function gameHeader(view) {
  const me = view.me;
  const subtitle = me?.storyteller ? 'Storyteller' : me?.alive === false ? 'Silent spirit' : me?.sheriff ? 'Sheriff of the village' : 'Villager of Moonfall';
  return `<header class="top-dock ${ui.headerOpen ? 'open' : ''}">
    <button class="top-tab" data-action="toggle-header" aria-expanded="${ui.headerOpen ? 'true' : 'false'}" aria-label="Player and connection details"><span class="connection-dot ${connectionState === 'offline' ? 'offline' : ''}"></span><b>☾</b></button>
    <div class="top-sheet">
      <img class="mini-mark" src="assets/card-back.webp" alt="">
      <div class="top-copy"><strong>${esc(me?.name || 'Moonfall')}</strong><span>${esc(subtitle)} · ${esc(view.roomCode)}</span></div>
      ${connectionMarkup()}
      <button class="icon-btn" data-action="open-menu" aria-label="Open menu">⋯</button>
    </div>
  </header>`;
}

function phaseHeader(view, override = null) {
  const [title, subtitle] = PHASE_META[view.phase] || ['Moonfall', 'The tale continues.'];
  const moonLabel = view.phase.startsWith('night') || view.phase.startsWith('setup') || view.phase === 'role-reveal'
    ? `☾ Night ${Math.max(1, view.night)}`
    : view.phase === 'lobby' ? 'The gathering' : `☼ Day ${Math.max(1, view.day)}`;
  return `<div class="phase-ribbon">
    <span class="moon-number">${moonLabel}</span>
    <h1>${esc(override?.title || title)}</h1>
    <p>${esc(override?.subtitle || subtitle)}</p>
  </div>`;
}

function dock(button, secondary = '') {
  return `<div class="dock">${secondary}${button}</div>`;
}

// ── The landscape stage ──────────────────────────────────────────────────
// In-game screens are built around the town square: a compact phase strip
// top-left, a narrow contextual rail on the right, one action dock at the
// bottom. The crowd in the middle IS the interface; instructions live in
// the narrator's voice, not on the screen.
function stageStrip(view, override = null) {
  const [title] = PHASE_META[view.phase] || ['Moonfall', ''];
  const moonLabel = view.phase.startsWith('night') || view.phase.startsWith('setup') || view.phase === 'role-reveal' || view.phase === 'resolution'
    ? `☾ Night ${Math.max(1, view.night)}`
    : view.phase === 'lobby' ? '☾ The gathering' : `☼ Day ${Math.max(1, view.day)}`;
  return `<div class="phase-ribbon strip"><span class="moon-number">${moonLabel}</span><h1>${esc(override || title)}</h1></div>`;
}

function stageScreen(view, {title = undefined, rail = '', foot = '', extra = '', cls = ''} = {}) {
  return `<section class="screen stage-screen ${cls}">
    ${gameHeader(view)}
    ${title === null ? '' : stageStrip(view, title)}
    ${rail ? `<div class="stage-rail">${rail}</div>` : ''}
    ${foot ? `<div class="stage-foot">${foot}</div>` : ''}
    ${extra}
  </section>`;
}

// The narrator made visible: the storyteller character speaks, the village
// listens. Replaces the abstract orb.
function narratorStage(view, title) {
  return `<section class="screen stage-screen">${gameHeader(view)}
    <div class="storyteller-stage">
      <div class="storyteller-mark"><img src="assets/storyteller.webp" alt="The storyteller"></div>
      <div class="narrator-orb mini"><i></i><i></i><i></i></div>
      <h1 class="storyteller-title">${esc(title)}</h1>
    </div>
  </section>`;
}

// Which characters in the square are tappable right now, and what a tap
// means. One mapping shared by the render pass and the tap handler.
function squareSelection(view) {
  if (!view || view.phaseReady === false || !view.me) return null;
  const action = view.privateAction || {};
  if (action.done) return null;
  const living = filter => Object.values(view.players).filter(player => player.alive && !player.storyteller && (!filter || filter(player))).map(player => player.id);
  if (action.type === 'cupid') {
    return {ids: new Set(living()), selected: ui.cupidChoices, action: 'choose-cupid'};
  }
  if (action.type === 'seer' && !action.target) {
    return {ids: new Set(living(player => player.id !== view.me.id)), selected: [], action: 'seer-choose'};
  }
  if (action.type === 'werewolf') {
    const wolves = new Set([view.me.id, ...(action.teammates || [])]);
    const marks = {};
    for (const target of Object.values(action.votes || {})) if (target) marks[target] = (marks[target] || 0) + 1;
    const mine = action.votes?.[view.me.id];
    return {ids: new Set(living(player => !wolves.has(player.id))), selected: mine ? [mine] : [], marks, action: 'wolf-vote'};
  }
  if (action.type === 'witch') {
    const poisonOpen = ui.poisonOpen || Boolean(ui.witchPoisonTarget);
    return {
      ids: new Set(poisonOpen ? living() : []),
      selected: ui.witchPoisonTarget ? [ui.witchPoisonTarget] : [],
      victim: action.victim || null,
      action: 'choose-poison'
    };
  }
  if (action.type === 'vote') {
    const disabled = new Set(!action.election && view.me.loverId ? [view.me.loverId] : []);
    const ids = (action.candidates || []).filter(id => view.players[id]?.alive && !view.players[id].storyteller && !disabled.has(id));
    return {ids: new Set(ids), selected: action.choice ? [action.choice] : [], disabled, action: 'cast-vote'};
  }
  if (action.type === 'hunter' || action.type === 'sheriff-successor') {
    const ids = (action.candidates || []).filter(id => id !== view.me.id && view.players[id]?.alive);
    return {ids: new Set(ids), selected: [], action: 'resolve-pending'};
  }
  return null;
}

function playerStatusText(player, view) {
  if (player.storyteller) return 'Storyteller';
  if (!player.alive) return player.role ? `Fallen ${ROLES[player.role]?.name || 'Villager'}` : 'Fallen';
  if (player.sheriff) return 'Sheriff · vote counts twice';
  if (view.phase === 'role-reveal') return player.ready ? 'Card sealed' : 'Learning their fate';
  return player.connected ? 'In the village' : 'Reconnecting…';
}

function playerList(view, {kickable = false, reveal = false} = {}) {
  return `<div class="player-list">${Object.values(view.players).map(player => {
    const badges = [
      player.storyteller ? '<span class="status-icon" title="Storyteller">☾</span>' : '',
      player.sheriff ? '<span class="status-icon" title="Sheriff">✹</span>' : '',
      !player.connected ? '<span class="status-icon" title="Disconnected">⌁</span>' : '',
      player.ready ? '<span class="status-icon" title="Ready">✓</span>' : ''
    ].join('');
    const role = reveal && player.role ? ` · ${ROLES[player.role]?.name || player.role}` : '';
    return `<div class="player-row ${player.alive ? '' : 'dead'}">
      <span class="avatar">${esc(initials(player.name))}</span>
      <span class="info"><strong>${esc(player.name)}</strong><span>${esc(playerStatusText(player, view))}${esc(role)}</span></span>
      <span class="status-icons">${badges}</span>
      ${kickable && player.id !== view.me.id ? `<button class="kick" data-action="remove-player" data-id="${esc(player.id)}" aria-label="Remove ${esc(player.name)}">×</button>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function roleCard(roleId, flipped, {label = true, tapAction = 'flip-role', dealt = false} = {}) {
  const role = ROLES[roleId] || ROLES.villager;
  return `<div class="flip-wrap ${dealt ? 'dealt' : ''}">
    <button class="flip-card ${flipped ? 'flipped' : ''}" data-action="${esc(tapAction)}" aria-label="${flipped ? `Hide ${esc(role.name)} card` : 'Reveal secret card'}">
      <span class="card-face back"><img src="assets/card-back.webp" alt="Face-down Moonfall card"></span>
      <span class="card-face front"><img src="${esc(role.image)}" alt="${esc(role.name)} card">${label ? `<span class="card-title-overlay"><strong>${esc(role.name)}</strong><span>${esc(role.rule)}</span></span>` : ''}</span>
    </button>
  </div>`;
}

function renderHome() {
  const queryCode = cleanCode(new URLSearchParams(location.search).get('room') || '');
  const lastName = safeRead(NAME_KEY, '');
  const lastHost = safeRead(LAST_HOST_KEY);
  const restorable = lastHost?.code && safeRead(`${HOST_STATE_PREFIX}${lastHost.code}`);
  app.innerHTML = `<section class="screen home home-clean">
    <nav class="home-tools" aria-label="Moonfall help and settings"><button class="home-tool" data-action="show-rules" aria-label="Read the rules"><span>?</span><small>Rules</small></button><button class="home-tool" data-action="show-settings" aria-label="Open settings"><span>⚙</span><small>Settings</small></button></nav>
    <div class="brand-lockup"><img src="assets/logo.webp" alt="Moonfall"><p>Everyone plays. The narrator runs the night.</p></div>
    <div>
      ${restorable ? `<div class="resume-banner"><div><strong>Village ${esc(lastHost.code)} is sleeping</strong><span class="small muted">Resume the ${esc(String(lastHost.phase).replaceAll('-', ' '))}.</span></div><button class="btn mini secondary" data-action="resume-room" data-code="${esc(lastHost.code)}">Resume</button></div>` : ''}
      <div class="panel ornate">
        <div class="tabs"><button class="tab ${ui.homeTab === 'create' ? 'active' : ''}" data-action="home-tab" data-tab="create">Create village</button><button class="tab ${ui.homeTab === 'join' ? 'active' : ''}" data-action="home-tab" data-tab="join">Join with code</button></div>
        ${ui.homeTab === 'create' ? `<div class="eyebrow">Your phone holds the room</div><h2>Call the village</h2>
          <div class="field"><label for="create-name">Your name</label><input class="input" id="create-name" maxlength="24" autocomplete="nickname" placeholder="Steven" value="${esc(lastName)}"></div>
          <button class="btn wide" data-action="create-room">Create a new game</button>` : `<div class="eyebrow">Enter the moonlit room</div><h2>Join the tale</h2><p class="muted">Use the six-character code shown on the host phone.</p>
          <div class="field"><label for="join-name">Your name</label><input class="input" id="join-name" maxlength="24" autocomplete="nickname" placeholder="Your name" value="${esc(lastName)}"></div>
          <div class="field"><label for="join-code">Village code</label><input class="input code-input" id="join-code" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="MOON42" value="${esc(queryCode)}"></div>
          <button class="btn wide" data-action="join-room">Enter the village</button>`}
      </div>
      <div class="home-quick"><button data-action="start-agent-test"><span>✦</span><strong>Practice</strong></button>${!isStandalone() && isMobileDevice() ? '<button data-action="install-app"><span>▣</span><strong>Install app</strong></button>' : ''}</div>
    </div>
  </section>`;
}

function renderConnecting() {
  app.innerHTML = `<section class="screen centered">
    <div class="panel ornate center"><div class="eyebrow">Village ${esc(roomCode)}</div><div class="moon-loader"><span></span></div><h2 style="margin-top:20px">Following the lanterns…</h2><p class="muted">Looking for the host phone. Check the code and make sure their Moonfall screen remains open.</p><button class="btn ghost wide" data-action="leave-game">Cancel</button></div>
  </section>`;
}

// The lobby IS the village: characters walk into the square as their owners
// join. The invite sits top-left, the host's deck controls in the right
// rail, and everyone watches the crowd assemble in the middle.
function renderLobby(view) {
  const deck = view.lobbyDeck;
  const isHost = view.coordinator;
  const pack = view.settings.preset;
  const selectedRoles = view.settings.roles;
  const count = Object.keys(view.players).length;
  const deckParts = [`${deck.wolves}× ${deck.wolves === 1 ? 'Werewolf' : 'Werewolves'}`, ...deck.specials.map(id => ROLES[id].name), deck.villagers ? `${deck.villagers}× Villager${deck.villagers === 1 ? '' : 's'}` : ''].filter(Boolean);
  const invite = `<div class="lobby-invite panel ornate">
    <div class="room-code">${esc(view.roomCode)}</div>
    <div class="qr-wrap" aria-label="QR code that joins village ${esc(view.roomCode)}">${inviteQrSvg()}</div>
    <p class="muted tiny center" style="margin:6px 0 8px">${count} of ${MAX_PEOPLE} places</p>
    <div class="button-row"><button class="btn mini secondary" data-action="copy-code">Copy</button><button class="btn mini ghost" data-action="share-room">Share</button></div>
  </div>`;
  const rail = isHost ? `
    <div class="pack-grid">${Object.entries(PRESETS).map(([id, item]) => `<button class="pack-option ${pack === id ? 'active' : ''}" data-action="set-preset" data-preset="${id}"><span>${id === 'first' ? '☽' : id === 'classic' ? '◐' : '●'}</span><strong>${esc(item.name)}</strong><small>${item.roles.length} special</small></button>`).join('')}</div>
    <div class="role-toggles">${SPECIAL_ROLE_IDS.map(id => `<button class="role-toggle ${selectedRoles.includes(id) ? 'active' : ''}" data-action="toggle-role" data-role="${id}"><img src="${ROLES[id].image}" alt=""><span>${esc(ROLES[id].name)}</span></button>`).join('')}</div>
    <div class="button-row"><label class="field" style="margin:0;flex:1"><span class="tiny muted">Werewolves</span><select class="input" id="wolf-setting"><option value="auto" ${view.settings.wolves === 'auto' ? 'selected' : ''}>Auto</option>${[1,2,3,4].map(n => `<option value="${n}" ${Number(view.settings.wolves) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="field" style="margin:0;flex:1"><span class="tiny muted">Sheriff</span><select class="input" id="sheriff-setting"><option value="true" ${view.settings.sheriff ? 'selected' : ''}>Yes</option><option value="false" ${!view.settings.sheriff ? 'selected' : ''}>No</option></select></label></div>
    <div class="deck-line ${deck.valid ? '' : 'error'}">${deck.valid ? deckParts.join(' · ') : count < 6 ? 'At least six players are needed.' : 'Too many special roles for this village.'}</div>
    <details class="ledger"><summary>Manage the circle</summary>${playerList(view, {kickable: true})}</details>`
    : `<div class="rail-chip"><span class="moon-loader mini"><span></span></span><strong>The host prepares the deck</strong></div>`;
  app.innerHTML = stageScreen(view, {
    rail,
    foot: isHost ? `<button class="btn" data-action="start-game" ${deck.valid ? '' : 'disabled'}>Shuffle, deal & begin</button>` : '',
    extra: invite,
    cls: 'lobby-screen'
  });
}

// Your one card in the game: dealt from a deck fan, flipped with a lift,
// sealed face-down — then you are a character in the square, not a card.
function renderRoleReveal(view) {
  const seenCount = Object.values(view.players).filter(player => player.ready).length;
  const total = Object.keys(view.players).length;
  if (!view.phaseReady) {
    app.innerHTML = narratorStage(view, 'The cards are dealt');
    return;
  }
  if (!view.me.seenRole) {
    app.innerHTML = `<section class="screen stage-screen deal-screen">${gameHeader(view)}${stageStrip(view)}
      <div class="deal-stage">
        <div class="deal-deck" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        ${roleCard(view.me.role, ui.roleFaceUp, {dealt: true})}
      </div>
      ${!ui.roleFaceUp ? '<div class="stage-foot"><div class="tap-hint">Tap the card</div></div>' : `<div class="stage-foot"><button class="btn" data-action="seal-role">Seal my fate</button></div>`}
    </section>`;
    return;
  }
  app.innerHTML = stageScreen(view, {
    title: 'Your fate is sealed',
    rail: `<div class="rail-chip"><b>✓</b><strong>${seenCount} of ${total} sealed</strong></div>
      <div class="rail-note">☾ Close your eyes when night falls. Your phone pulses when the tale needs you.</div>`
  });
}

// Eyes closed: an almost textless moonlit scene, identical on every phone,
// so no glance across the table can read anything from a sleeping screen.
function sleepMessage(view, custom = null) {
  return `<section class="screen night-sleep">${gameHeader(view)}
    <div class="sleep-scene" aria-hidden="true">
      <div class="sleep-stars"></div>
      <div class="sleep-moon"></div>
      <div class="sleep-eyes">— ◡ —</div>
      ${custom?.text ? `<p class="sleep-line">${esc(custom.text)}</p>` : ''}
    </div>
  </section>`;
}

function renderThief(view, action) {
  const forced = action.extras.length === 2 && action.extras.every(role => role === 'werewolf');
  app.innerHTML = `<section class="screen awake-screen awake-thief ${ui.thiefRevealed ? 'has-dock' : ''}">${gameHeader(view)}${phaseHeader(view, forced ? {title: 'The Thief wakes', subtitle: 'Both spares are Werewolves. One must be taken.'} : null)}
    <div class="mini-cards">${action.extras.map((roleId, index) => `<div class="mini-flip ${ui.thiefRevealed ? 'revealed' : ''}"><button data-action="${ui.thiefRevealed ? 'choose-thief' : 'reveal-thief'}" data-choice="${index}"><span class="card-face back"><img src="assets/card-back.webp" alt="Spare face-down card"></span><span class="card-face front"><img src="${ROLES[roleId].image}" alt="${esc(ROLES[roleId].name)}"><span class="mini-card-name">${esc(ROLES[roleId].name)}</span></span></button></div>`).join('')}</div>
    ${!ui.thiefRevealed ? '<div class="tap-hint">Tap to reveal the spare cards</div>' : '<div class="tap-hint">Tap a card to take its fate</div>'}
    ${ui.thiefRevealed && !forced ? dock('<button class="btn secondary" data-action="choose-thief" data-choice="keep">Keep the Thief</button>') : ''}
  </section>`;
}

function renderCupid(view, action) {
  const selected = ui.cupidChoices;
  app.innerHTML = stageScreen(view, {
    cls: `awake-screen awake-cupid ${ui.cupidLoosed ? 'is-loosed' : ''}`,
    rail: `<div class="rail-emblem cupid">♥</div>
      <div class="heart-slots"><b class="${selected[0] ? 'filled' : ''}">♥</b><b class="${selected[1] ? 'filled' : ''}">♥</b></div>
      ${selected.map(id => `<div class="rail-chip"><b>♥</b><strong>${esc(view.players[id]?.name || '')}</strong></div>`).join('')}`,
    foot: `<button class="btn" data-action="submit-cupid" ${selected.length === 2 && !ui.sceneBusy ? '' : 'disabled'}>${ui.cupidLoosed ? 'The arrow flies…' : 'Loose the arrow'}</button>`,
    extra: cupidCinematic(view, selected, {loosed: ui.cupidLoosed})
  });
}

// Everyone flips an identical fate card, so nobody can spot the lovers from
// behaviour — the card face alone carries the secret.
function renderLover(view, action) {
  const partner = action.partnerId ? view.players[action.partnerId] : null;
  const flipped = ui.loverFlipped;
  const front = action.chosen
    ? `<span class="lover-face chosen"><b>♥</b><strong>Your heart is bound</strong><em>${esc(partner?.name || 'A hidden soul')}</em><span>You live and die together. Tell no one — not even a glance.</span></span>`
    : `<span class="lover-face"><b>☾</b><strong>The arrow passed you by</strong><span>Your heart remains your own. Reveal nothing.</span></span>`;
  app.innerHTML = `<section class="screen awake-screen awake-lovers ${flipped ? 'has-dock' : ''}">${gameHeader(view)}${phaseHeader(view)}
    <div class="flip-wrap">
      <button class="flip-card ${flipped ? 'flipped' : ''}" data-action="flip-lover" aria-label="${flipped ? 'Your fate card' : 'Turn over your fate card'}">
        <span class="card-face back"><img src="assets/card-back.webp" alt="Face-down fate card"></span>
        <span class="card-face front">${front}</span>
      </button>
    </div>
    ${!flipped ? '<div class="tap-hint">Turn over your fate card</div>' : ''}
    ${flipped ? dock('<button class="btn" data-action="lovers-seen">Seal the card · close your eyes</button>') : ''}
  </section>`;
}

function renderSeer(view, action) {
  if (!action.target) {
    app.innerHTML = stageScreen(view, {
      cls: 'awake-screen awake-seer',
      rail: '<div class="rail-emblem seer">✦</div><div class="rail-note">One soul’s truth will be shown to you.</div>'
    });
    return;
  }
  const target = view.players[action.target];
  app.innerHTML = stageScreen(view, {
    title: target?.name || 'The vision',
    cls: 'awake-screen awake-seer vision-open',
    extra: seerCinematic(view, action),
    foot: '<button class="btn" data-action="seer-done">Seal the vision · close your eyes</button>'
  });
}

function renderWolves(view, action) {
  const wolves = [view.me.id, ...action.teammates];
  const myChoice = action.votes[view.me.id];
  const hasChoice = Object.prototype.hasOwnProperty.call(action.votes, view.me.id);
  app.innerHTML = stageScreen(view, {
    title: 'The pack hunts',
    cls: 'awake-screen awake-wolves',
    rail: `<div class="wolf-pack rail-pack">${wolves.map(id => `<span class="wolf-chip">🐺 ${esc(view.players[id]?.name || 'Werewolf')}</span>`).join('')}</div>
      ${action.consensus ? '<div class="badge green">✓ The pack agrees</div>' : '<div class="rail-note">🐾 marks show the pack’s choices. The hunt needs one shared victim.</div>'}
      <button class="btn mini secondary ${hasChoice && myChoice === null ? 'selected-btn' : ''}" data-action="wolf-no-kill">☾ Spare the village${hasChoice && myChoice === null ? ' ✓' : ''}</button>
      ${action.littleGirlInPlay ? `<button class="btn danger mini" data-action="little-girl-caught" ${action.littleGirlCaught ? 'disabled' : ''}>${action.littleGirlCaught ? 'The Little Girl was caught' : 'I caught the Little Girl'}</button>` : ''}`
  });
}

function renderLittleGirl(view) {
  app.innerHTML = sleepMessage(view, {text: '👁 Peek if you dare — caught, you die in the victim’s place.'});
}

function renderWitch(view, action) {
  const victim = action.victim ? view.players[action.victim] : null;
  const poisonOpen = ui.poisonOpen || Boolean(ui.witchPoisonTarget);
  app.innerHTML = stageScreen(view, {
    cls: `awake-screen awake-witch ${ui.sceneBusy === 'witch' ? 'is-casting' : ''}`,
    rail: `<div class="rail-chip doomed"><b>☠</b><strong>${victim ? esc(victim.name) : 'No victim tonight'}</strong></div>
      <button class="potion rail-potion heal ${ui.witchHeal ? 'selected' : ''} ${action.potions.heal ? '' : 'used'}" data-action="toggle-heal" ${!action.potions.heal || !victim || ui.sceneBusy ? 'disabled' : ''}><img src="assets/sprites/props/potion-green.png" alt=""><strong>Save</strong><span>${ui.witchHeal ? 'Selected' : 'Healing draught'}</span></button>
      <button class="potion rail-potion poison ${poisonOpen ? 'selected' : ''} ${action.potions.poison ? '' : 'used'}" data-action="open-poison" ${!action.potions.poison || ui.sceneBusy ? 'disabled' : ''}><img src="assets/sprites/props/potion-red.png" alt=""><strong>Poison</strong>${ui.witchPoisonTarget ? `<span>${esc(view.players[ui.witchPoisonTarget]?.name || '')}</span>` : '<span>Choose a soul</span>'}</button>
      ${action.potions.poison && poisonOpen ? '<button class="btn ghost mini" data-action="clear-poison">No poison</button>' : ''}`,
    foot: `<button class="btn" data-action="submit-witch" ${ui.sceneBusy ? 'disabled' : ''}>${ui.sceneBusy ? 'The bottles answer…' : 'Seal the choice'}</button>`,
    extra: `<div class="witch-magic" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`
  });
}

function renderVote(view, action) {
  app.innerHTML = stageScreen(view, {
    title: action.election ? 'Choose the Sheriff' : undefined,
    rail: action.choice
      ? `<div class="badge green">✓ Sealed for ${esc(view.players[action.choice].name)}</div>`
      : '<div class="rail-note">⚖ Tap the one you accuse. The ballot seals when the last vote falls.</div>'
  });
}

function renderPending(view, action) {
  const hunter = action.type === 'hunter';
  app.innerHTML = stageScreen(view, {
    title: hunter ? 'One final shot' : 'Name your successor',
    cls: hunter ? 'awake-screen awake-hunter' : 'awake-screen awake-sheriff',
    rail: hunter
      ? '<div class="rail-note hunter-note">Tap any living soul. The shot is public at dawn.</div><button class="btn ghost mini" data-action="resolve-pending" data-id="">Lower the weapon</button>'
      : '<img class="successor-badge" src="assets/sprites/props/badge.png" alt="Sheriff badge"><div class="rail-note">Pass the badge to one living soul.</div>',
    extra: hunter ? hunterCinematic() : ''
  });
}

function renderPrivateAction(view) {
  const action = view.privateAction || {};
  if (action.done && action.type !== 'vote') {
    app.innerHTML = sleepMessage(view, {title: 'Your choice is sealed', text: 'The tale continues on its own.'});
    return true;
  }
  if (action.type === 'thief') return renderThief(view, action);
  if (action.type === 'cupid') return renderCupid(view, action);
  if (action.type === 'lover') return renderLover(view, action);
  if (action.type === 'seer') return renderSeer(view, action);
  if (action.type === 'werewolf') return renderWolves(view, action);
  if (action.type === 'little-girl') return renderLittleGirl(view);
  if (action.type === 'witch') return renderWitch(view, action);
  if (action.type === 'vote') return renderVote(view, action);
  if (action.type === 'hunter' || action.type === 'sheriff-successor') return renderPending(view, action);
  return false;
}

// The claw overlay: three tapered slashes drawn across the fallen card.
function clawOverlay() {
  return `<svg class="death-claw" viewBox="0 0 100 150" aria-hidden="true">
    <defs><linearGradient id="clawg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e0554f"/><stop offset=".5" stop-color="#8e1622"/><stop offset="1" stop-color="#45060f"/>
    </linearGradient></defs>
    <g transform="rotate(-16 50 75)">
      <path class="slash s1" d="M24,18 C30,52 34,92 30,128 C27,96 23,56 20,22 Z" fill="url(#clawg)"/>
      <path class="slash s2" d="M50,12 C57,50 60,94 55,134 C51,98 47,54 45,16 Z" fill="url(#clawg)"/>
      <path class="slash s3" d="M76,20 C81,54 84,92 80,126 C76,94 73,58 71,24 Z" fill="url(#clawg)"/>
    </g>
  </svg>`;
}

// One cinematic frame per death: the fallen character's full card, marked by
// its cause — claw-rent for the pack, a poison haze for the Witch, a heavy
// pall for the gallows and grief. The narrator carries the story aloud.
function deathHero(death, index, staged) {
  const role = ROLES[death.role] || ROLES.villager;
  const wolfKill = death.cause === 'the Werewolves' || death.cause === 'caught peeking';
  const poison = death.cause === 'the Witch’s poison';
  const variant = wolfKill ? 'rent' : poison ? 'hexed' : 'mourned';
  return `<div class="death-hero ${variant} ${staged ? 'staged' : ''}" style="--stage:${index}">
    <div class="death-frame">
      <img src="${role.image}" alt="${esc(role.name)} card">
      ${wolfKill ? clawOverlay() : ''}
      ${poison ? '<div class="death-haze"></div>' : ''}
      <div class="death-pall"></div>
      <div class="death-plate"><strong>${esc(death.name)}</strong><span>${esc(role.name)} · claimed by ${esc(death.cause)}</span></div>
    </div>
  </div>`;
}

function deathsMarkup(view, {staged = false} = {}) {
  if (!view.lastDeaths?.length) return `<div class="no-deaths ${staged ? 'staged' : ''}"><b>☀</b><h2>Nobody died</h2><p>${esc(morningLine(view))}</p></div>`;
  return `<div class="death-reveal">${view.lastDeaths.map((death, index) => deathHero(death, index, staged)).join('')}</div>`;
}

// The private whisper: sealed on the card face, opened only by its owner.
// Everyone living receives one every dawn — identical gesture, identical
// timing — so nothing about holding or opening it can leak a role.
function whisperMarkup(view, {compact = false} = {}) {
  const whisper = view.me?.whisper;
  if (!whisper || view.me?.storyteller) return '';
  const open = ui.whisperOpen;
  return `<button class="whisper ${open ? 'open' : ''} ${compact ? 'compact' : ''}" data-action="toggle-whisper" aria-label="${open ? 'Hide your private whisper' : 'Read what you noticed in the night'}">
    <span class="whisper-mark">${open ? '✦' : '✉'}</span>
    <span class="whisper-copy"><strong>${open ? 'You alone remember' : 'What the night left you'}</strong>
    <span>${open ? esc(whisper) : 'For your eyes only · tap to read'}</span></span>
  </button>`;
}

function tallyMarkup(view) {
  const tally = view.lastVote?.tally || {};
  const max = Math.max(1, ...Object.values(tally));
  const rows = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<div class="panel compact center"><p class="muted" style="margin:0">No votes were cast.</p></div>';
  return `<div class="tally">${rows.map(([id, count]) => `<div class="tally-row"><span>${esc(view.players[id]?.name || 'Unknown')}</span><span class="tally-bar"><i style="width:${Math.round(count / max * 100)}%"></i></span><b>${count}</b></div>`).join('')}</div>`;
}

function scoreboardMarkup(view, {final = false} = {}) {
  const scores = Object.values(view.session?.scores || {}).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const resultMap = new Map((view.session?.lastRound?.results || []).map(result => [result.id, result]));
  if (!scores.length) return '';
  return `<div class="scoreboard ${final ? 'final' : ''}">
    <div class="score-head"><span>Table score</span><b>${final ? `${view.session.round} ${view.session.round === 1 ? 'hunt' : 'hunts'}` : `Round ${view.session.round}`}</b></div>
    <div class="score-rows">${scores.map((score, index) => {
      const result = resultMap.get(score.id);
      const reasons = result?.reasons?.map(reason => `${reason.label} ${reason.points > 0 ? '+' : ''}${reason.points}`).join(' · ') || 'Carried from earlier hunts';
      return `<div class="score-row"><span class="score-rank">${index + 1}</span><span class="score-name"><strong>${esc(score.name)}</strong><small>${esc(reasons)}</small></span>${result ? `<span class="score-delta ${result.delta >= 0 ? 'up' : 'down'}">${result.delta >= 0 ? '+' : ''}${result.delta}</span>` : ''}<b class="score-total">${score.total}</b></div>`;
    }).join('')}</div>
  </div>`;
}

function renderDead(view) {
  app.innerHTML = stageScreen(view, {
    rail: `${whisperMarkup(view, {compact: true})}<div class="rail-chip ghostly"><b>☽</b><strong>A silent spirit</strong></div>`
  });
}

function renderDawn(view) {
  app.innerHTML = stageScreen(view, {
    title: view.lastDeaths?.length ? 'Dawn reveals the fallen' : 'The village wakes',
    cls: 'dawn-screen public-cutscene',
    extra: `<div class="public-cinema">${deathCinematic(view)}</div>`
  });
}

function renderDiscussion(view) {
  const action = view.privateAction?.type === 'discussion' ? view.privateAction : null;
  app.innerHTML = stageScreen(view, {
    rail: whisperMarkup(view, {compact: true}),
    foot: action ? `<div class="dock-note">${action.readyCount} of ${action.total} ready</div>
      <button class="btn ${action.ready ? 'secondary' : ''}" data-action="day-ready" data-ready="${action.ready ? 'false' : 'true'}">${action.ready ? '✓ Ready · keep debating' : 'Ready to vote'}</button>` : ''
  });
}

function renderDayResult(view) {
  const tied = view.lastVote?.leaders?.length > 1;
  app.innerHTML = stageScreen(view, {
    title: tied ? 'The vote is tied' : 'The village has spoken',
    cls: 'public-cutscene judgement-cutscene',
    rail: tallyMarkup(view),
    extra: `<div class="public-cinema">${deathCinematic(view)}</div>`
  });
}

function renderGameOver(view) {
  const winner = view.winner || {team: 'none', title: 'The Tale Is Ended', text: ''};
  const symbol = winner.team === 'wolves' ? '🐺' : winner.team === 'village' ? '☀' : winner.team === 'lovers' ? '♥' : '☾';
  const epilogue = winner.team === 'wolves' ? 'The last lamps gutter out. The pack owns the lanes now.'
    : winner.team === 'village' ? 'Morning holds. One by one, the boarded windows will open again.'
    : winner.team === 'lovers' ? 'Two lit windows remain, facing one another across the empty lane.'
    : 'The village stands silent beneath the moon.';
  app.innerHTML = `<section class="screen game-over-screen ${view.coordinator ? 'has-dock' : ''}">${gameHeader(view)}<div class="game-over-hero"><div class="victory-moon">${symbol}</div><div class="eyebrow">Round ${view.session?.round || 1} complete</div><h1>${esc(winner.title)}</h1><p>${esc(winner.text || epilogue)}</p></div>
    <div class="round-results"><div class="final-grid">${Object.values(view.players).map(player => {
      const roleId = player.storyteller ? 'storyteller' : player.role;
      const role = ROLES[roleId] || ROLES.villager;
      return `<div class="final-card ${player.alive ? '' : 'dead'}"><img src="${role.image}" alt="${esc(role.name)}"><div class="label"><strong>${esc(player.name)}</strong><span>${esc(role.name)}${player.sheriff ? ' · Sheriff' : ''}</span></div></div>`;
    }).join('')}</div>${scoreboardMarkup(view)}</div>
    ${view.coordinator ? dock('<div class="session-actions"><button class="btn" data-action="next-round">Next hunt</button><button class="btn secondary" data-action="change-deck">Change deck</button><button class="btn secondary" data-action="end-session">End table</button></div>') : ''}
  </section>`;
}

function renderSessionOver(view) {
  const scores = Object.values(view.session?.scores || {}).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const podium = scores.slice(0, 3);
  app.innerHTML = `<section class="screen session-over-screen ${view.coordinator ? 'has-dock' : ''}">${gameHeader(view)}
    <div class="game-over-hero"><div class="victory-moon">✦</div><div class="eyebrow">The table closes</div><h1>Legends of Moonfall</h1><p>${view.session?.round || 0} ${(view.session?.round || 0) === 1 ? 'hunt' : 'hunts'} are written into the village chronicle.</p></div>
    <div class="podium">${podium.map((score, index) => `<div class="podium-place place-${index + 1}"><span>${index + 1}</span><strong>${esc(score.name)}</strong><b>${score.total}</b></div>`).join('')}</div>
    ${scoreboardMarkup(view, {final: true})}
    ${view.coordinator ? dock('<button class="btn" data-action="clear-session">Gather a new village</button>') : ''}
  </section>`;
}

function renderNarratorWait(view) {
  const [title] = PHASE_META[view.phase] || ['The tale continues'];
  app.innerHTML = narratorStage(view, title);
}

function renderGame() {
  const view = currentView;
  phaseChanged(view);
  if (view.phase === 'lobby') return renderLobby(view);
  if (view.phase === 'role-reveal') return renderRoleReveal(view);
  if (view.phase === 'game-over') return renderGameOver(view);
  if (view.phase === 'session-over') return renderSessionOver(view);
  const gated = view.phase.startsWith('setup-') || view.phase.startsWith('night-') || ['sheriff-vote', 'day-vote', 'resolution'].includes(view.phase);
  if (!view.phaseReady && gated) return renderNarratorWait(view);
  if (renderPrivateAction(view) !== false) return;
  // The dawn reveal and the vote's judgement belong to everyone — the dead
  // watch the same cinematic morning the living do, through a ghost's veil.
  if (view.phase === 'dawn') return renderDawn(view);
  if (view.phase === 'day-result') return renderDayResult(view);
  if (!view.me.alive) return renderDead(view);
  if (view.phase === 'day-discussion') return renderDiscussion(view);
  if (view.phase === 'resolution') {
    app.innerHTML = sleepMessage(view);
    return;
  }
  app.innerHTML = sleepMessage(view);
}

function renderModal() {
  if (!ui.modal) { modalRoot.innerHTML = ''; return; }
  if (ui.modal === 'rules') {
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal"><div class="modal-head"><h2>The Moonfall deck</h2><button class="icon-btn" data-action="close-modal">×</button></div><div class="auto-narrator-note"><span>◉</span><div><strong>No player sits out</strong><p>The automatic narrator speaks every wake and sleep cue, then opens each private action on the correct phones.</p></div></div><div class="rule-list">${['werewolf','villager','seer','witch','hunter','cupid','little-girl','thief','sheriff'].map(id => `<div class="rule-item"><img src="${ROLES[id].image}" alt=""><div><h3>${esc(ROLES[id].name)}</h3><p>${esc(ROLES[id].rule)}</p></div></div>`).join('')}</div><p class="footer-note"><a href="https://www.zygomatic-games.com/en/game/the-werewolves-of-millers-hollow/" target="_blank" rel="noreferrer">Read the publisher’s classic rulebook</a></p></div></div>`;
    return;
  }
  if (ui.modal === 'settings') {
    const install = isStandalone() ? '' : '<button class="btn secondary" data-action="install-app">Install Moonfall</button>';
    const fullscreen = fullscreenAvailable() ? `<button class="btn secondary" data-action="toggle-fullscreen">${fullscreenElement() ? 'Exit fullscreen' : 'Enter fullscreen'}</button>` : '';
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal"><div class="modal-head"><h2>Settings</h2><button class="icon-btn" data-action="close-modal">×</button></div><div class="setting-list"><button data-action="toggle-sound"><span>Sound effects</span><b>${soundEnabled ? 'On' : 'Off'}</b></button><button data-action="toggle-voice"><span>Automatic narrator</span><b>${voiceEnabled ? 'On' : 'Off'}</b></button><button data-action="toggle-ambience"><span>Night & day ambience</span><b>${ambienceEnabled ? 'On' : 'Off'}</b></button></div><div class="sfx-previews"><button data-action="preview-howl">Howl</button><button data-action="preview-kill">Kill</button><button data-action="preview-heal">Heal</button></div><div class="button-stack">${fullscreen}${install}<button class="btn ghost" data-action="show-rules">Read the rules</button><button class="btn ghost" data-action="start-agent-test">Run a practice game</button></div><p class="footer-note">All audio is bundled or generated on-device—no accounts or streaming costs.${voicePackEngine() === 'elevenlabs' ? ' Narration and ambience audio by elevenlabs.io.' : ''}</p></div></div>`;
    return;
  }
  if (ui.modal === 'install') {
    const ios = isIosDevice();
    const fullscreenButton = fullscreenAvailable() && !fullscreenElement() ? '<button class="btn secondary" data-action="toggle-fullscreen">Enter fullscreen now</button>' : '';
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal"><div class="modal-head"><h2>Make Moonfall an app</h2><button class="icon-btn" data-action="close-modal">×</button></div><div class="install-mark"><img src="assets/icon-192.png" alt="Moonfall app icon"></div><p class="muted">${ios ? 'In Safari, tap the Share button, choose “Add to Home Screen”, then open Moonfall from its new icon.' : 'Open your browser menu and choose “Install app” or “Add to Home screen”, then launch Moonfall from its icon.'}</p><div class="button-stack">${fullscreenButton}<button class="btn ghost" data-action="close-modal">Continue in the browser</button></div><p class="footer-note">Installed mode removes most browser controls. Moonfall also keeps every joined phone awake and restores the peer connection when the app returns to the foreground.</p></div></div>`;
    return;
  }
  if (ui.modal === 'menu') {
    const appButton = isStandalone() ? '' : '<button class="btn secondary" data-action="install-app">Install Moonfall to home screen</button>';
    const fullButton = fullscreenAvailable() ? `<button class="btn secondary" data-action="toggle-fullscreen">${fullscreenElement() ? 'Exit fullscreen' : 'Enter fullscreen'}</button>` : '';
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal"><div class="modal-head"><h2>Moonfall</h2><button class="icon-btn" data-action="close-modal">×</button></div><div class="connection-health"><span class="health-orb ${connectionState === 'offline' ? 'offline' : ''}"></span><div><strong>${connectionState === 'connected' ? 'Village link healthy' : connectionState === 'connecting' ? 'Reconnecting to the village' : 'The host is currently away'}</strong><small>${wakeLock ? 'Screen-awake protection is active.' : 'Tap anywhere if your browser has paused screen-awake protection.'}</small></div></div><div class="button-stack" style="margin-top:14px">${appButton}${fullButton}<button class="btn secondary" data-action="show-rules">Role guide & classic rules</button><button class="btn secondary" data-action="toggle-sound">Sound effects: ${soundEnabled ? 'On' : 'Off'}</button>${narrationSupported() || voicePackReady() ? `<button class="btn secondary" data-action="toggle-voice">Automatic narrator: ${voiceEnabled ? 'On' : 'Off'}${voicePackReady() ? ' · cinematic' : ''}</button>` : ''}<button class="btn secondary" data-action="toggle-ambience">Night &amp; day ambience: ${ambienceEnabled ? 'On' : 'Off'}</button>${soundEnabled ? '<button class="btn ghost" data-action="preview-howl">Preview the nightfall howl</button>' : ''}<button class="btn ghost" data-action="copy-code">Copy room code ${esc(roomCode)}</button><button class="btn ghost" data-action="copy-diagnostics">Copy connection diagnostics</button>${currentView?.coordinator && currentView.phase !== 'lobby' && currentView.phase !== 'game-over' ? '<button class="btn danger" data-action="reset-game">Abandon this tale & reshuffle</button>' : ''}<button class="btn ghost" data-action="leave-game">Leave this screen</button></div><p class="footer-note">Every joined phone is kept awake. If the OS still suspends the web app, Moonfall restores the peer link and saved seat when the screen returns.</p><p class="footer-note">The host phone plays the room narration and ambience while its owner still plays a character. Every secret choice stays on the active player’s own screen.</p></div></div>`;
  }
}

// The town square is the playing surface. It hides only on screens that
// must own the whole display (card flips, the dawn reveal, sleep screens)
// and re-renders only when its content actually changes, so the crowd's
// idle animation never restarts on ordinary broadcasts.
function squareVisible(view) {
  if (!view) return false;
  const phase = view.phase;
  if (phase === 'lobby') return true;
  if (phase === 'role-reveal') return Boolean(view.me?.seenRole);
  const night = phase.startsWith('setup-') || phase.startsWith('night-') || phase === 'resolution';
  if (night) {
    if (view.phaseReady === false) return false;
    const action = view.privateAction || {};
    if (!action.type || action.done) return false;                 // sleepers keep eyes closed
    if (['lover', 'thief', 'little-girl'].includes(action.type)) return false;
    if (action.type === 'seer' && action.target) return false;     // the vision card owns the screen
    return true;                                                   // the actor plays on the square
  }
  return true;
}

// Track who has already stood in the lobby square, so newcomers walk in.
const seenInSquare = new Set();
let arrivalTimer = null;
// The square's entrance fade plays only when the crowd first appears; while
// the same phase merely re-renders (a vote lands, a mark changes) the crowd
// must stay solid on screen instead of blinking back in from nothing.
let squareShownFor = null;

function updateVillageLayer() {
  if (!villageRoot) return;
  const view = mode ? currentView : null;
  let html = '';
  if (view && squareVisible(view)) {
    const select = squareSelection(view);
    let arrivals = null;
    if (view.phase === 'lobby') {
      arrivals = new Set(Object.keys(view.players).filter(id => !seenInSquare.has(id) && !view.players[id].storyteller));
      for (const id of arrivals) seenInSquare.add(id);
      if (arrivals.size) {
        clearTimeout(arrivalTimer);
        arrivalTimer = setTimeout(() => { lastVillageHtml = null; updateVillageLayer(); }, 2100);
      }
    }
    html = townSquare(view, {select, arrivals, settled: squareShownFor === view.phase});
    squareShownFor = view.phase;
  } else {
    squareShownFor = null;
  }
  if (html === lastVillageHtml) return;
  lastVillageHtml = html;
  villageRoot.innerHTML = html;
}

// Taps on the crowd: when a selection is open and this character is a legal
// target, the tap IS the action; otherwise it shows the name for a moment.
let spriteNameTimer = null;
villageRoot?.addEventListener('click', event => {
  const sprite = event.target.closest('.sprite');
  if (!sprite || sprite.disabled) return;
  const id = sprite.dataset.sprite;
  const select = mode ? squareSelection(currentView) : null;
  if (select && select.ids.has(id)) {
    vibrate(14);
    handleAction(select.action, sprite);
    return;
  }
  vibrate(10);
  for (const named of villageRoot.querySelectorAll('.sprite.named')) named.classList.remove('named');
  sprite.classList.add('named');
  clearTimeout(spriteNameTimer);
  spriteNameTimer = setTimeout(() => sprite.classList.remove('named'), 2600);
});

function render() {
  try {
    updateHaptics(mode ? currentView : null);
    if (!mode) renderHome();
    else if (mode === 'guest' && !currentView) renderConnecting();
    else renderGame();
    updateVillageLayer();
    renderModal();
    if (ui.phaseFresh) {
      ui.phaseFresh = false;
      app.firstElementChild?.classList.add('phase-enter');
    }
  } catch (error) {
    diagnostic('render-error', {message: String(error?.message || error).slice(0, 220)});
    app.innerHTML = `<section class="screen centered"><div class="panel ornate center"><div class="eyebrow">A cloud crossed the moon</div><h2>The screen failed to draw</h2><p class="muted">Your seat and the game state are safe. Redraw to continue.</p><div class="button-stack"><button class="btn" data-action="recover-render">Redraw the screen</button><button class="btn ghost" data-action="leave-game">Leave to the home screen</button></div></div></section>`;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to the clipboard.', 'success');
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    toast('Copied to the clipboard.', 'success');
  }
}

function roomInviteUrl() {
  return `${location.origin}${location.pathname}?room=${roomCode}`;
}

function inviteQrSvg() {
  try {
    const qr = qrFactory(0, 'M');
    qr.addData(roomInviteUrl());
    qr.make();
    return qr.createSvgTag({cellSize: 4, margin: 0, scalable: true});
  } catch {
    return '';
  }
}

async function handleAction(action, element) {
  // Square taps arrive on .sprite buttons, which carry the player id in
  // data-sprite; every other actionable element uses data-id.
  const id = element.dataset.id ?? element.dataset.sprite;
  if (action === 'home-tab') {
    sound('tap');
    ui.homeTab = element.dataset.tab;
    queueRender();
  } else if (action === 'create-room') {
    sound('tap');
    void enterImmersiveMode();
    createVillage(document.querySelector('#create-name')?.value || '');
  } else if (action === 'start-agent-test') {
    sound('tap');
    ui.modal = null;
    void enterImmersiveMode();
    startAgentTest(document.querySelector('#create-name')?.value || document.querySelector('#join-name')?.value || '');
  } else if (action === 'join-room') {
    sound('tap');
    void enterImmersiveMode();
    joinVillage(document.querySelector('#join-name')?.value || '', document.querySelector('#join-code')?.value || '');
  } else if (action === 'resume-room') {
    sound('tap');
    void enterImmersiveMode();
    resumeVillage(element.dataset.code);
  } else if (action === 'copy-code') {
    sound('tap');
    copyText(roomCode || currentView?.roomCode || '');
  } else if (action === 'copy-diagnostics') {
    sound('tap');
    copyText(diagnosticReport());
  } else if (action === 'share-room') {
    sound('tap');
    const share = {title: 'Join my Moonfall village', text: `Join Moonfall with code ${roomCode}`, url: roomInviteUrl()};
    if (navigator.share) {
      try { await navigator.share(share); } catch { /* User cancelled. */ }
    } else copyText(`${share.text}\n${share.url}`);
  } else if (action === 'remove-player') {
    if (confirm(`Remove ${currentView.players[id]?.name || 'this player'} from the lobby?`)) sendOwnCommand('host:remove', {seatId: id});
  } else if (action === 'set-preset') {
    sound('tap');
    sendOwnCommand('host:preset', {preset: element.dataset.preset});
  } else if (action === 'toggle-role') {
    sound('tap');
    const roleId = element.dataset.role;
    const roles = [...currentView.settings.roles];
    const next = roles.includes(roleId) ? roles.filter(id => id !== roleId) : [...roles, roleId];
    sendOwnCommand('host:settings', {roles: next});
  } else if (action === 'start-game') {
    void enterImmersiveMode();
    sendOwnCommand('host:start');
  } else if (action === 'flip-role') {
    ui.roleFaceUp = !ui.roleFaceUp;
    sound('flip'); vibrate(18); queueRender();
  } else if (action === 'seal-role') {
    ui.roleFaceUp = false;
    sound('decision');
    sendOwnCommand('player:seen-role');
  } else if (action === 'reveal-thief') {
    ui.thiefRevealed = true;
    queueRender();
  } else if (action === 'choose-thief') {
    sendOwnCommand('player:thief-choice', {choice: element.dataset.choice});
  } else if (action === 'choose-cupid') {
    if (ui.cupidChoices.includes(id)) ui.cupidChoices = ui.cupidChoices.filter(choice => choice !== id);
    else if (ui.cupidChoices.length < 2) ui.cupidChoices.push(id);
    else { toast('Cupid can bind exactly two hearts.', 'error'); return; }
    playSceneAction('heart-pick', element, 700);
    sound('select'); vibrate(16); queueRender();
  } else if (action === 'submit-cupid') {
    if (ui.sceneBusy || ui.cupidChoices.length !== 2) return;
    const serial = currentView?.phaseSerial;
    ui.sceneBusy = 'cupid';
    ui.cupidLoosed = true;
    queueRender();
    await sleep(1450);
    if (currentView?.phaseSerial !== serial || currentView?.phase !== 'setup-cupid') return;
    sendOwnCommand('player:cupid-choose', {choices: ui.cupidChoices});
  } else if (action === 'lovers-seen') {
    sendOwnCommand('player:lovers-seen');
  } else if (action === 'seer-choose') {
    sound('select');
    playSceneAction('seer-flash', element, 850);
    await sleep(260);
    sendOwnCommand('player:seer-choose', {target: id});
  } else if (action === 'flip-seer') {
    ui.seerFlipped = !ui.seerFlipped;
    queueRender();
  } else if (action === 'flip-lover') {
    ui.loverFlipped = true;
    sound('flip');
    vibrate(18);
    queueRender();
  } else if (action === 'seer-done') {
    ui.seerFlipped = false;
    sendOwnCommand('player:seer-done');
  } else if (action === 'wolf-vote') {
    sound('select');
    playSceneAction('wolf-pounce', element, 900);
    sendOwnCommand('player:wolf-vote', {target: id});
  } else if (action === 'wolf-no-kill') {
    sound('select');
    sendOwnCommand('player:wolf-vote', {target: null});
  } else if (action === 'little-girl-caught') {
    if (confirm('Confirm that the Little Girl was physically caught peeking? She will replace the pack’s chosen victim.')) sendOwnCommand('player:little-girl-caught');
  } else if (action === 'toggle-heal') {
    ui.witchHeal = !ui.witchHeal;
    playSceneAction(ui.witchHeal ? 'heal-bloom' : 'spell-clear', element, 900);
    sound('select'); vibrate(16); queueRender();
  } else if (action === 'open-poison') {
    ui.poisonOpen = true;
    queueRender();
  } else if (action === 'choose-poison') {
    ui.witchPoisonTarget = id;
    ui.poisonOpen = true;
    playSceneAction('poison-mark', element, 1050);
    sound('select'); vibrate(16); queueRender();
  } else if (action === 'clear-poison') {
    ui.witchPoisonTarget = null;
    ui.poisonOpen = false;
    queueRender();
  } else if (action === 'submit-witch') {
    if (ui.sceneBusy) return;
    const serial = currentView?.phaseSerial;
    ui.sceneBusy = 'witch';
    playSceneAction(ui.witchHeal && ui.witchPoisonTarget ? 'witch-dual' : ui.witchHeal ? 'heal-bloom' : ui.witchPoisonTarget ? 'poison-mark' : 'spell-clear', null, 1300);
    queueRender();
    await sleep(1150);
    if (currentView?.phaseSerial !== serial || currentView?.phase !== 'night-witch') return;
    sendOwnCommand('player:witch-submit', {heal: ui.witchHeal, poisonTarget: ui.witchPoisonTarget});
  } else if (action === 'cast-vote') {
    sound('decision');
    playSceneAction('vote-token', element, 780);
    await sleep(380);
    sendOwnCommand('player:cast-vote', {target: id});
  } else if (action === 'toggle-header') {
    sound('tap');
    ui.headerOpen = !ui.headerOpen;
    queueRender();
  } else if (action === 'toggle-whisper') {
    ui.whisperOpen = !ui.whisperOpen;
    sound('flip');
    vibrate(14);
    queueRender();
  } else if (action === 'day-ready') {
    sound('select');
    sendOwnCommand('player:day-ready', {ready: element.dataset.ready !== 'false'});
  } else if (action === 'resolve-pending') {
    const hunter = currentView?.privateAction?.type === 'hunter';
    sound(hunter ? 'hunter' : 'sheriff');
    playSceneAction(hunter ? 'hunter-shot' : 'badge-pass', element, 1050);
    await sleep(id ? 720 : 180);
    sendOwnCommand('player:resolve-pending', {target: id || null});
  } else if (action === 'next-round') {
    sendOwnCommand('host:next-round');
  } else if (action === 'change-deck') {
    sendOwnCommand('host:between-rounds');
  } else if (action === 'end-session') {
    if (confirm('Close this table and show the final Moonfall podium?')) sendOwnCommand('host:end-session');
  } else if (action === 'clear-session') {
    if (confirm('Clear these scores and gather a fresh village?')) sendOwnCommand('host:clear-session');
  } else if (action === 'reset-game') {
    if (confirm('Return every card to the deck and abandon the current tale?')) {
      ui.modal = null;
      sendOwnCommand('host:reset');
    }
  } else if (action === 'open-menu') {
    sound('tap');
    ui.modal = 'menu'; renderModal();
  } else if (action === 'show-settings') {
    sound('tap');
    ui.modal = 'settings'; renderModal();
  } else if (action === 'install-app') {
    sound('tap');
    await installApp();
  } else if (action === 'toggle-fullscreen') {
    sound('tap');
    await toggleFullscreen();
  } else if (action === 'show-rules') {
    sound('tap');
    ui.modal = 'rules'; renderModal();
  } else if (action === 'toggle-sound') {
    if (soundEnabled) {
      sound('tap');
      soundEnabled = false;
    } else {
      soundEnabled = true;
      unlockAudio();
      sound('decision');
    }
    safeWrite(SOUND_KEY, soundEnabled);
    updateAmbience(currentView);
    renderModal();
  } else if (action === 'toggle-voice') {
    voiceEnabled = !voiceEnabled;
    safeWrite(VOICE_KEY, voiceEnabled);
    if (voiceEnabled && deviceMaySpeak()) {
      const context = unlockAudio(true);
      if (context && voicePackCovers(['preview'])) playVoicePack(context, ['preview'], {delay: 120});
      else narrate('The village sleeps, and the tale continues.', {delay: 120});
    } else {
      stopNarration();
      stopVoicePack();
    }
    renderModal();
  } else if (action === 'toggle-ambience') {
    sound('tap');
    ambienceEnabled = !ambienceEnabled;
    safeWrite(AMBIENCE_KEY, ambienceEnabled);
    updateAmbience(currentView);
    renderModal();
  } else if (action === 'recover-render') {
    queueRender();
  } else if (action === 'preview-howl') {
    sound('howl');
  } else if (action === 'preview-kill') {
    sound('kill');
  } else if (action === 'preview-heal') {
    sound('heal');
  } else if (action === 'close-modal') {
    sound('tap');
    ui.modal = null; renderModal();
  } else if (action === 'leave-game') {
    ui.modal = null;
    leaveToHome();
  }
}

function delegatedClick(event) {
  const element = event.target.closest('[data-action]');
  if (!element || element.disabled) return;
  // The backdrop closes the modal only when tapped directly; taps inside the
  // sheet bubble up through it and must not dismiss the open modal.
  if (element.classList.contains('modal-backdrop') && event.target.closest('.modal')) return;
  event.preventDefault();
  unlockAudio();
  handleAction(element.dataset.action, element);
}

app.addEventListener('click', delegatedClick);
modalRoot.addEventListener('click', delegatedClick);

app.addEventListener('input', event => {
  if (event.target.id === 'join-code') event.target.value = cleanCode(event.target.value);
});

app.addEventListener('change', event => {
  if (event.target.id === 'wolf-setting') sendOwnCommand('host:settings', {wolves: event.target.value === 'auto' ? 'auto' : Number(event.target.value)});
  if (event.target.id === 'sheriff-setting') sendOwnCommand('host:settings', {sheriff: event.target.value === 'true'});
});

app.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  if (event.target.id === 'create-name') document.querySelector('[data-action="create-room"]')?.click();
  if (['join-name', 'join-code'].includes(event.target.id)) document.querySelector('[data-action="join-room"]')?.click();
});

window.addEventListener('beforeunload', persistHost);

registerPwa();
initVoicePack().then(ready => {
  if (ready) {
    diagnostic('voice-pack-ready', {engine: voicePackEngine()});
    if (ui.modal === 'menu') renderModal();
  }
});
initPremiumAudio();
render();
