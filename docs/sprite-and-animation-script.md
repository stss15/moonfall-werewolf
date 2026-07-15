# Moonfall — Complete Sprite, Animation & Scene Script

This is the master list: every sheet, every frame count, every prop and
background, every transition in the game, and — for each one — whether it
is **sprite-led** or done in **CSS/JS** with no art needed. It is written
against the nine character sheets already produced (witch, little girl,
thief, seer, werewolf, sheriff, hunter, villager, cupid).

Guiding rule throughout: **keep the art ask small.** Characters are
sprite-led; almost everything else (mist, hearts, flashes, fades,
spotlights, sun, moon, stars, sparkles, vote tokens' motion, the
"Pokémon-evolution" reveal) is code. Anything listed as *optional* has a
working code fallback and can be skipped forever.

---

## 1. The Moonfall Standard Sheet (what you've already invented)

Every sheet you sent follows the same grid — this now becomes the format
spec for all character art:

**One sheet per role · 4 columns × 5 rows = 20 cells**

| Row | Animation | Frames | Played as | Used for |
|---|---|---|---|---|
| 1 | `idle` | 4 | loop, 6 fps | standing in the square, all phases |
| 2 | `walk` | 4 | loop, 8 fps | entrances, stepping forward, lobby arrivals |
| 3 | `act` | 4 | one-shot or pose-picked (see §1.2) | the role's signature moment |
| 4 | `bound` | 4 | one-shot, 6 fps | lover chain: bound → distress → kneel → fallen |
| 5 | `death` | 4 | one-shot, 6 fps | wounded → kneeling → collapapsed → flat corpse |

The last frame of row 5 doubles as the **corpse** sprite. The **ghost** is
the idle frame with a CSS treatment (blue tint, transparency, slow float)
— already built, needs no art. Rows 4 and 5 ending "on the floor" is
exactly what the dawn reveals need.

### 1.1 Export requirements (the only rework on existing sheets)
The nine sheets are drawn — they just need a clean technical export:

1. **Transparent background** (current exports have an off-white paper
   background and dashed grid lines — both must go).
2. Uniform cell grid: **256×256 px per cell → 1024×1280 px per sheet**,
   WebP or PNG. Character centred horizontally in the cell.
3. **Consistent baseline**: feet (or corpse) sit on the same y-line in
   every standing/walking cell, roughly 16 px above the cell bottom.
4. Consistent scale across roles (the wolf being bulkier is good — same
   *world* scale, not same bounding box).
5. Naming: `assets/sprites/sheets/<role>.webp` — `werewolf.webp`,
   `villager.webp`, `seer.webp`, `witch.webp`, `hunter.webp`,
   `cupid.webp`, `thief.webp`, `little-girl.webp`, `sheriff.webp`.

If per-frame PNGs are easier to export than assembled sheets, deliver
`<role>/<row>-<frame>.png` and a build script will stitch them.

### 1.2 Notes on your row 3 ("act") frames — all usable as-is
Row 3 on some sheets is a frame *sequence* and on others four distinct
*poses*. Both work — the game picks frames by index, so:

- **Cupid**: nock → draw → loose → wave-with-hearts. Perfect one-shot.
- **Seer**: eye-rune touch → gazing into ball → cards over ball → casting.
  Used as poses: frame 2 loops during her turn, frame 4 on confirm.
- **Werewolf**: slash-dash → moon-howl → charging pounce → clawing. Howl
  (f2) is the night cue pose; pounce/claw (f3–f4) is the kill.
- **Witch**: raise potion → conjure orb → pour → spiral cast. Save = f3,
  poison = f4.
- **Hunter**: aim → lower → crouch-scout → startled. Final shot = f1.
- **Sheriff**: raise lantern → halt hand → badge glint → baton ready.
  Election scene = f3.
- **Villager**: lantern raise → kneel → wave → lantern celebration.
  These double as generic crowd reactions for everyone.
- **Little girl**: lantern high (peeking!) → hugging doll → hiding →
  pointing. Peek = f1, caught = f3.
