from pathlib import Path


def patch_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        print(f"skip: {label} already applied")
        return text
    if old not in text:
        raise SystemExit(f"Patch target not found: {label}")
    print(f"apply: {label}")
    return text.replace(old, new, 1)


app_path = Path("src/app.js")
app = app_path.read_text()

app = patch_once(app, "const APP_VERSION = '2.6.0';", "const APP_VERSION = '2.7.0';", "app version")
app = patch_once(
    app,
    "const premiumLoops = {};\nconst premiumStings = {};",
    "const premiumLoops = {};\nconst premiumStings = {};\nconst roleSfxVariants = {};",
    "role SFX state",
)

old_init = """    for (const [slot, file] of Object.entries(data?.stings || {})) {
      SFX_FILES[`sting-${slot}`] = `assets/ambience/${file}`;
      premiumStings[slot] = `sting-${slot}`;
    }
    diagnostic('premium-audio-ready', {loops: Object.keys(premiumLoops), stings: Object.keys(premiumStings)});"""
new_init = """    for (const [slot, file] of Object.entries(data?.stings || {})) {
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
    diagnostic('premium-audio-ready', {loops: Object.keys(premiumLoops), stings: Object.keys(premiumStings), roleSfx: Object.keys(roleSfxVariants)});"""
app = patch_once(app, old_init, new_init, "premium role pack loader")

old_sound_start = "function sound(kind = 'tap', delay = 0) {"
new_sound_start = """function premiumVariant(slot) {
  const variants = roleSfxVariants[slot];
  if (!variants?.length) return null;
  return variants[Math.floor(Math.random() * variants.length)];
}

function sound(kind = 'tap', delay = 0) {"""
app = patch_once(app, old_sound_start, new_sound_start, "premium variant helper")

old_sound_route = """  try {
    // Generated hero effects replace the procedural versions when present.
    const sting = {howl: ['howl', .5], kill: ['kill', .55], heal: ['heal', .42], victory: ['victory', .5]}[kind];"""
new_sound_route = """  try {
    const roleSlot = {keys: 'thief', cupid: 'cupid', lovers: 'lovers', seer: 'seer', 'wolf-cue': 'wolves', 'little-girl': 'little-girl', witch: 'witch', kill: 'death', heal: 'revive', hunter: 'hunter', sheriff: 'sheriff', vote: 'judgement'}[kind];
    const roleSample = premiumVariant(roleSlot);
    if (roleSample) {
      const volume = {wolves: .54, death: .5, revive: .42, 'little-girl': .32, cupid: .38, lovers: .32, seer: .34, witch: .4, thief: .35, hunter: .48, sheriff: .36, judgement: .36}[roleSlot] || .4;
      sample(context, roleSample, {at, volume});
      return;
    }
    // Generated hero effects replace the procedural versions when present.
    const sting = {howl: ['howl', .5], kill: ['kill', .55], heal: ['heal', .42], victory: ['victory', .5]}[kind];"""
app = patch_once(app, old_sound_route, new_sound_route, "role SFX routing")

old_phase_roles = """  if (next === 'setup-thief') return sound('keys');
  if (next === 'setup-cupid' || next === 'setup-lovers') return sound('cupid');
  if (next === 'night-seer') return sound('seer');
  if (next === 'night-wolves') return sound('wolf-cue');
  if (next === 'night-witch') return sound('witch');"""
new_phase_roles = """  if (next === 'setup-thief') return sound('keys');
  if (next === 'setup-cupid') return sound('cupid');
  if (next === 'setup-lovers') return sound('lovers');
  if (next === 'night-seer') return sound('seer');
  if (next === 'night-wolves') {
    sound('wolf-cue');
    if (view.settings?.roles?.includes('little-girl')) sound('little-girl', 2.1);
    return;
  }
  if (next === 'night-witch') return sound('witch');"""
app = patch_once(app, old_phase_roles, new_phase_roles, "phase role routing")

old_dawn = """  if (next === 'dawn') {
    const deathAtDawn = Boolean(view.lastDeaths?.length);
    if (deathAtDawn) sound('kill');
    return sound('dawn', deathAtDawn ? .95 : 0);
  }"""
new_dawn = """  if (next === 'dawn') {
    const deathAtDawn = Boolean(view.lastDeaths?.length);
    const healedAtDawn = Boolean(view.nightResult?.healed);
    if (deathAtDawn) sound('kill');
    else if (healedAtDawn) sound('heal');
    return sound('dawn', deathAtDawn ? 3.8 : healedAtDawn ? 3.1 : 0);
  }"""
app = patch_once(app, old_dawn, new_dawn, "dawn death/revive audio")

app = patch_once(
    app,
    "  if (next === 'day-result') return sound('decision');",
    """  if (next === 'day-result') {
    if (view.lastDeaths?.length) {
      sound('kill');
      return sound('decision', 3.8);
    }
    return sound('decision');
  }""",
    "day execution audio",
)

app = patch_once(app, "volume: .0065", "volume: .0022", "procedural cricket volume")

old_loop = """      const gain = context.createGain();
      const now = context.currentTime;
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(kind === 'night' ? .5 : .38, now + 2.5);
      gain.connect(sfxOutput(context));
      const loop = context.createBufferSource();
      loop.buffer = loopBuffer;
      loop.loop = true;
      loop.connect(gain);
      loop.start();
      ambience = {kind, gain, timer: null, stoppables: [loop]};"""
