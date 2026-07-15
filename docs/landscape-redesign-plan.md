# Moonfall: Landscape Living-Village Redesign — Design & Implementation Plan

This plan turns Moonfall from a portrait, panel-and-card app into a landscape
"living village" game: the town square becomes the playing surface, every
action is performed by tapping characters in the scene, every phase and
scenario has a short visual vignette, and points accumulate across rounds
until the host closes the table. It also permanently fixes the sound-leak
problem by making the storyteller device the only speaker.

**Implementation status (Moonfall 3.0): complete.** The paired day/night
plates, nine transparent 4×5 character sheets, six hero props, public death
director, private role vignettes, scoring, rematches and final podium now ship
in the production build. Remaining items in this document are optional future
garnish, not blockers.

---

## 1. The target experience (what a round feels like)

Phone held sideways. The whole screen is the painted village square. There is
no panel of instructions — the scene *is* the interface.

- **You join** → your character walks in from the edge of the square and
  takes their place in the crowd. The lobby is literally people arriving.
- **Cards are dealt** → one card back drifts down to you. You tap it, it
  flips (the one place a card still exists — your original identity), and
  as it fades your sprite quietly changes into your true self. Only on your
  phone.
- **"The Seer wakes"** → on the Seer's phone the crowd dims, her sprite
  steps forward glowing violet, and the village stands before her. She taps
  a person (they highlight and step forward), taps the floating **✓**, mist
  curls around the target and their sprite shimmers into their true form —
  permanently, on her phone. Everyone else's phone just shows the sleeping
  village under moonlight. No text needed beyond the narrator's voice from
  the speaker in the middle of the table.
- **The pack wakes** → wolves see each other as wolves, prowling animation
  on. Each wolf taps a victim; agreement is shown by paw marks converging on
  one person. Confirm is silent and visual only.
- **The Witch wakes** → the victim's sprite lies collapsed centre-stage.
  Two bottles float at the screen edge: green over the body to save (smoke
  swirl, the sprite gets back up), red onto anyone to poison. Or wave them
  away.
- **Cupid, night one** → Cupid draws a bow; the two chosen walk to centre,
  an arrow arcs across the screen, a ribbon ties them, hearts drift up.
  Lovers see the heart tether above both sprites for the rest of the game
  (their phones only).
- **Dawn** → every phone plays the same public scene: the sun rises over
  the square, and either the village stirs untouched, or one character is
  found fallen — claw slash, collapse into a ghost, their true card revealed
  once, then the ghost stays where they stood for the rest of the game.
- **The vote** → tap the accused in the square; your tap plants a token at
  their feet visible only to you until the ballot seals, then all tokens
  appear, the condemned steps forward, and the reveal plays.
- **Game over** → victory vignette per outcome (pack howling on the roofs /
  village cheering / lovers alone in the square), then the **scoreboard**:
  points rain onto each survivor, running session totals, and the host's
  choice: *Next hunt* or *End the table*.

Sound: everything above comes out of **one** phone — the host's — ideally on
a Bluetooth speaker in the middle of the table. Player phones are silent and
do not vibrate during live play; even tactile timing could reveal a private
wake across a quiet table.

---

## 2. Landscape orientation

### 2.1 Locking / prompting
- `manifest.webmanifest`: `"orientation": "landscape"` — installed PWA
  launches sideways on Android and iOS home-screen apps.
- In-browser: call `screen.orientation.lock('landscape')` after the
  fullscreen request (already in the menu). Works on Android/Chrome;
  **iOS Safari cannot lock**, so add a full-screen "rotate your phone"
  interstitial shown whenever `matchMedia('(orientation: portrait)')`
  matches during a game. Lobby/home can stay orientation-neutral.
- Keep `viewport-fit=cover` and move the safe-area padding to left/right
  (`env(safe-area-inset-left/right)`) for notches in landscape.

### 2.2 Layout (replaces the 560px portrait column)
One grid, three zones, village always visible:

```
┌────────────┬──────────────────────────────┬────────────┐
│  IDENTITY  │                              │   ACTION   │
│  (left     │      TOWN SQUARE STAGE       │   (right   │
│   rail)    │   full-bleed scene, tappable │    rail)   │
│            │                              │            │
├────────────┴──────────────────────────────┴────────────┤
│  phase strip: moon icon · "Night II" · tiny status dots │
└─────────────────────────────────────────────────────────┘
```

- **Stage (centre, ~70% width):** the existing `#village` town square,
  promoted from fixed backdrop to the primary interactive layer. All
  target selection happens by tapping sprites here.
- **Identity rail (left):** your own character portrait/sprite, role sigil,
  and persistent knowledge (Witch's remaining bottles, Sheriff badge, lover
  heart). Replaces the role text panels — tap-and-hold your portrait to
  peek the full card and rule text if you need the reminder.
