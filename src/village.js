// The living village: a procedurally drawn scene that acts as the shared
// game board. Every character owns a cottage. Windows glow while they live,
// go dark and are boarded when they die, claw-marks stain a door the pack
// broke, and a cross joins the churchyard for every soul the tale claims.
// Fog thickens and the sky turns as the village deteriorates — the scenery
// is driven entirely by real game state, never by a canned animation.
//
// Private perception: the viewer's own phone may layer secrets onto the same
// world — a faint red thread binds the lovers' houses, and the dead see the
// village through a ghost's veil. Nothing here reveals a living role.

const escText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[char]));

function hashOf(text) {
  let hash = 5381;
  const source = String(text || 'moonfall');
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

const initialsOf = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();

function moodFor(view) {
  const phase = view.phase;
  if (phase === 'lobby') return 'dusk';
  if (phase === 'game-over') {
    if (view.winner?.team === 'wolves') return 'ember';
    if (view.winner?.team === 'village' || view.winner?.team === 'lovers') return 'day';
    return 'dusk';
  }
  if (phase === 'dawn') return 'dawn';
  if (phase === 'sheriff-vote' || phase.startsWith('day-')) return 'day';
  return 'night';
}

function starField(seed) {
  let out = '';
  for (let index = 0; index < 16; index += 1) {
    const h = hashOf(`${seed}-star-${index}`);
    const x = 8 + (h % 344);
    const y = 6 + ((h >> 5) % 56);
    const r = .5 + ((h >> 9) % 3) * .22;
    out += `<circle cx="${x}" cy="${y}" r="${r.toFixed(2)}" style="--tw:${(h % 40) / 10}s"/>`;
  }
  return `<g class="vg-stars">${out}</g>`;
}

function cottage(player, x, y, scale, seed, {fresh, clawed, ghostView}) {
  const h = hashOf(seed + player.id);
  const flip = h % 2 ? -1 : 1;
  const roofVariant = h % 3;
  const dead = !player.alive;
  const classes = ['vg-house', dead ? 'dead' : 'alive', clawed ? 'clawed' : '', fresh ? 'fresh' : ''].filter(Boolean).join(' ');
  const flicker = ((h >> 3) % 37) / 10;
  return `<g class="${classes}" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(scale * flip).toFixed(3)},${scale.toFixed(3)})">
    ${fresh ? '<ellipse class="vg-omen" cx="0" cy="-6" rx="17" ry="13"/>' : ''}
    <rect class="vg-chimney" x="4.2" y="-19" width="3" height="7.4"/>
    ${dead ? '' : `<g class="vg-smoke" style="--sd:${flicker}s"><circle cx="5.7" cy="-21" r="1.3"/><circle cx="5.2" cy="-25" r="1.7"/><circle cx="6.4" cy="-29" r="2.1"/></g>`}
    <rect class="vg-body" x="-10" y="-12.5" width="20" height="12.5"/>
    <polygon class="vg-roof v${roofVariant}" points="-12.4,-12.5 0,-21 12.4,-12.5"/>
    <rect class="vg-win" x="-6.4" y="-9.4" width="4.4" height="4.8" style="--fd:${flicker}s"/>
    <rect class="vg-door" x="2" y="-7.4" width="4.6" height="7.4"/>
    ${clawed ? '<path class="vg-claw" d="M1.4,-6.6 l1.5,4.6 M3.2,-7 l1.5,4.6 M5,-6.4 l1.4,4.4"/>' : ''}
    ${dead ? '<g class="vg-boards"><line x1="-8.6" y1="-11" x2="8.6" y2="-1.6"/><line x1="8.6" y1="-11" x2="-8.6" y2="-1.6"/></g>' : ''}
    ${dead && ghostView ? `<circle class="vg-wisp" cx="0" cy="-16" r="1.9" style="--wd:${flicker}s"/>` : ''}
    <text class="vg-name" x="0" y="5.6" transform="scale(${flip},1)">${escText(initialsOf(player.name))}</text>
  </g>`;
}

export function villageScene(view, {caption = null} = {}) {
  const players = Object.values(view.players || {}).filter(player => !player.storyteller);
  if (!players.length) return '';
  const chronicle = view.chronicle || [];
  const causeById = {};
  for (const event of chronicle) causeById[event.id] = event.cause;
  const freshIds = new Set((view.lastDeaths || []).map(death => death.id));
  const deadCount = players.filter(player => !player.alive).length;
  const mood = moodFor(view);
  const ghostView = Boolean(view.me && view.me.alive === false && view.phase !== 'game-over');
  const seed = view.roomCode || 'MOONFALL';
  const fog = Math.min(.68, .16 + deadCount * .11 + Math.max(0, (view.day || 0) - 1) * .03);
  const wear = Math.min(.5, deadCount * .09);

  // Cottage layout: a single lane for small villages, two staggered rows for
  // larger ones, always leaving room for the church (left) and mill (right).
  const positions = [];
  const twoRows = players.length > 8;
  const backCount = twoRows ? Math.floor(players.length / 2) : 0;
  const frontCount = players.length - backCount;
  for (let index = 0; index < backCount; index += 1) {
    const t = backCount === 1 ? .5 : index / (backCount - 1);
    positions.push({x: 78 + t * 210 + (hashOf(`${seed}bj${index}`) % 9) - 4, y: 103.5, s: .74});
  }
  for (let index = 0; index < frontCount; index += 1) {
    const t = frontCount === 1 ? .5 : index / (frontCount - 1);
    positions.push({x: 62 + t * 244 + (hashOf(`${seed}fj${index}`) % 9) - 4, y: 121, s: twoRows ? .95 : 1});
  }

  const houseById = {};
  const houses = players.map((player, index) => {
    const pos = positions[index];
    houseById[player.id] = pos;
    return cottage(player, pos.x, pos.y, pos.s, seed, {
      fresh: freshIds.has(player.id) && (view.phase === 'dawn' || view.phase === 'day-result'),
      clawed: causeById[player.id] === 'the Werewolves',
      ghostView
    });
  }).join('');

  // The lovers' thread: drawn only on a lover's own phone, faint enough to
  // pass for scenery, meaningful only to the two who know what it ties.
  let thread = '';
  const loverId = view.me?.loverId;
  if (loverId && view.me?.alive && houseById[view.me.id] && houseById[loverId] && view.players[loverId]?.alive) {
    const a = houseById[view.me.id];
    const b = houseById[loverId];
    const midX = (a.x + b.x) / 2;
    const dip = Math.min(a.y, b.y) - 26 - Math.abs(a.x - b.x) * .05;
    thread = `<path class="vg-thread" d="M${a.x.toFixed(1)},${(a.y - 14).toFixed(1)} Q${midX.toFixed(1)},${dip.toFixed(1)} ${b.x.toFixed(1)},${(b.y - 14).toFixed(1)}"/>`;
  }

  const graves = players.filter(player => !player.alive).slice(0, 12).map((player, index) => {
    const gx = 24 + (index % 6) * 6.4;
    const gy = 116 + Math.floor(index / 6) * 6;
    return `<g class="vg-grave" transform="translate(${gx},${gy})"><line x1="0" y1="-4.6" x2="0" y2="1.6"/><line x1="-2" y1="-2.8" x2="2" y2="-2.8"/></g>`;
  }).join('');

  const embers = mood === 'ember'
    ? Array.from({length: 9}, (_, index) => {
      const h = hashOf(`${seed}-ember-${index}`);
      return `<circle class="vg-ember" cx="${20 + (h % 320)}" cy="${118 - (h >> 4) % 30}" r="${(.7 + (h % 3) * .3).toFixed(1)}" style="--ed:${(h % 46) / 10}s"/>`;
    }).join('')
    : '';

  // Gradient ids must be unique per rendered instance: url(#…) resolves
  // document-wide, so two scenes on one page would share the first defs.
  const uid = `vg${hashOf(seed + mood) % 9973}`;
  return `<figure class="village-stage" data-mood="${mood}" ${ghostView ? 'data-ghost="1"' : ''} aria-label="The village of ${escText(seed)}">
  <svg viewBox="0 0 360 150" preserveAspectRatio="xMidYMid slice" style="--wear:${wear}">
    <defs>
      <linearGradient id="${uid}-sky" x1="0" y1="0" x2="0" y2="1">
        <stop class="vg-s0" offset="0"/><stop class="vg-s1" offset="1"/>
      </linearGradient>
      <linearGradient id="${uid}-ground" x1="0" y1="0" x2="0" y2="1">
        <stop class="vg-g0" offset="0"/><stop class="vg-g1" offset="1"/>
      </linearGradient>
      <filter id="${uid}-blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5"/></filter>
      <radialGradient id="${uid}-halo"><stop offset="0" stop-color="#fff6d8" stop-opacity=".85"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></radialGradient>
    </defs>
    <rect class="vg-skyrect" width="360" height="150" fill="url(#${uid}-sky)"/>
    ${starField(seed)}
    <g class="vg-moon"><circle cx="292" cy="30" r="15"/><circle class="vg-crater" cx="287" cy="26" r="3"/><circle class="vg-crater" cx="297" cy="34" r="2.2"/></g>
    <circle class="vg-sun" cx="286" cy="34" r="13"/>
    <circle class="vg-glow" cx="290" cy="32" r="34" fill="url(#${uid}-halo)"/>
    <path class="vg-hill far" d="M0,96 Q60,74 132,90 T260,84 T360,92 V150 H0 Z"/>
    <path class="vg-hill near" d="M0,108 Q90,92 190,104 T360,100 V150 H0 Z"/>
    <g class="vg-church" transform="translate(30,112)">
      <rect x="-8" y="-16" width="16" height="16"/>
      <polygon points="-10,-16 0,-24 10,-16"/>
      <rect x="-2.4" y="-32" width="4.8" height="10"/>
      <polygon points="-3.6,-32 0,-38 3.6,-32"/>
      <line class="vg-cross" x1="0" y1="-42" x2="0" y2="-37.4"/><line class="vg-cross" x1="-1.7" y1="-40.4" x2="1.7" y2="-40.4"/>
      <rect class="vg-cwin" x="-1.7" y="-12" width="3.4" height="5.4"/>
    </g>
    ${graves}
    <g class="vg-mill" transform="translate(336,110)">
      <polygon points="-7,0 -4.6,-22 4.6,-22 7,0"/>
      <g class="vg-sails"><line x1="0" y1="-22" x2="0" y2="-38"/><line x1="0" y1="-22" x2="14" y2="-14"/><line x1="0" y1="-22" x2="-14" y2="-14"/><line x1="0" y1="-22" x2="0" y2="-6"/></g>
    </g>
    <g class="vg-tree" transform="translate(178,116)"><line x1="0" y1="0" x2="0" y2="-13"/><line x1="0" y1="-8" x2="-5" y2="-14"/><line x1="0" y1="-10" x2="4.6" y2="-16"/></g>
    <rect class="vg-groundrect" y="112" width="360" height="38" fill="url(#${uid}-ground)"/>
    <path class="vg-lane" d="M150,150 Q176,128 180,118 Q186,128 216,150 Z"/>
    <g class="vg-well" transform="translate(206,124)"><rect x="-4.6" y="-4" width="9.2" height="4.6"/><polygon points="-6,-7 0,-11 6,-7"/><line x1="-5" y1="-7" x2="-5" y2="-4"/><line x1="5" y1="-7" x2="5" y2="-4"/></g>
    ${houses}
    ${thread}
    ${embers}
    <g class="vg-fog" style="opacity:${fog.toFixed(2)}" filter="url(#${uid}-blur)">
      <ellipse class="f1" cx="86" cy="126" rx="86" ry="12"/>
      <ellipse class="f2" cx="240" cy="132" rx="104" ry="13"/>
      <ellipse class="f3" cx="170" cy="118" rx="70" ry="9"/>
    </g>
  </svg>
  ${caption ? `<figcaption>${escText(caption)}</figcaption>` : ''}
</figure>`;
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
