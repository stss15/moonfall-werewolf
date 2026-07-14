// The living village: a full-bleed silhouette diorama pinned to the foot of
// every screen. It deliberately draws NO sky — the game's painted night
// artwork shines through behind it, so the village reads as part of the same
// world rather than a boxed illustration. Everything it shows is real game
// state: a cottage per character whose window burns while they live and is
// boarded when they die, claw-marks where the pack broke a door, a cross in
// the churchyard per death, fog that thickens with the body count.
//
// Private perception: a faint red thread joins the lovers' houses on their
// own phones only, and the dead see wisps over the fallen. Nothing here can
// reveal a living player's role.

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

function pine(x, y, height, cls = 'vg-pine') {
  const w = height * .4;
  return `<g class="${cls}" transform="translate(${x},${y})">
    <polygon points="0,${-height} ${(-w * .58).toFixed(1)},${(-height * .5).toFixed(1)} ${(w * .58).toFixed(1)},${(-height * .5).toFixed(1)}"/>
    <polygon points="0,${(-height * .8).toFixed(1)} ${(-w * .8).toFixed(1)},${(-height * .24).toFixed(1)} ${(w * .8).toFixed(1)},${(-height * .24).toFixed(1)}"/>
    <polygon points="0,${(-height * .55).toFixed(1)} ${-w},0 ${w},0"/>
    <rect x="${(-height * .045).toFixed(1)}" y="0" width="${(height * .09).toFixed(1)}" height="${(height * .12).toFixed(1)}"/>
  </g>`;
}