- **Thief**: brandish → dangle amulet → crouch → dagger flourish.
  Card swap = f2.

### 1.3 Character art status
- **Werewolf `death` row (row 5) is fixed.** It now plays a chain-free
  wounded → kneel → collapse → corpse sequence. Row 4 remains the separate
  purple lover-chain death.
- The wolf's `act` howl frame also loses its painted moon in background
  extraction — harmless, since the game draws the sky moon itself.
- Otherwise **all nine playable roles are covered.** (The Storyteller
  never stands in the square; the Hunter previously borrowed the villager
  sprite and now has his own crossbow sheet — that gap is closed. In
  Moonfall's rules the Hunter fires his dying shot when his death is
  revealed, choosing any living player to fall with him — the `act` row's
  aim pose is his moment.)

Only *optional* extra character art, if you ever fancy it:
- A 6th row, `cheer`, 4 frames per role, for victory/scoreboard scenes.
  Fallback until then: idle frames + a springy CSS bounce, and the
  villager's celebration pose for the crowd. **Skippable.**

---

## 2. Backgrounds

| # | Asset | Spec | Priority |
|---|---|---|---|
| B1 | **Village square, night, landscape** | `assets/sprites/bg/square-night.webp` | **Shipped** |
| B2 | Village square, day plate | `assets/sprites/bg/square-day.webp`, crossfaded in CSS | **Shipped** |
| B3 | Rooftop silhouette strip | ~2400×400, transparent | Optional — for the wolves-win vignette; fallback is a CSS silhouette gradient |
| B4 | 2–3 foreground cutouts (house edge, tree, well) | transparent, ~600px | Optional — parallax depth on the stage; pure garnish |

The **sleep screen** (what everyone with closed eyes gets at night) is
deliberately zero-art: CSS night gradient, starfield, large glowing moon,
a closed-eye glyph. Identical on every phone so a glance at a neighbour's
screen reveals nothing. No asset required — per your note, there's no need
to make it beautiful for people whose eyes are shut.

---

## 3. Props & objects (single static images — all motion is code)

Each is one small transparent WebP. Every one has a code fallback, but
these are cheap and high-charm:

| # | Prop | Size | Used in | Priority |
|---|---|---|---|---|
| P1 | Heart-tipped arrow (loose, horizontal) | ~384×128 | flies across screen (JS arc) in Cupid/lover scenes | High |
| P2 | Green potion bottle | 256 | Witch save button | High |
| P3 | Red potion bottle | 256 | Witch poison button | High |
| P4 | Crystal ball (standalone, glowing) | 256 | Seer confirm control + zoom reveal | High |
| P5 | Sheriff star badge | 128 | election drop-and-glint, above-head mark | Medium |
| P6 | Vote token (wooden accusation marker) | 128 | day-vote markers at feet | Medium |
| P7 | Moon disc | 256 | night sky, "spare no one" button | Optional (CSS gradient works) |
| P8 | Sun disc | 256 | dawn rise | Optional (CSS works) |
| P9 | Lovers vignette — one generic image of two cloaked silhouettes hand-in-hand under the moon | ~800×600 | lover-reveal end beat | Optional — see §5.4 for why we do NOT draw per-couple art |

Already in hand and staying: role card portraits (`assets/*.webp`), card
back, claw-slash SVG, logo.

**Total genuinely-new art ask: 1 background + ~6 small props + a clean
re-export of the nine sheets.** That's the whole list. Lightweight.

---

## 4. Effects that are code, not art (so nobody draws them)

Hearts (drift/burst), ribbon/tether between lovers, purple mist & smoke
wisps, green heal-smoke, the white "evolution" flash, silhouette-to-reveal
tint, spotlights & crowd dimming, fades (out/in between beats), stars,
fireflies (exists), rain of score sparkles, screen-edge phase glow
(exists), nightfall/dawn veils (exist), card 3D flips (exist), ghost
treatment, selection rings at feet, paw-print consensus marks for the
pack, arrow flight paths, badge glint rays, confetti.

---

## 5. Interaction decisions (your open questions, answered)

