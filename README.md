# Moonfall

Moonfall is a mobile-first, around-the-table adaptation of the classic Werewolves social-deduction game. It uses direct, encrypted browser-to-browser connections through Trystero; there is no account, game database, paid backend or permanent score.

The game has no background track. Its procedural Web Audio soundscape uses private card-flip and confirmation sounds plus Storyteller-only cues for nightfall, role awakenings, killing, the Hunter, dawn, elections, voting and victory. Secret night choices remain silent on role phones, while the currently awakened phone gains a visible aura.

Moonfall is an installable Progressive Web App. Installed mode launches in a standalone/fullscreen portrait window, and an in-game control requests browser fullscreen when supported. Every joined phone requests a Screen Wake Lock. If a mobile OS suspends the web app or the connection changes, the client rebuilds its peer room and reclaims the saved seat; the coordinator then sends a fresh private view of the current game state.

## Play locally

```bash
npm install
npm run build
npx serve dist
```

Open the HTTPS/local address on each phone. One device creates a village and stays open as the temporary coordinator. That person still plays: the Storyteller is selected randomly from everyone in the room.

## Deploy

- Netlify: connect this folder and use the included `netlify.toml`, or deploy `dist/`.
- Vercel: import this folder; `vercel.json` points the build at `dist/`.
- Static host: upload everything inside `dist/`.

The host tab must remain open while a game is in progress. If it reloads, the host can use **Resume** and returning players reclaim their saved seats.

Mobile operating systems may still suspend networking when a user deliberately switches apps or locks the device. The wake lock prevents ordinary screen timeout while Moonfall is visible; automatic reconnection handles the unavoidable suspension case when the player returns.

The home screen also includes a five-agent local test table for exercising the real cards, sounds and phase engine without gathering devices. During multiplayer games, **Menu → Copy connection diagnostics** exports a privacy-safe ring buffer of visibility, relay, peer and connection events for troubleshooting; it excludes seat keys, roles and private action payloads.

## Rules implemented

The full original base collection is supported: Werewolves, Simple Villagers, Seer, Witch, Hunter, Cupid and lovers, Little Girl, Thief and Sheriff. The official setup/awakening order, one-use potions, Sheriff double vote and succession, Hunter death shot, lover chain-death, ties, role reveals and all three victory paths are handled by the game engine.
