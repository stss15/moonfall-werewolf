// The town square: every character stands in the middle of the screen as a
// painted, animated sprite. What each phone shows follows the game's
// knowledge rules —
//
//   · your own sprite wears your true role
//   · werewolves see their packmates as wolves
//   · the Seer sees the true form of everyone her visions have touched
//   · the dead become ghosts, staying where they stood, their true identity
//     revealed to all once the village has seen their card
//   · lovers see both bound souls in their chained pose (their phones only)
//   · the Sheriff's badge hangs above their head for everyone
//   · everyone else simply looks like a villager
//
// The square is also the game's selection surface: when a role must choose
// someone, the caller passes a selection context and the crowd becomes
// tappable — chosen characters step forward, illegal targets dim, and every
// name plate shows so identical villagers can be told apart.

const escText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[char]));

function hashOf(text) {
  let hash = 5381;
  const source = String(text || 'moonfall');
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

// Every playable role has an animated sheet (4 frames × 5 rows: idle, walk,
// act, bound, death). The storyteller never stands in the square.
const SPRITE_FOR = {
  villager: 'villager', werewolf: 'werewolf', seer: 'seer', witch: 'witch',
  cupid: 'cupid', 'little-girl': 'little-girl', thief: 'thief',
  hunter: 'hunter', sheriff: 'sheriff', storyteller: 'villager'
};

export const SHEET_ROWS = {idle: 0, walk: 1, act: 2, bound: 3, death: 4};

// One animated cell of a character sheet. Loops drive background-position-x
// through the four frames with steps(); the row is fixed inline. Browsers
// without steps(jump-none) simply hold the first frame.
//
// Idle is not a loop. Every sheet's idle row holds four real drawings — a
// stance, a roar, a snarl, a hunch — and cycling them at a constant rate
// reads as a twitch, which is why the crowd used to be frozen on frame 0
// instead. A crowd is alive when *most* of it is still and individuals move:
// so idle holds frame 0 for the great majority of a long cycle, then plays
// one unhurried flourish out and back. Duration and phase are seeded per
// character, so nineteen villagers never move together.
export function sheetSprite(roleId, {anim = 'idle', loop = true, speed = null, seedText = '', alive = true} = {}) {
  const sheet = SPRITE_FOR[roleId] || 'villager';
  const row = SHEET_ROWS[anim] ?? 0;
  const h = hashOf(seedText + sheet);
  const duration = speed || (anim === 'walk' ? 0.62 : 1.05 + (h % 40) / 100);
  // The dead hold still. 'bound' is a standing pose too (the chained lovers).
  const breathing = anim === 'idle' && alive;
  const playback = anim === 'idle' || anim === 'bound' ? (breathing ? 'idle-life' : '') : loop ? 'loop' : 'oneshot';
  // A negative delay drops each character at a different point in the cycle
  // from the very first frame, rather than making them all wait then sync.
  const idleStyle = breathing
    ? `;--ssidle:${(8 + (h % 78) / 10).toFixed(1)}s;--ssidledel:-${((h >> 5) % 150) / 10}s`
    : '';
  return `<span class="ss ${playback}"
    style="background-image:url('assets/sprites/sheets/${sheet}.webp');background-position:0% ${row * 25}%;--ssd:${duration.toFixed(2)}s;--ssdel:${((h >> 3) % 90) / 100}s${idleStyle}"></span>`;
}

// Eight of the nine roles ship a painted fallen figure (assets/sprites/
// dead-*.webp) that nothing has ever rendered — the square dressed its dead
// in the living idle frame under a blue filter instead. A kneeling, broken
// figure wearing that same spectral treatment is what "a ghost that stays
// where they fell" was always meant to look like. The Hunter has no fallen
// art, so that one role keeps the sheet-based ghost.
const FALLEN_ART = new Set(['villager', 'werewolf', 'seer', 'witch', 'cupid', 'little-girl', 'thief', 'sheriff']);

export function fallenSprite(roleId, {seedText = ''} = {}) {
  const sheet = SPRITE_FOR[roleId] || 'villager';
  if (!FALLEN_ART.has(sheet)) return null;
  const h = hashOf(seedText + sheet);
  return `<img class="fallen" src="assets/sprites/dead-${sheet}.webp" alt="" style="--sd:${((h >> 4) % 30) / 10}s">`;
}

// What this viewer knows this player to be.
function knownRole(view, player) {
  if (player.role) return player.role;
  const me = view.me;
  if (me && player.id === me.id && me.role) return me.role;
  if (me?.visions?.[player.id]) return me.visions[player.id];
  if (me?.pack?.includes(player.id)) return 'werewolf';
  return 'villager';
}

export function spriteFile(view, player) {
  const role = SPRITE_FOR[knownRole(view, player)] || 'villager';
  return player.alive ? role : `dead-${role}`;
}

function moodFor(view) {
  const phase = view.phase;
  if (phase === 'lobby') return 'night';
  if (phase === 'sheriff-vote' || phase.startsWith('day-')) return 'day';
  if (phase === 'dawn') return 'dawn';
  return 'night';
}

// select: {ids: Set of tappable player ids, selected: [], disabled: Set,
//          marks: {playerId: count}, victim: playerId|null, action: string}
// arrivals: Set of player ids that should walk in from the square's edge.
// acting:   true while the viewer is committing their own night action, so
//           their character plays its role's act pose — the wolf lunges, the
//           Seer gazes, the Witch stirs. Every sheet carries that row and
//           nothing in the square ever played it.
export function townSquare(view, {select = null, arrivals = null, acting = false} = {}) {
  const players = Object.values(view.players || {}).filter(player => !player.storyteller);
  if (!players.length) return '';
  const me = view.me;
  const seed = view.roomCode || 'MOONFALL';
  const freshIds = new Set((view.lastDeaths || []).map(death => death.id));
  const freshOrder = new Map((view.lastDeaths || []).map((death, index) => [death.id, index]));
  const cinematic = ['dawn', 'day-result'].includes(view.phase);

  // The crowd stands in staggered rows — nearer rows larger, every position
  // stable for the whole game so ghosts remain where they fell. Landscape
  // spreads wide, so rows stay shallow even for a nineteen-soul town.
  const count = players.length;
  const rowCount = count <= 10 ? 2 : 3;
  const rowSizes = [];
  for (let remaining = count, r = rowCount; r > 0; r -= 1) {
    const n = Math.ceil(remaining / r);
    rowSizes.push(n);
    remaining -= n;
  }
  const bottoms = rowCount === 2 ? [0, 34] : [0, 26, 48];
  const scales = rowCount === 2 ? [1, .8] : [1, .82, .66];
  const base = count <= 7 ? 'min(24svh,190px)' : count <= 12 ? 'min(21svh,164px)' : 'min(18svh,140px)';
  const selecting = Boolean(select?.ids?.size);
  const sprites = players.map((player, index) => {
    let row = 0;                                       // 0 = front
    let col = index;
    while (col >= rowSizes[row]) { col -= rowSizes[row]; row += 1; }
    const inRow = rowSizes[row];
    const h = hashOf(seed + player.id);
    const t = inRow === 1 ? .5 : col / (inRow - 1);
    const lo = inRow <= 3 ? 20 : inRow <= 5 ? 14 : 9;
    const edge = row === 0 ? 12 : 8;
    // Rows are offset by roughly half a place, so the back row stands in the
    // gaps of the one in front. Without this the crowd lines up into columns
    // and reads as a spreadsheet of people rather than a gathering.
    const step = inRow > 1 ? (100 - lo * 2) / (inRow - 1) : 0;
    const stagger = row % 2 ? step * .42 : 0;
    const x = Math.min(100 - edge, Math.max(edge, lo + t * (100 - lo * 2) + stagger + ((h % 5) - 2)));
    const bottom = bottoms[row];
    const scale = scales[row];
    const dead = !player.alive;
    const loverMark = Boolean(me?.loverId && me.alive && view.players[me.loverId]?.alive
      && (player.id === me.id || player.id === me.loverId));
    const pickable = selecting && player.alive && select.ids.has(player.id);
    const picked = selecting && (select.selected || []).includes(player.id);
    const forbidden = selecting && select.disabled?.has(player.id);
    const markCount = select?.marks?.[player.id] || 0;
    const isVictim = select?.victim === player.id;
    // Lovers wear their bound sprite (the chained pose) instead of a floating
    // heart; the Sheriff's real badge hangs above their head for everyone.
    const marks = player.sheriff || markCount || isVictim
      ? `<span class="marks">${player.sheriff ? '<img class="mark badge" src="assets/sprites/props/badge.png" alt="Sheriff">' : ''}${markCount ? `<span class="mark paw" role="img" aria-label="${markCount} of the pack">${'<i></i>'.repeat(Math.min(3, markCount))}</span>` : ''}${isVictim ? '<span class="mark doom" role="img" aria-label="Tonight’s victim"></span>' : ''}</span>`
      : '';
    const arriving = arrivals?.has(player.id) && player.alive;
    const isActor = acting && player.id === me?.id && player.alive;
    const classes = [
      'sprite',
      dead ? 'ghost' : '',
      dead && freshIds.has(player.id) ? 'fresh' : '',
      loverMark ? 'bound' : '',
      player.id === me?.id ? 'self' : '',
      pickable ? 'can-pick' : '',
      picked ? 'picked' : '',
      selecting && !pickable && !picked && player.alive ? 'off' : '',
      forbidden ? 'forbidden' : '',
      arriving ? 'arrive' : '',
      isActor ? 'acting' : ''
    ].filter(Boolean).join(' ');
    const anim = dead ? 'idle' : isActor ? 'act' : arriving ? 'walk' : loverMark ? 'bound' : 'idle';
    return `<button class="${classes}" data-sprite="${escText(player.id)}" data-id="${escText(player.id)}"
      style="left:${x.toFixed(1)}%;bottom:${bottom}%;--s:${scale};--depth:${rowCount > 1 ? (row / (rowCount - 1)).toFixed(2) : 0};--sway:${(3.4 + (h % 21) / 10).toFixed(1)}s;--sd:${((h >> 4) % 30) / 10}s;--fresh:${freshOrder.get(player.id) || 0};z-index:${10 - row}" ${forbidden ? 'disabled' : ''}>
      ${marks}
      ${picked ? '<i class="pick-ring" aria-hidden="true"></i>' : ''}
      ${(dead ? fallenSprite(knownRole(view, player), {seedText: seed + player.id}) : null)
        || sheetSprite(knownRole(view, player), {anim, loop: !dead && !isActor, seedText: seed + player.id, alive: !dead})}
      <span class="sprite-name">${escText(player.name)}</span>
    </button>`;
  }).join('');

  const squareClasses = ['square', cinematic ? 'cinematic' : '', selecting ? 'selecting named-all' : '', !selecting && (select || view.phase === 'lobby') ? 'named-all' : ''].filter(Boolean).join(' ');
  return `<div class="${squareClasses}" data-mood="${moodFor(view)}" style="--base:${base}">${sprites}</div>`;
}

// One-line scene-setting for the dawn reveal, keyed to what actually
// happened. Spoken text stays with the recorded narrator; this is read.
export function morningLine(view) {
  const deaths = view.lastDeaths || [];
  if (!deaths.length) {
    return view.nightResult?.healed
      ? 'Every door opened. Every face answered. Yet one chimney had smoked long after midnight…'
      : 'Frost on the lane, smoke over every roof — and not a single door left open.';
  }
  const wolfDeath = deaths.find(death => death.cause === 'the Werewolves');
  if (wolfDeath) return `When morning reached ${wolfDeath.name}’s cottage, the hearth was still warm. Nobody answered the door.`;
  return 'The village woke to a silence with a shape in it.';
}
