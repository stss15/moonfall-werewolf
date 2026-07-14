// The town square: every character stands in the middle of the screen as a
// painted sprite. What each phone shows follows the game's knowledge rules —
//
//   · your own sprite wears your true role
//   · werewolves see their packmates as wolves
//   · the Seer sees the true form of everyone her visions have touched
//   · the dead become ghosts, staying where they stood, their true identity
//     revealed to all once the village has seen their card
//   · lovers see a heart above both bound souls (their phones only)
//   · the Sheriff's badge shines above their head for everyone
//   · everyone else simply looks like a villager
//
// Tap a character to reveal their name. Nothing in the crowd can leak a
// living player's secret to anyone who shouldn't know it.

const escText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[char]));

function hashOf(text) {
  let hash = 5381;
  const source = String(text || 'moonfall');
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

// Roles without a sprite of their own stand as ordinary villagers.
const SPRITE_FOR = {
  villager: 'villager', werewolf: 'werewolf', seer: 'seer', witch: 'witch',
  cupid: 'cupid', 'little-girl': 'little-girl', thief: 'thief',
  hunter: 'villager', sheriff: 'sheriff', storyteller: 'villager'
};

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
  if (phase === 'sheriff-vote' || phase.startsWith('day-')) return 'day';
  if (phase === 'dawn') return 'dawn';
  return 'night';
}

export function townSquare(view) {
  const players = Object.values(view.players || {}).filter(player => !player.storyteller);
  if (!players.length) return '';
  const me = view.me;
  const seed = view.roomCode || 'MOONFALL';
  const freshIds = new Set((view.lastDeaths || []).map(death => death.id));

  // The crowd stands in staggered rows — nearer rows larger, every position
  // stable for the whole game so ghosts remain where they fell.
  const count = players.length;
  const rows = count <= 4 ? 1 : count <= 9 ? 2 : 3;
  const perRow = Math.ceil(count / rows);
  const sprites = players.map((player, index) => {
    const row = Math.floor(index / perRow);            // 0 = front
    const col = index % perRow;
    const inRow = row === rows - 1 ? count - perRow * (rows - 1) : perRow;
    const h = hashOf(seed + player.id);
    const t = inRow === 1 ? .5 : col / (inRow - 1);
    const x = Math.min(86, Math.max(14, 17 + t * 66 + ((h % 7) - 3) + (row % 2 ? 4 : -4)));
    const bottom = row === 0 ? 0 : row === 1 ? 27 : 51;
    const scale = row === 0 ? 1 : row === 1 ? .8 : .64;
    const dead = !player.alive;
    const loverMark = Boolean(me?.loverId && me.alive && view.players[me.loverId]?.alive
      && (player.id === me.id || player.id === me.loverId));
    const marks = player.sheriff || loverMark
      ? `<span class="marks">${player.sheriff ? '<span class="mark badge" aria-label="Sheriff">✶</span>' : ''}${loverMark ? '<span class="mark heart" aria-hidden="true">♥</span>' : ''}</span>`
      : '';
    const classes = [
      'sprite',
      dead ? 'ghost' : '',
      dead && freshIds.has(player.id) ? 'fresh' : '',
      loverMark ? 'bound' : '',
      player.id === me?.id ? 'self' : ''
    ].filter(Boolean).join(' ');
    return `<button class="${classes}" data-sprite="${escText(player.id)}"
      style="left:${x.toFixed(1)}%;bottom:${bottom}%;--s:${scale};--sway:${(3.4 + (h % 21) / 10).toFixed(1)}s;--sd:${((h >> 4) % 30) / 10}s;z-index:${10 - row}">
      ${marks}
      <img src="assets/sprites/${spriteFile(view, player)}.webp" alt="" draggable="false">
      <span class="sprite-name">${escText(player.name)}</span>
    </button>`;
  }).join('');

  return `<div class="square" data-mood="${moodFor(view)}">${sprites}</div>`;
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