// A silhouetted cottage. Bottom-centre origin; roughly 44 units wide at
// scale 1 so windows and marks stay readable on a phone.
function cottage(player, x, y, scale, seed, {fresh, clawed, ghostView}) {
  const h = hashOf(seed + player.id);
  const flip = h % 2 ? -1 : 1;
  const wide = h % 4 === 0;
  const w = wide ? 21 : 15 + (h % 5);
  const rise = 12 + ((h >> 7) % 5);
  const dead = !player.alive;
  const flicker = ((h >> 3) % 37) / 10;
  const classes = ['vg-house', dead ? 'dead' : 'alive', clawed ? 'clawed' : '', fresh ? 'fresh' : ''].filter(Boolean).join(' ');
  const winY = -13.6;
  const windowAt = (wx, delay) => `<circle class="vg-winhalo" cx="${(wx + 3.2).toFixed(1)}" cy="${winY + 3.4}" r="9"/>
    <rect class="vg-win" x="${wx.toFixed(1)}" y="${winY}" width="6.4" height="6.8" rx=".7" style="--fd:${delay}s"/>
    <path class="vg-mull" d="M${(wx + 3.2).toFixed(1)},${winY} v6.8 M${wx.toFixed(1)},${winY + 3.4} h6.4"/>`;
  const doorX = w - 10.4;
  return `<g class="${classes}" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(scale * flip).toFixed(3)},${scale.toFixed(3)})">
    ${fresh ? '<ellipse class="vg-omen" cx="0" cy="-10" rx="27" ry="21"/>' : ''}
    <rect class="vg-chimney" x="${(w * .38).toFixed(1)}" y="${(-18 - rise - .8).toFixed(1)}" width="4.6" height="9"/>
    ${dead ? '' : `<g class="vg-smoke" style="--sd:${flicker}s"><circle cx="${(w * .38 + 2.3).toFixed(1)}" cy="${(-18 - rise - 4).toFixed(1)}" r="1.9"/><circle cx="${(w * .38 + 1.4).toFixed(1)}" cy="${(-18 - rise - 9).toFixed(1)}" r="2.5"/><circle cx="${(w * .38 + 3.4).toFixed(1)}" cy="${(-18 - rise - 14.5).toFixed(1)}" r="3.1"/></g>`}
    <rect class="vg-body" x="${-w}" y="-18" width="${w * 2}" height="18"/>
    <polygon class="vg-roof" points="${(-w - 4).toFixed(1)},-18 0,${(-18 - rise).toFixed(1)} ${(w + 4).toFixed(1)},-18"/>
    <line class="vg-rim" x1="${(-w - 4).toFixed(1)}" y1="-18" x2="0" y2="${(-18 - rise).toFixed(1)}"/>
    ${windowAt(-w + 3.8, flicker)}
    ${wide ? windowAt(-2.6, flicker + .9) : ''}
    <path class="vg-door" d="M${doorX.toFixed(1)},0 v-8 a3.4,3.8 0 0 1 6.8,0 V0 Z"/>
    ${clawed ? `<path class="vg-claw" d="M${(doorX + .8).toFixed(1)},-9.4 l2,6.4 M${(doorX + 3.1).toFixed(1)},-10 l2,6.4 M${(doorX + 5.4).toFixed(1)},-9.2 l1.9,6.2"/>` : ''}
    ${dead ? `<g class="vg-boards"><line x1="${(-w + 2).toFixed(1)}" y1="-15.8" x2="${(w - 2).toFixed(1)}" y2="-2.6"/><line x1="${(w - 2).toFixed(1)}" y1="-15.8" x2="${(-w + 2).toFixed(1)}" y2="-2.6"/></g>` : ''}
    ${dead && ghostView ? `<circle class="vg-wisp" cx="0" cy="-24" r="2.6" style="--wd:${flicker}s"/>` : ''}
    <text class="vg-name" x="0" y="9.6" transform="scale(${flip},1)">${escText(initialsOf(player.name))}</text>
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
  const fog = Math.min(.7, .22 + deadCount * .1 + Math.max(0, (view.day || 0) - 1) * .03);
  const wear = Math.min(.45, deadCount * .08);

  // Cottage layout across a 390-wide stage: one lane for small villages, two
  // staggered rows for large ones. Church far left, mill far right.
  const positions = [];
  const twoRows = players.length > 7;
  const backCount = twoRows ? Math.floor(players.length / 2) : 0;
  const frontCount = players.length - backCount;
  for (let index = 0; index < backCount; index += 1) {
    const t = backCount === 1 ? .5 : index / (backCount - 1);
    positions.push({x: 96 + t * 206 + (hashOf(`${seed}bj${index}`) % 11) - 5, y: 154, s: .74});
  }
  for (let index = 0; index < frontCount; index += 1) {
    const t = frontCount === 1 ? .5 : index / (frontCount - 1);
    positions.push({x: 84 + t * 224 + (hashOf(`${seed}fj${index}`) % 11) - 5, y: 185, s: twoRows ? 1.06 : 1.3});
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
    const dip = Math.min(a.y, b.y) - 42 - Math.abs(a.x - b.x) * .05;
    thread = `<path class="vg-thread" d="M${a.x.toFixed(1)},${(a.y - 24).toFixed(1)} Q${midX.toFixed(1)},${dip.toFixed(1)} ${b.x.toFixed(1)},${(b.y - 24).toFixed(1)}"/>`;
  }

  const graves = players.filter(player => !player.alive).slice(0, 12).map((player, index) => {
    const gx = 58 + (index % 6) * 9;
    const gy = 178 + Math.floor(index / 6) * 8;
    return `<g class="vg-grave" transform="translate(${gx},${gy})"><line x1="0" y1="-6.4" x2="0" y2="1.8"/><line x1="-2.6" y1="-4" x2="2.6" y2="-4"/></g>`;
  }).join('');

  const embers = mood === 'ember'
    ? Array.from({length: 10}, (_, index) => {
      const h = hashOf(`${seed}-ember-${index}`);
      return `<circle class="vg-ember" cx="${24 + (h % 344)}" cy="${172 - (h >> 4) % 44}" r="${(.8 + (h % 3) * .4).toFixed(1)}" style="--ed:${(h % 46) / 10}s"/>`;
    }).join('')
    : '';

  const uid = `vg${hashOf(seed + mood) % 9973}`;
  return `<figure class="village-stage" data-mood="${mood}" ${ghostView ? 'data-ghost="1"' : ''} aria-label="The village of ${escText(seed)}">
  <svg viewBox="0 0 390 200" preserveAspectRatio="xMidYMax meet" style="--wear:${wear}">
    <defs>
      <linearGradient id="${uid}-haze" x1="0" y1="0" x2="0" y2="1">
        <stop class="vg-h0" offset="0" stop-opacity="0"/><stop class="vg-h1" offset="1"/>
      </linearGradient>
      <filter id="${uid}-blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>
    </defs>
    <rect class="vg-hazerect" y="86" width="390" height="114" fill="url(#${uid}-haze)"/>
    <path class="vg-hill far" d="M0,142 Q70,120 150,136 T292,128 T390,138 V200 H0 Z"/>
    ${pine(16, 146, 26, 'vg-treeline')}${pine(38, 149, 20, 'vg-treeline')}${pine(300, 143, 22, 'vg-treeline')}${pine(326, 146, 27, 'vg-treeline')}${pine(374, 148, 21, 'vg-treeline')}
    <path class="vg-hill near" d="M0,162 Q100,146 200,158 T390,152 V200 H0 Z"/>
    <g class="vg-church" transform="translate(32,176) scale(1.24)">
      <rect class="vg-cbody" x="-3" y="-19" width="26" height="19"/>
      <polygon class="vg-cbody" points="-5.4,-19 10,-28.5 25.4,-19"/>
      <rect class="vg-cbody" x="-13" y="-38" width="12.4" height="38"/>
      <polygon class="vg-cbody" points="-14.8,-38 -6.8,-52 1.2,-38"/>
      <line class="vg-cross" x1="-6.8" y1="-58.5" x2="-6.8" y2="-51.4"/><line class="vg-cross" x1="-9.4" y1="-56.4" x2="-4.2" y2="-56.4"/>
      <circle class="vg-winhalo" cx="-6.8" cy="-27" r="7"/>
      <path class="vg-cwin" d="M-9.4,-24 v-4.6 a2.7,3 0 0 1 5.2,0 v4.6 Z"/>
      <path class="vg-cdoor" d="M6.4,0 v-7.2 a3.6,4 0 0 1 7.2,0 V0 Z"/>
    </g>
    ${graves}
    <g class="vg-mill" transform="translate(354,174) scale(1.18)">
      <polygon class="vg-cbody" points="-10.4,0 -6.6,-33 6.6,-33 10.4,0"/>
      <polygon class="vg-cbody" points="-8,-33 0,-39.5 8,-33"/>
      <path class="vg-cdoor" d="M-2.8,0 v-6 a2.8,3.2 0 0 1 5.6,0 V0 Z"/>
      <g class="vg-sailhub" transform="translate(0,-36)"><g class="vg-sails"><line x1="0" y1="-20" x2="0" y2="20"/><line x1="-20" y1="0" x2="20" y2="0"/><line x1="-14.1" y1="-14.1" x2="14.1" y2="14.1"/><line x1="-14.1" y1="14.1" x2="14.1" y2="-14.1"/></g><circle class="vg-hub" r="2.2"/></g>
    </g>
    <rect class="vg-ground" y="183" width="390" height="17"/>
    <path class="vg-lane" d="M156,200 C174,190 186,181 190,170 C194,181 206,191 240,200 Z"/>
    <g class="vg-well" transform="translate(226,188) scale(1.18)">
      <rect class="vg-cbody" x="-6.6" y="-6" width="13.2" height="6.6" rx="1.2"/>
      <line class="vg-wellpost" x1="-5.6" y1="-6" x2="-5.6" y2="-13"/><line class="vg-wellpost" x1="5.6" y1="-6" x2="5.6" y2="-13"/>
      <polygon class="vg-cbody" points="-8.8,-12.4 0,-17.4 8.8,-12.4"/>
      <line class="vg-wellpost" x1="0" y1="-12.4" x2="0" y2="-7.6"/>
    </g>
    ${houses}
    ${pine(7, 200, 64, 'vg-pine deep')}${pine(30, 200, 44, 'vg-pine')}${pine(383, 200, 68, 'vg-pine deep')}${pine(360, 199, 42, 'vg-pine')}
    ${thread}
    ${embers}
    <g class="vg-fog" style="opacity:${fog.toFixed(2)}" filter="url(#${uid}-blur)">
      <ellipse class="f1" cx="92" cy="182" rx="104" ry="14"/>
      <ellipse class="f2" cx="266" cy="188" rx="122" ry="15"/>
      <ellipse class="f3" cx="186" cy="170" rx="84" ry="10"/>
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