### 5.1 Carousel vs. tap-the-village → **tap the village**
Targets are chosen by tapping mini-figures standing in the square — the
whole village in front of you, exactly like looking around the table.
A carousel was considered and rejected: with 10–18 players it's a lot of
swiping, you can't see the whole village at once (which is the fantasy),
and it's slower than one tap. The crowd layout already exists and scales
to 19 players in rows.

### 5.2 Anonymity during selection → **everyone is a villager + name plate**
During night selections, every candidate renders as the *villager* sprite
with their **name on a plate beneath** (rendered text — no name art
needed). Names are essential: when everyone wears the same villager
sprite, the name is the only identifier. Exceptions follow the knowledge
rules: wolves see packmates as wolves; the Seer sees her previously
revealed truths; your own sprite is always your true self.

### 5.3 Seer cadence (you asked)
The Seer acts **every night** — one reveal per night while she lives
(that's how the engine works today). Her collection of revealed truths
persists on her phone for the whole game, so her square fills with truth
as rounds pass.

### 5.4 Lovers "couple art" → **composite, don't draw**
Any two of nine roles can be bound (45 combinations — drawing them all
would be the opposite of lightweight). Instead the game composites the
two characters' own sprites side by side, ties them with a drawn-in-code
ribbon and heart particles, and (optionally) closes on the single generic
silhouette vignette (P9). Zero per-couple art, works for every pairing
forever, including future roles.

---

## 6. THE SCRIPT — every scene, beat by beat

Conventions: `role.row[frame]` refers to sheet cells (e.g.
`cupid.act[2]` = row 3, frame 2). "Sleepers" = every phone whose owner
should have eyes closed: they show the **sleep screen** (§2) for the whole
phase, full stop. All narration comes from the storyteller speaker only;
player phones are silent (haptics optional, never during night actions).
Every fade/zoom/particle below is CSS/JS. One-shot rows play at 6 fps
(~650 ms); loops cycle continuously.

### S1 · Lobby — the village gathers
- **Audience:** everyone. **Trigger:** player joins.
- New player's character (as villager) enters from screen edge —
  `villager.walk[1–4]` looping while translating in — then takes a stable
  spot and settles to `idle`. Name plate under each figure.
- Host sees the room code/QR in the side rail; the square fills as people
  join. *Assets: existing sheets only.*

### S2 · Role deal — the one card in the game
- **Audience:** each player privately. **Trigger:** `role-reveal`.
- Card back drifts down (CSS), tap → 3D flip (exists) revealing the role
  portrait. Card then shrinks/fades toward your figure in the square,
  which cross-fades villager → your true sprite, playing your `act`
  signature pose once as a hello. Your sprite is your true self on your
  phone from here on.
- *Assets: existing card back + portraits + sheets.*

### S3 · Thief's exchange
- **Audience:** Thief. Sleepers everywhere else.
- Thief's sprite steps forward (`thief.walk` ×2 steps), the two spare
  cards lie face down; tap to flip each; choosing one plays
  `thief.act[2]` (amulet dangle) while the cards swap with a CSS arc;
  his square figure cross-fades to the new role (his phone only).
- *Assets: existing.*

### S4 · Cupid binds two hearts
- **Audience:** Cupid. Sleepers elsewhere.
- Stage shows the whole village as villagers + names (§5.2). Cupid's own
  figure stands at the side in `cupid.idle`.
- Tap two figures → each steps forward, selection ring + small hearts
  bubble up (code). Confirm ✓ →
  `cupid.act[1→2→3]` (nock, draw, loose), arrow prop **P1** flies a bezier
  arc across the stage, bursts into hearts over the pair,
  `cupid.act[4]` (wave with hearts) as the button fades. ~2.5 s total.
- No target names leak anywhere else; sleepers saw a moon.
- *Assets: sheets + P1.*

### S5 · The lovers wake — arrow to the heart
- **Audience:** each lover privately; everyone else does the normal
  card-flip "is my heart my own?" beat (existing flow, kept).
- On a lover's phone: arrow **P1** flies in from off-screen and strikes
  centre-screen; **your own true-role sprite** recoils (CSS knockback +
  heart burst — deliberately *not* the bound row, that's for death); fade
  to black (400 ms); fade up on **both lovers side by side** — each
  rendered as their true sprite, `idle` loop, ribbon tether + drifting
  hearts (code); optional close on vignette **P9**. From now on both
  phones show the heart mark above both figures (exists).
- ~4 s, identical duration to the non-lover card flip so screen-time
  reveals nothing.
- *Assets: sheets + P1 (+ optional P9).*

### S6 · The Seer's vision — the "evolution"
- **Audience:** Seer. Sleepers elsewhere. Every night.
- Her figure steps forward; crystal ball **P4** glows beside the ✓ while
  she loops `seer.act[2]` (gazing). Village stands before her — villagers
  + names, except truths she already knows, which wear their true sprites.
- Tap target → step forward + ring. Confirm →
  `seer.act[4]` (cast), ball **P4** zooms to centre (CSS scale), target's
  sprite silhouettes to black inside the ball, white flash, and the
  silhouette resolves into their **true role sprite** — the Pokémon
  evolution beat, all filters and flashes, no art. Ball recedes; the
  truth stays standing in her square permanently.
- ~3 s. *Assets: sheets + P4.*

### S7 · The pack hunts
- **Audience:** each werewolf. Sleepers elsewhere (Little Girl may
  physically peek — that's a real-world rule, her phone sleeps too;
  her `little-girl.act[1]` lantern-peek pose is used in S13 if caught).
- Packmates render as wolves (`werewolf.idle` loop, occasional
  `walk[1–2]` prowl shuffle); everyone else villagers + names.
- Tap victim → a paw mark lands at their feet (code). Each wolf's mark is
  visible to the whole pack; when all marks converge on one name, the ✓
  lights. Confirm → the pack's figures play `werewolf.act[3→4]`
  (pounce/claw) once, **in total silence, no vibration**. No victim
  animation here — consequences are for dawn.
- *Assets: sheets.*

### S8 · The Witch's hour
- **Audience:** Witch. Sleepers elsewhere.
- Centre stage: tonight's victim lying flat — always shown as the
  **villager corpse** `villager.death[4]` regardless of true role (the
  Witch learns *who*, never *what*). Name plate beside them.
- Bottles **P2/P3** hover in the action rail (with her one-use state).
  - **Heal:** drag/tap P2 onto the body → `witch.act[3]` (pour), green
    smoke swirl (code), victim plays `villager.death[4→1]` **in reverse**
    — they get back up. 
  - **Poison:** tap P3 → crowd of villagers+names appears → pick target →
    `witch.act[4]` (spiral cast), purple wisp drifts to them, brief
    shudder, nothing more shown (dawn tells the rest).
  - **Neither:** wave-away gesture on the moon button.
- Fixed phase window regardless of choice. *Assets: sheets + P2 + P3.*

### S9 · Dawn — the reveal engine (public, every phone identical)
- **Trigger:** resolution → dawn. Sun rises: sky grade shifts, sun disc
  (P8 or CSS) climbs, crowd wakes to `idle`.
- **No deaths:** village stirs; if a heal happened, a faint green-tinged
  chimney smoke curl (code) — the existing whisper-evidence flavour.
- **Each death, sequentially (~4 s per victim):** spotlight dims the
  square → victim's figure (villager guise) plays `villager.death[1–4]`
  with the cause overlay:
  - wolf kill → claw-slash SVG rakes across (exists)
  - poison → purple wisp + green-lipped tint
  - heartbreak → see S11
  - then **fade out / fade in**: the corpse is now their **true role's**
    `death[4]` corpse frame + their role card shown once (exists) →
    settles into the permanent **ghost** (CSS-tinted idle) where they
    stood, on every phone, forever.
- *Assets: sheets (+ optional P8).*

### S10 · The Hunter's last shot (public interrupt)
- Dying hunter's phone: crowd of villagers+names, tap target, confirm.
- Public scene on all phones: hunter's figure rises to one knee,
  `hunter.act[1]` (aim), white muzzle flash (code), bolt streak (code
  line, or P1-style bolt), target plays their death sequence → same
  fade-reveal-ghost pipeline as S9.
- *Assets: sheets.*

### S11 · Lover chain-death (public, follows any lover death)
- The surviving lover's figure lights with the **bound** treatment: plays
  their own `bound[1→4]` — chains of light constrict, they kneel, they
  fall — while the ribbon tether (code) snaps and dissolves into hearts.
  Then the standard fade-reveal-ghost pipeline.
- This is exactly what your row 4 was drawn for, on every sheet, so any
  role can die of heartbreak. *Assets: sheets.*

### S12 · Electing the Sheriff (public, day)
- Day-graded square. Tap candidate → token at feet (private until
  sealed). Sealed → tokens pop visible, winner's figure steps forward,
  badge **P5** drops from the top, lands on them with a glint burst;
  `sheriff.act[3]` if the winner *is* the sheriff-role sprite on their
  own phone; everyone else just sees the badge mark (exists) shine above
  the winner. Succession on death replays the badge-drop onto the heir.
- *Assets: sheets + P5 (+ P6 tokens).*

### S13 · Little Girl caught (public, replaces the pack's victim)
- Dawn variant: lantern flicker in the dark (code glow), her figure in
  `little-girl.act[1]` (lantern high, peeking) → claw slash → her death
  row → reveal pipeline. *Assets: sheets.*

### S14 · The village votes (public, day)
- Same token mechanic as S12 on the whole living crowd. Ballot seals →
  all tokens appear at once → condemned steps to centre, beat of
  stillness, plays `death[1–4]` *in villager guise*, fade, true-role
  corpse + card, ghost. Tie → tokens scatter off screen (code), no death.
- *Assets: sheets + P6.*

### S15 · Victory vignettes (public)
- **Wolves win:** rooftop strip (B3 or CSS silhouette), the pack's true
  sprites in `werewolf.act[2]` (moon-howl) under a huge moon.
- **Village wins:** day square, survivors cheer — `villager.act[4]`
  celebration pose for crowd + CSS bounce (or the optional cheer row).
- **Lovers win:** empty night square, just the two of them, tether,
  slow-falling hearts (+ optional P9 close).
- *Assets: sheets (+ optional B3/P9).*

### S16 · Scoreboard & podium (public, multi-round)
- Score sparkles rain onto each survivor's figure with tick-up totals
  and reason lines; leader gets a small crown glyph (code). *End the
  table* → top three step forward on a simple platform (CSS blocks),
  everyone else cheers behind. *Assets: none new.*

### Ambient/system transitions (all existing or code)
Nightfall veil, dawn veil, phase edge-glow per role colour, screen
enter animations, fireflies, reduced-motion kill-switch — all already in
the codebase and kept.

---

## 7. In-game asset registry

The machine-readable version of this document lives at
`assets/sprites/pack.json`: one entry per role sheet (grid, row map,
fps), plus the prop and background lists with their code-fallback flags.
The runtime in `village.js` and `cutscene.js` follows it; **any missing
optional file has a CSS/JS fallback**, so future garnish can land
file-by-file without changing game rules.

---

## 8. The shopping list (everything, on one screen)

**Rework (complete):**
- [x] 9 role sheets: transparent, no grid lines, shared baseline →
      `assets/sprites/sheets/<role>.webp`

**New — complete:**
- [x] B1 night square and B2 matching day square

**New — small props, complete:**
- [x] P1 heart-tipped arrow · P2 green potion · P3 red potion ·
      P4 crystal ball · P5 sheriff star · P6 vote token

**Optional, any time, never blocking:**
- [ ] B3 rooftops · B4 parallax cutouts · P7 moon ·
      P8 sun · P9 lovers vignette · per-role `cheer` row

**Explicitly NOT needed (resolved in code):**
ghosts, corpses (row 5 frame 4), houses (painted into B1), name images
(rendered text), per-couple lover art (composited), sleep-screen art,
all particles/flashes/fades, sun/moon (CSS fallback), any new audio.
