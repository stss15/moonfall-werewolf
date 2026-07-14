# Moonfall

Moonfall is a mobile-first, around-the-table adaptation of the classic Werewolves social-deduction game. It uses direct, encrypted browser-to-browser connections through Trystero; there is no account, game database, paid backend or permanent score.

Nobody sits out as a Storyteller. Every joined person receives a character card, while the host phone also acts as the automatic room voice. Its narration gates the turn: a role's controls stay hidden until the spoken wake cue finishes, and a completed action triggers the sleep cue and next phase automatically. Debate advances through an all-player ready check, ballots close when every living player has voted, and Werewolves choose privately on their own phones until the pack reaches unanimous consensus.

### The town square

Every character stands in the middle of the screen as a painted sprite, and each phone dresses the crowd by what its owner truly knows. Your own sprite wears your real role; werewolves see their packmates as wolves; the Seer permanently sees the true form of everyone her visions have touched; the dead become ghosts that stay where they stood, their identity revealed once the village turns their card; lovers see a heart above both bound souls on their phones alone; the Sheriff's badge shines for everyone — and everybody else simply looks like a villager. Tap a character to see their name. The crowd is driven entirely by real game state, so the square remembers exactly who fell and what they turned out to be.

### Night whispers

Phones can do what cards cannot: give every player a *different fragment of the truth*. When each night resolves, every character privately receives one short observation — some are real evidence generated from what genuinely happened (a trail past the victim's cottage, more than one set of footsteps, sweet smoke from a late chimney after a healing, a pale lantern held high), and some are ordinary village noise. Nobody can tell which kind they hold, whispers never name a role, and several players may receive the same true line and corroborate one another — or get caught inventing one. Repeat yours, twist it, or bury it: the whisper system exists to feed the day's argument, and it makes every game tell a different story.

The game has no looping music track. Its Web Audio soundscape combines generated night/day ambience with layered procedural effects and four tiny CC0 Kenney foley transients for selection, healing, killing and the Hunter. A master compressor and limiter keep cues clear on phone speakers. Voice-over, ambience and sound effects can each be toggled from the in-game menu.

### The narrator voice pack

The narration script is fixed, so it is pre-recorded once into short composable clips that the game sequences at runtime — `wake-village` + `dawn-death` + `reveal` + `role-werewolf` becomes a complete spoken passage. Every line has several phrasing variants and the game picks one at random per playback, so no two rounds sound identical. Without a pack the game falls back to the phone's own offline Web Speech voices.

**Premium audio (one-shot, free tier):** add an `ELEVENLABS_API_KEY` repository secret, then run the **Generate premium audio** workflow from the Actions tab. It renders the whole variant script with an expressive storyteller voice, plus looping night/day ambience and hero stings (howl, kill, heal, victory) via ElevenLabs sound generation, and commits the audio to the repo. Deploys reuse the committed files and never spend credits again; the script checks the account quota before every call and refuses to drop below its reserve, so it cannot exceed the free tier. ElevenLabs' free tier requires attribution (shown in the in-game settings) and is non-commercial.

Local/manual generation uses `python3 scripts/generate_voice_pack.py` with three free engines:

- **ElevenLabs** (best quality, most intonation): set `ELEVENLABS_API_KEY`; pick any voice with `ELEVENLABS_VOICE_ID` (default is George, an expressive British storyteller).
- **Microsoft Edge neural voices** (default, no account): `pip install edge-tts`. Uses `en-GB-RyanNeural`, slowed and pitched down.
- **Kokoro** (fully local, Apache-2.0 open weights): `pip install kokoro-onnx`, place the model files next to the script, and run with `VOICE_ENGINE=kokoro`.

If `ffmpeg` is installed, each clip is also given a stone-hall storyteller treatment — a slight pitch-down, soft high roll-off, cavernous echo and loudness normalisation — so any engine comes out sounding like it belongs at a midnight table.

The lobby shows a scannable QR code alongside the six-character village code, so friends can point a phone camera at the host's screen and land directly in the room.

Moonfall is an installable Progressive Web App. Installed mode launches in a standalone/fullscreen portrait window, and an in-game control requests browser fullscreen when supported. Every joined phone requests a Screen Wake Lock. If a mobile OS suspends the web app or the connection changes, the client re-announces its saved seat on the existing peer room and the coordinator sends a fresh private view of the current game state.

## Play locally

```bash
npm install
npm run build
npx serve dist
```

Open the HTTPS/local address on each phone. One device creates a village and stays open as the temporary coordinator and room speaker. Its owner still receives a normal secret character and takes every turn on that same phone.

## Deploy

- **GitHub Pages (recommended, free):** the included workflow (`.github/workflows/deploy.yml`) tests, builds and publishes `dist/` on every push to `main`. One-time setup: in the repository go to **Settings → Pages** and set **Source** to **GitHub Actions**. The game then lives at `https://<user>.github.io/moonfall-werewolf/` — share that link or the in-lobby QR code with friends.
- Netlify: connect this folder and use the included `netlify.toml`, or deploy `dist/`.
- Vercel: import this folder; `vercel.json` points the build at `dist/`.
- Static host: upload everything inside `dist/`.

The host tab must remain open while a game is in progress. If it reloads, the host can use **Resume** and returning players reclaim their saved seats.

Mobile operating systems may still suspend networking when a user deliberately switches apps or locks the device. The wake lock prevents ordinary screen timeout while Moonfall is visible; automatic reconnection handles the unavoidable suspension case when the player returns.

The home screen also includes a five-agent local test table for exercising the real cards, sounds and phase engine without gathering devices. During multiplayer games, **Menu → Copy connection diagnostics** exports a privacy-safe ring buffer of visibility, relay, peer and connection events for troubleshooting; it excludes seat keys, roles and private action payloads.

## Rules implemented

The full original base collection is supported: Werewolves, Simple Villagers, Seer, Witch, Hunter, Cupid and lovers, Little Girl, Thief and Sheriff. The setup/awakening order, one-use potions, Sheriff double vote and succession, Hunter death shot, lover chain-death, ties, role reveals and all three victory paths are handled by the game engine. All targets appear as face-down table cards labelled with player names on the active person's own phone; nobody has to reach across the physical table.