- **Action rail (right):** at most one contextual control at a time — a
  confirm ✓, the two potion bottles, the "spare no one" moon, the ready
  lantern for discussion. Icon-first, one short label maximum.
- **Phase strip (bottom, ~40px):** replaces the big `phase-ribbon`
  headline + subtitle. A moon/sun icon, "Night II", and ready-count dots.
  All the old instructional copy ("The ballot seals when the last vote
  falls…") is deleted or moved into the narrator's spoken lines.
- Lobby, settings and menus can remain simple panels — they're not
  gameplay; only in-game screens get the stage treatment.

### 2.3 Instruction removal
Rule: **if the narrator says it, the screen doesn't print it.** The screen
shows *state* (who, what, glow colour), the speaker carries *instruction*.
First-game training wheels: a one-line hint chip that auto-hides after each
mechanic has been used once per device (stored in localStorage), so new
players get told "tap a villager, then ✓" exactly once, ever.

---

## 3. Sprite & animation system

### 3.1 Approach: DOM sprites + CSS `steps()` + procedural effects
Stay with DOM/CSS (no canvas rewrite). Each character is a positioned
element as today; animation comes from three layers, each usable
independently:

1. **Sheet animations** (when art exists): horizontal frame strips played
   with `animation: <name> steps(N)` on `background-position`. 4–8 frames
   at 6–10 fps — deliberately storybook, not 30fps.
2. **Puppet animations** (works with today's single-frame sprites): CSS
   transform keyframes on the whole sprite — walk-bob, prowl-lean, step
   forward, collapse (rotate + drop), rise, recoil, hop. This ships the
   entire redesign *before any new art arrives*; sheets replace puppets
   per-animation as they land.
3. **Procedural effects** (JavaScript/SVG/CSS, no assets needed): Cupid's
   arrow arc, drifting hearts, the ribbon tether, claw slashes (already an
   SVG), potion smoke, seer mist and shimmer, vote tokens, badge glint,
   point sparkles, sun/moon transit. Small emitter helper (~100 lines)
   spawning short-lived absolutely-positioned elements on the stage.

### 3.2 New module: `src/sprites.js`
- Loads `assets/sprites/pack.json` (new manifest). For each role ×
  animation it records file, frame count, frame size and fps.
- `spriteEl(role, anim)` returns/updates a stage element; if the sheet for
  `anim` is missing it falls back to the static webp + the matching puppet
  class. **Nothing ever breaks on missing art.**
- Animation vocabulary (superset; every one has a puppet fallback):
  `idle`, `walk`, `step-forward`, `act` (role-flavoured: wolf lunge, witch
  stir, seer gaze, cupid draw), `collapse`, `rise`, `ghost-idle`, `cheer`,
  `despair`.

### 3.3 Interactive stage
`village.js` grows into the interaction surface:
- `data-selectable` phases: tapping a sprite selects it (step-forward +
  glow ring at feet), replacing every `.target-table` / `.choice-grid`
  card list. Confirm lives in the action rail.
- Selection legality stays exactly where it is now — in the engine — the
  stage only offers living, legal targets (dimmed sprites are untappable).
- Keep positions stable per game (current hash layout), but recompute the
  spread for landscape: wider, shallower rows (2 rows up to ~13 players).
- Accessibility: sprites remain `<button>`s with proper `aria-label`s
  (they already are), and `prefers-reduced-motion` keeps its global kill
  switch (already in styles.css).

---

## 4. Cutscene director

### 4.1 New module: `src/cutscene.js`
A tiny declarative timeline runner over the stage. A scene is data:

```js
{
  id: 'cupid-binds',
  audience: 'cupid+lovers',      // who may see it (knowledge rule)
  steps: [
    {actor: 'cupid', anim: 'act'},
    {actors: ['loverA','loverB'], move: 'centre', anim: 'walk', over: 1200},
    {effect: 'arrow', from: 'cupid', to: 'midpoint'},
    {effect: 'tether', between: ['loverA','loverB']},
    {effect: 'hearts', at: 'midpoint', for: 1800},
    {wait: 600}
  ]
}
```

The runner resolves actor ids to stage sprites, tweens positions with CSS
transitions, fires effects, and returns a promise so the app can hold the
confirm/next control until the scene ends. Skippable by tap-and-hold
(replays never gate game state — the engine has already resolved).

### 4.2 Secrecy rules (hard requirements)
- Every scene declares an **audience**; phones outside it play the neutral
  "sleeping village" idle instead. Wolves' kill choice, Seer's vision and
  the Witch's decision are private scenes; only their *public consequences*
  (dawn death, no death) play for everyone.
- **Uniform duration:** each night phase runs a fixed on-screen time window
  on every phone regardless of whether that phone is acting, so screen
  glow/timing can't out a role (the narrator already gates phases; scenes
  fit inside those gates).
- **No sound, no vibration** on private night actions. Ever. (§5.)

### 4.3 Scene catalogue (v1)
| Scene | Audience | Visuals |
|---|---|---|
| Player joins | all | walk-in from square edge |
| Role deal | self | card drifts down, flip, sprite transforms |
| Thief swap | thief | two cards at table edge, chosen one glows, sprite transforms |
| Cupid binds | cupid, then lovers | bow draw, arrow arc, tether + hearts |
| Lovers learn | each lover | heart descends on you and your lover |
| Seer vision | seer | mist, target shimmer into true form (persists) |
| Wolf hunt | wolves | pack prowl-idle, paw marks converge on target |
| Witch's hour | witch | victim collapsed centre, bottles, smoke save / poison wisp |
| Dawn: death(s) | all | sunrise, claw slash or poison wisp, collapse → ghost, one-time card reveal |
| Dawn: saved/quiet | all | sunrise, everyone stirs; (healed: faint smoke over one chimney) |
| Sheriff elected | all | badge tossed, catch, glint |
| Vote & lynch | all | tokens at feet, condemned steps forward, reveal, collapse |
| Hunter's shot | all | fallen hunter raises rifle, flash, second collapse |
| Lover chain-death | all | tether snaps, second collapse onto the first |
| Little Girl caught | all | lantern flicker, substitution collapse |
| Victory ×3 | all | wolves howl on roofs / village cheers / lovers alone |
| Scoreboard | all | points rain onto survivors, totals tick up (§6) |

All of the above are achievable with **puppets + procedural effects on
day one**; sheets only make them prettier.

---

## 5. Audio: the storyteller device is the only speaker

### 5.1 The bug being fixed
Phase cues are already gated by `isTableVoice()` (app.js:504), but every
interaction handler — `sound('tap'/'select'/'flip'/'decision'/…)` at
app.js:2032–2268 — plays on **whichever phone was tapped**. Worse, the
premium role-SFX pack remaps those same sample ids (app.js:327), so a
werewolf confirming a kill got a themed kill-thump out of their own phone.
That is how you were outed.

### 5.2 New rule (single choke point)
Inside `sound()` itself (and `playVoicePack`/ambience, already mostly
gated): **if this device is not the table voice, return immediately.**
No per-call-site auditing to maintain; a new `sound()` call added next
year cannot leak either.
- Player feedback is visual-only (selection glow). Haptics stay *off* during
  live play — a buzzing phone on a wooden table is audible too.
- Host phone additionally plays *event* sounds for public moments, driven
  by state changes (as `phaseSound` does now), never by whose finger did it.
- Settings gains one switch: **Table speaker — This device / Silent**
  (default: host = speaker, everyone else silent). Covers the Bluetooth-
  speaker-in-the-middle setup with zero extra work, and lets a host mute
  if the speaker phone is someone else on Resume.
- The four solo/test modes keep local sound (agent table already does).

---

## 6. Points & multi-round sessions

### 6.1 Session model (engine)
A `session` object lives beside game state on the coordinator and
survives `game-over`:

```js
session: {
  round: 3,
  scores: { [playerId]: {name, total, rounds: [{round, delta, reasons}]} },
  history: [{round, winner: 'wolves', survivors: [...]}]
}
```

Identity across rounds keys off the persistent seat/player id already used
for Resume. New joiners mid-session start at 0. Session persists in the
host's saved state so Resume keeps the running totals.

### 6.2 Scoring v1 (simple, tunable in one table)
| Event | Points |
|---|---|
| Your team wins the round | +3 |
| You survive to the end of the round | +2 |
| You die during the round | −1 |
| Wolf: pack outnumbers/wins with you alive | +1 extra |
| Seer: vision on an actual wolf (any night) | +1 |
| Witch: heal that prevented a death / poison that hit a wolf | +1 |
| Hunter: final shot fells a wolf | +2 |
| Lovers: both alive at round end | +2 each |
| Village: your day-vote was cast against a wolf who got lynched | +1 |

All computed in the engine at `game-over` from a host-only round fact ledger
(deaths, causes, visions, potions, votes). That ledger is never included in a
player view, so nothing new can leak mid-game. Reasons are stored so the scoreboard
can *show why* ("Survived +2 · Your team won +3 · Lynched a wolf +1").

### 6.3 Round loop
- `game-over` → victory vignette → **scoreboard scene** (running totals,
  round deltas, leader crown).
- Host choices: **Next hunt** (same lobby, same seats, fresh shuffle —
  straight to role deal, skipping setup) or **End the table** (final
  podium scene: top three step forward, session summary, then back to
  lobby with session cleared).
- Presets/roles editable between rounds from the scoreboard if the host
  wants to mix it up.

---

## 7. What I need from you (asset shopping list)

**Nothing is blocking.** The production assets below are now present and wired.

### 7.1 Backgrounds (highest impact, smallest count)
| Asset | Spec |
|---|---|
| Village square, landscape, night | Shipped: `assets/sprites/bg/square-night.webp` |
| Matching daylight square | Shipped: `assets/sprites/bg/square-day.webp`; CSS crossfades the plates while the sky glows arc in opposite directions |
| Optional: rooftops silhouette strip | for the wolves' victory scene, transparent, ~2400×400 |

### 7.2 Character sheets (the big ask — but incremental)
All nine roles — werewolf, villager, seer, witch, cupid, little-girl,
thief, sheriff and hunter — ship as transparent 4×5 WebP sheets. The
Werewolf now has a chain-free death row and the Hunter has a dedicated
crossbow sheet.

| Animation | Frames | Notes |
|---|---|---|
| idle | 2–4 | breathing/swaying; replaces CSS sway |
| walk | 4–6 | side profile ok; we mirror in CSS |
| act | 2–4 | role-flavoured: wolf lunge, seer gaze, witch stir, cupid bow-draw, hunter aim |
| collapse | 4–6 | standing → on the ground (final frame doubles as the corpse) |
| ghost idle | 2 | or we keep the current tint/float treatment on `idle` |
| cheer / despair | 2–3 | shared endgame reactions — a generic set reused by all roles is fine |

**Format rules (please keep to these):**
- One horizontal strip per animation, PNG or WebP, transparent background.
- Frame size **256×384** (2:3, matches current proportions), character
  feet on a consistent baseline ~16px above the bottom edge, consistent
  scale across all roles, light source top-left (matches current art).
- Naming: `{role}.{anim}.{frames}f.webp` → e.g. `werewolf.walk.6f.webp`.
  Individual numbered frames are fine too — a build script will stitch
  strips and write `assets/sprites/pack.json` automatically.
- Rough is fine. 4 frames at 8fps reads as charming; missing animations
  fall back to puppet movement on the idle/static image, per animation,
  per role. Send one role's `idle` + `walk` first so we can lock the
  pipeline before you draw the rest.

### 7.3 Props (optional — all have procedural fallbacks I'll draw in code)
Shipped as transparent PNG: heart arrow, green potion, red potion, crystal
ball, Sheriff badge and vote token. Hunter muzzle/bolt light remains code-led.

### 7.4 Audio
**Nothing needed.** Existing voice pack, ambience and stings cover the new
scenes; they just get routed to the storyteller device only.

---

## 8. Implementation milestones

| # | Milestone | Contents | Status |
|---|---|---|---|
| M1 | **Silence & sideways** | audio choke point, zero private haptics, orientation lock/interstitial, landscape stage | Complete |
| M2 | **The square is the game** | tap-to-target for every role, ballot and final interrupt | Complete |
| M3 | **Motion** | 4×5 step sprites plus arrow, heart, mist, slash, token and spell effects | Complete |
| M4 | **Cutscenes** | `cutscene.js` public/private catalogue driven by narrator-gated phases | Complete |
| M5 | **New art drop-in** | nine sheets, paired world plates, registry and six transparent props | Complete |
| M6 | **The long hunt** | parity win, score reasons/totals, editable between-round deck, rematch, podium and Resume persistence | Complete |

Each milestone is independently shippable and testable at the five-agent
local test table. Suggested order is as listed; M6 can be pulled earlier
if you want scoring before the visual work — it's engine-only and doesn't
touch the stage.

### Testing
- Engine tests extend for scoring and session round-trip (`tests/engine.test.mjs`).
- New secrecy test: render every phase's stage HTML for every role's view
  and assert no private role/sfx/scene markers appear in the wrong view
  (builds on the existing `village.test.mjs` knowledge-rule tests).
- UI smoke test gains a landscape-viewport pass.

### Risks & mitigations
- **iOS won't lock orientation in-browser** → rotate interstitial +
  landscape PWA install prompt (install is already promoted on the home
  screen).
- **DOM animation cost with ~19 sprites** → transforms/opacity only,
  `will-change` only while a scene runs, steps() sheets are cheap.
- **Timing leaks** (a phone that animates longer = a role) → fixed-window
  night phases; private scenes are silent and length-normalised.
- **Peer sync of scenes** → scenes are driven by `phaseSerial`/state
  transitions each phone already receives; every phone plays locally, no
  new network messages, late-joiners just skip to end-state.