new_loop = """      const gain = context.createGain();
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
      ambience = {kind, gain, baseGain, timer: null, stoppables: [loop]};"""
app = patch_once(app, old_loop, new_loop, "premium ambience mix")

app = patch_once(
    app,
    "gain.gain.exponentialRampToValueAtTime(1, now + 2.5);",
    "gain.gain.exponentialRampToValueAtTime(.72, now + 2.5);",
    "procedural ambience master",
)
app = patch_once(
    app,
    "const state = {kind, gain, timer: null, stoppables: [wind, lfo, drone, droneLfo]};",
    "const state = {kind, gain, baseGain: .72, timer: null, stoppables: [wind, lfo, drone, droneLfo]};",
    "procedural ambience base gain",
)

old_start_ambience = "function startAmbience(kind) {"
new_start_ambience = """function setAmbienceDuck(active) {
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

function startAmbience(kind) {"""
app = patch_once(app, old_start_ambience, new_start_ambience, "ambience duck helper")

old_narrator = """async function playNarratorSequence(ids, text, {delay = 350} = {}) {
  const fallbackMs = Math.max(900, String(text || '').trim().split(/\\s+/).filter(Boolean).length * 510);
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
}"""
new_narrator = """async function playNarratorSequence(ids, text, {delay = 350} = {}) {
  const fallbackMs = Math.max(900, String(text || '').trim().split(/\\s+/).filter(Boolean).length * 510);
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
}"""
app = patch_once(app, old_narrator, new_narrator, "narrator ambience ducking")

old_delay = """      const opening = openingNarration(view);
      const delay = opening.ids?.[0] === 'nightfall' ? 2300 : phase === 'dawn' ? 650 : 350;
      await playNarratorSequence(opening.ids, opening.text, {delay});"""
new_delay = """      const opening = openingNarration(view);
      const phaseCueLead = {'setup-thief': 2100, 'setup-cupid': 2700, 'setup-lovers': 2500, 'night-seer': 2300, 'night-wolves': 4800, 'night-witch': 2700, 'sheriff-vote': 2100, 'day-vote': 1900, resolution: 2700};
      const deathReveal = (phase === 'dawn' || phase === 'day-result') && Boolean(view.lastDeaths?.length);
      const healedReveal = phase === 'dawn' && Boolean(view.nightResult?.healed) && !deathReveal;
      const delay = opening.ids?.[0] === 'nightfall' ? 2300 : deathReveal ? 4300 : healedReveal ? 3500 : phase === 'dawn' ? 850 : phaseCueLead[phase] || 350;
      await playNarratorSequence(opening.ids, opening.text, {delay});"""
app = patch_once(app, old_delay, new_delay, "role cue narrator lead-in")

app_path.write_text(app)

engine_path = Path("src/engine.js")
engine = engine_path.read_text()
engine = patch_once(
    engine,
    "    lastDeaths: [],\n    lastVote: null,",
    "    lastDeaths: [],\n    nightResult: {healed: false, poisoned: false},\n    lastVote: null,",
    "initial night result",
)
engine = patch_once(
    engine,
    "  state.lastDeaths = [];\n  state.lastVote = null;\n  state.winner = null;",
    "  state.lastDeaths = [];\n  state.nightResult = {healed: false, poisoned: false};\n  state.lastVote = null;\n  state.winner = null;",
    "start game night result",
)
engine = patch_once(
    engine,
    """  const deaths = [];
  if (victim && !state.actions.witchDraft.heal) deaths.push({id: victim, cause: state.actions.littleGirlCaught ? 'caught peeking' : 'the Werewolves'});""",
    """  const deaths = [];
  state.nightResult = {
    healed: Boolean(victim && state.actions.witchDraft.heal),
    poisoned: Boolean(state.actions.witchDraft.poisonTarget)
  };
  if (victim && !state.actions.witchDraft.heal) deaths.push({id: victim, cause: state.actions.littleGirlCaught ? 'caught peeking' : 'the Werewolves'});""",
    "resolve night result",
)
engine = patch_once(
    engine,
    "  state.lastDeaths = [];\n  state.lastVote = null;\n  state.winner = null;\n  for (const player",
    "  state.lastDeaths = [];\n  state.nightResult = {healed: false, poisoned: false};\n  state.lastVote = null;\n  state.winner = null;\n  for (const player",
    "reset lobby night result",
)
engine = patch_once(
    engine,
    "    lastDeaths: clone(state.lastDeaths),\n    lastVote: clone(state.lastVote),",
    "    lastDeaths: clone(state.lastDeaths),\n    nightResult: clone(state.nightResult || {healed: false, poisoned: false}),\n    lastVote: clone(state.lastVote),",
    "view night result",
)
engine_path.write_text(engine)

sw_path = Path("src/sw.js")
sw = sw_path.read_text()
if "const CACHE = 'moonfall-v12-role-audio';" not in sw:
    sw = patch_once(
        sw,
        "const CACHE = 'moonfall-v11-canonical-audio';",
        "const CACHE = 'moonfall-v12-role-audio';",
        "service worker cache bump",
    )
sw_path.write_text(sw)

print("Audio polish patch complete.")
