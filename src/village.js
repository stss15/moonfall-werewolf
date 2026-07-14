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
  for (let index = 0; index < 18; index += 1) {
    const h = hashOf(`${seed}-star-${index}`);
    const x = 8 + (h % 344);
    const y = 5 + ((h >> 5) % 52);
    const r = .5 + ((h >> 9) % 3) * .22;
    out += `<circle cx="${x}" cy="${y}" r="${r.toFixed(2)}" style="--tw:${(h % 40) / 10}s"/>`;
  }
  return `<g class="vg-stars">${out}</g>`;
}

function clouds(seed) {
  const puff = (x, y, s, cls) => `<g class="vg-cloud ${cls}" transform="translate(${x},${y}) scale(${s})">
    <ellipse cx="0" cy="0" rx="17" ry="5"/><ellipse cx="-9" cy="-2.6" rx="9" ry="4.2"/><ellipse cx="8" cy="-2.2" rx="10" ry="4.4"/>
  </g>`;
  const h = hashOf(`${seed}-cloud`);
  return puff(60 + (h % 40), 26, .9, 'c1') + puff(200 + (h % 30), 14, .7, 'c2') + puff(300 - (h % 24), 38, .55, 'c3');
}

function pine(x, y, height, cls = 'vg-pine') {
  const w = height * .42;
  return `<g class="${cls}" transform="translate(${x},${y})">
    <polygon points="0,${-height} ${-w * .62},${-height * .48} ${w * .62},${-height * .48}"/>
    <polygon points="0,${-height * .78} ${-w * .82},${-height * .22} ${w * .82},${-height * .22}"/>
    <polygon points="0,${-height * .52} ${-w},0 ${w},0"/>
    <rect x="${-height * .05}" y="0" width="${height * .1}" height="${height * .14}"/>
  </g>`;
}

function treeline(seed) {
  let out = '';
  for (let index = 0; index < 9; index += 1) {
    const h = hashOf(`${seed}-tl-${index}`);
    const left = index < 5;
    const x = left ? 6 + index * 15 + (h % 7) : 258 + (index - 5) * 24 + (h % 9);
    const y = left ? 101 + (h % 4) : 99 + (h % 4);
    out += pine(x, y, 8 + (h % 5), 'vg-treeline');
  }
  return out;
}

function cottage(player, x, y, scale, seed, {fresh, clawed, ghostView}) {
  const h = hashOf(seed + player.id);
  const flip = h % 2 ? -1 : 1;
  const roofVariant = h % 3;
  const wide = h % 4 === 0;
  const w = wide ? 13.5 : 10 + (h % 3);
  const rise = 8.4 + ((h >> 7) % 3);
  const dead = !player.alive;
  const flicker = ((h >> 3) % 37) / 10;
  const classes = ['vg-house', dead ? 'dead' : 'alive', clawed ? 'clawed' : '', fresh ? 'fresh' : ''].filter(Boolean).join(' ');
  const winX = -w + 2.6;
  const winY = -9.8;
  const window_ = (wx, delay) => `<circle class="vg-winhalo" cx="${(wx + 2.2).toFixed(1)}" cy="${winY + 2.4}" r="4.8"/>
    <rect class="vg-win" x="${wx.toFixed(1)}" y="${winY}" width="4.4" height="4.8" rx=".5" style="--fd:${delay}s"/>
    <path class="vg-mull" d="M${(wx + 2.2).toFixed(1)},${winY} v4.8 M${wx.toFixed(1)},${winY + 2.4} h4.4"/>`;
  const doorX = w - 7.2;
  return `<g class="${classes}" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(scale * flip).toFixed(3)},${scale.toFixed(3)})">
    ${fresh ? '<ellipse class="vg-omen" cx="0" cy="-7" rx="19" ry="15"/>' : ''}
    <ellipse class="vg-shadow" cx="0" cy=".8" rx="${(w + 4.4).toFixed(1)}" ry="2.1"/>
    <rect class="vg-chimney" x="${(w * .42).toFixed(1)}" y="${(-13 - rise - .6).toFixed(1)}" width="3.2" height="7.2"/>
    <rect class="vg-chimcap" x="${(w * .42 - .7).toFixed(1)}" y="${(-13 - rise - 1.9).toFixed(1)}" width="4.6" height="1.6"/>
    ${dead ? '' : `<g class="vg-smoke" style="--sd:${flicker}s"><circle cx="${(w * .42 + 1.6).toFixed(1)}" cy="${(-13 - rise - 3.4).toFixed(1)}" r="1.3"/><circle cx="${(w * .42 + 1).toFixed(1)}" cy="${(-13 - rise - 7).toFixed(1)}" r="1.7"/><circle cx="${(w * .42 + 2.4).toFixed(1)}" cy="${(-13 - rise - 10.6).toFixed(1)}" r="2.1"/></g>`}
    <rect class="vg-body" x="${-w}" y="-13" width="${w * 2}" height="13"/>
    <rect class="vg-plinth" x="${(-w - .7).toFixed(1)}" y="-2.7" width="${(w * 2 + 1.4).toFixed(1)}" height="2.7"/>
    <polygon class="vg-roof v${roofVariant}" points="${(-w - 2.8).toFixed(1)},-13 0,${(-13 - rise).toFixed(1)} ${(w + 2.8).toFixed(1)},-13"/>
    <line class="vg-eave" x1="${(-w - 2.8).toFixed(1)}" y1="-13" x2="${(w + 2.8).toFixed(1)}" y2="-13"/>
    ${window_(winX, flicker)}
    ${wide ? window_(-1.4, flicker + .8) : ''}
    <path class="vg-door" d="M${doorX.toFixed(1)},0 v-5.6 a2.4,2.7 0 0 1 4.8,0 V0 Z"/>
    <circle class="vg-knob" cx="${(doorX + 3.8).toFixed(1)}" cy="-2.6" r=".4"/>
    <circle class="vg-bush" cx="${(-w - 2.6).toFixed(1)}" cy="-1.9" r="2.4"/>
    <circle class="vg-bush" cx="${(-w - 4.5).toFixed(1)}" cy="-1.2" r="1.7"/>
    ${clawed ? `<path class="vg-claw" d="M${(doorX + .6).toFixed(1)},-6.4 l1.4,4.4 M${(doorX + 2.2).toFixed(1)},-6.8 l1.4,4.4 M${(doorX + 3.8).toFixed(1)},-6.2 l1.3,4.2"/>` : ''}
    ${dead ? `<g class="vg-boards"><line x1="${(-w + 1.4).toFixed(1)}" y1="-11.4" x2="${(w - 1.4).toFixed(1)}" y2="-1.8"/><line x1="${(w - 1.4).toFixed(1)}" y1="-11.4" x2="${(-w + 1.4).toFixed(1)}" y2="-1.8"/></g>` : ''}
    ${dead && ghostView ? `<circle class="vg-wisp" cx="0" cy="-17" r="1.9" style="--wd:${flicker}s"/>` : ''}
    <text class="vg-name" x="0" y="6.4" transform="scale(${flip},1)">${escText(initialsOf(player.name))}</text>
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
  const fog = Math.min(.62, .14 + deadCount * .1 + Math.max(0, (view.day || 0) - 1) * .03);
  const wear = Math.min(.5, deadCount * .09);

  // Cottage layout: a single lane for small villages, two staggered rows for
  // larger ones, always leaving room for the church (left) and mill (right).
  const positions = [];
  const twoRows = players.length > 8;
  const backCount = twoRows ? Math.floor(players.length / 2) : 0;
  const frontCount = players.length - backCount;
  for (let index = 0; index < backCount; index += 1) {
    const t = backCount === 1 ? .5 : index / (backCount - 1);
    positions.push({x: 80 + t * 206 + (hashOf(`${seed}bj${index}`) % 9) - 4, y: 102.5, s: .68});
  }
  for (let index = 0; index < frontCount; index += 1) {
    const t = frontCount === 1 ? .5 : index / (frontCount - 1);
    positions.push({x: 66 + t * 234 + (hashOf(`${seed}fj${index}`) % 9) - 4, y: 122, s: twoRows ? .98 : 1.12});
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
    const dip = Math.min(a.y, b.y) - 28 - Math.abs(a.x - b.x) * .05;
    thread = `<path class="vg-thread" d="M${a.x.toFixed(1)},${(a.y - 16).toFixed(1)} Q${midX.toFixed(1)},${dip.toFixed(1)} ${b.x.toFixed(1)},${(b.y - 16).toFixed(1)}"/>`;
  }

  const graves = players.filter(player => !player.alive).slice(0, 12).map((player, index) => {
    const gx = 40 + (index % 6) * 6.2;
    const gy = 117.5 + Math.floor(index / 6) * 5.6;
    return `<g class="vg-grave" transform="translate(${gx},${gy})"><line x1="0" y1="-4.8" x2="0" y2="1.4"/><line x1="-2" y1="-3" x2="2" y2="-3"/></g>`;
  }).join('');

  const embers = mood === 'ember'
    ? Array.from({length: 9}, (_, index) => {
      const h = hashOf(`${seed}-ember-${index}`);
      return `<circle class="vg-ember" cx="${20 + (h % 320)}" cy="${118 - (h >> 4) % 30}" r="${(.7 + (h % 3) * .3).toFixed(1)}" style="--ed:${(h % 46) / 10}s"/>`;
    }).join('')
    : '';

  const stones = Array.from({length: 7}, (_, index) => {
    const h = hashOf(`${seed}-st-${index}`);
    const t = index / 6;
    return `<ellipse class="vg-stone" cx="${(180 + (t - .5) * 10 + (h % 5) - 2 + t * t * ((h % 2) ? 30 : -26)).toFixed(1)}" cy="${(121 + t * 27).toFixed(1)}" rx="${(1.2 + t * 1.6).toFixed(1)}" ry="${(.5 + t * .7).toFixed(1)}"/>`;
  }).join('');

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
    <g class="vg-moon"><circle cx="292" cy="30" r="15"/><circle class="vg-crater" cx="287" cy="26" r="3"/><circle class="vg-crater" cx="297" cy="34" r="2.2"/><circle class="vg-crater" cx="290" cy="36" r="1.4"/></g>
    <circle class="vg-sun" cx="286" cy="34" r="13"/>
    <circle class="vg-glow" cx="290" cy="32" r="36" fill="url(#${uid}-halo)"/>
    ${clouds(seed)}
    <g class="vg-birds"><path d="M118,44 q3,-3.2 6,0 q3,-3.2 6,0"/><path d="M142,36 q2.4,-2.6 4.8,0 q2.4,-2.6 4.8,0"/></g>
    <path class="vg-hill far" d="M0,96 Q60,74 132,90 T260,84 T360,92 V150 H0 Z"/>
    ${treeline(seed)}
    <path class="vg-hill near" d="M0,108 Q90,92 190,104 T360,100 V150 H0 Z"/>
    <g class="vg-church" transform="translate(26,113)">
      <ellipse class="vg-shadow" cx="4" cy=".8" rx="16" ry="2.2"/>
      <rect class="vg-nave" x="-2" y="-13" width="18" height="13"/>
      <polygon class="vg-naveroof" points="-3.6,-13 7,-19.5 17.6,-13"/>
      <rect class="vg-tower" x="-9" y="-26" width="8.6" height="26"/>
      <polygon class="vg-spire" points="-10.2,-26 -4.7,-36 .8,-26"/>
      <line class="vg-cross" x1="-4.7" y1="-40.5" x2="-4.7" y2="-35.6"/><line class="vg-cross" x1="-6.5" y1="-39" x2="-2.9" y2="-39"/>
      <path class="vg-cwin" d="M-6.6,-17.5 v-3.2 a1.9,2.1 0 0 1 3.8,0 v3.2 Z"/>
      <path class="vg-cdoor" d="M4.4,0 v-5 a2.5,2.8 0 0 1 5,0 V0 Z"/>
      <circle class="vg-cwin round" cx="7" cy="-9.6" r="1.7"/>
    </g>
    ${graves}
    <g class="vg-mill" transform="translate(336,111)">
      <ellipse class="vg-shadow" cx="0" cy=".8" rx="10" ry="1.9"/>
      <polygon class="vg-milltower" points="-7.2,0 -4.6,-23 4.6,-23 7.2,0"/>
      <polygon class="vg-millcap" points="-5.6,-23 0,-27.5 5.6,-23"/>
      <rect class="vg-milldoor" x="-2" y="-6" width="4" height="6" rx="1.4"/>
      <g class="vg-sailhub" transform="translate(0,-25)"><g class="vg-sails"><line x1="0" y1="-14" x2="0" y2="14"/><line x1="-14" y1="0" x2="14" y2="0"/><line x1="-9.9" y1="-9.9" x2="9.9" y2="9.9"/><line x1="-9.9" y1="9.9" x2="9.9" y2="-9.9"/></g><circle class="vg-hub" r="1.6"/></g>
    </g>
    ${pine(10, 149, 40, 'vg-pine deep')}${pine(24, 148, 28, 'vg-pine')}${pine(350, 149, 42, 'vg-pine deep')}${pine(337, 147, 26, 'vg-pine')}
    <rect class="vg-groundrect" y="112" width="360" height="38" fill="url(#${uid}-ground)"/>
    <path class="vg-lane" d="M156,150 C168,138 176,128 180,117 C184,128 194,139 226,150 Z"/>
    ${stones}
    <g class="vg-well" transform="translate(206,125)">
      <ellipse class="vg-shadow" cx="0" cy="1" rx="7" ry="1.4"/>
      <rect class="vg-wellbase" x="-4.8" y="-4.2" width="9.6" height="4.8" rx="1"/>
      <line class="vg-wellpost" x1="-4.2" y1="-4.2" x2="-4.2" y2="-9.4"/><line class="vg-wellpost" x1="4.2" y1="-4.2" x2="4.2" y2="-9.4"/>
      <polygon class="vg-wellroof" points="-6.4,-9 0,-12.6 6.4,-9"/>
      <line class="vg-wellrope" x1="0" y1="-9" x2="0" y2="-5.4"/>
    </g>
    ${houses}
    ${thread}
    ${embers}
    <g class="vg-fog" style="opacity:${fog.toFixed(2)}" filter="url(#${uid}-blur)">
      <ellipse class="f1" cx="86" cy="127" rx="86" ry="11"/>
      <ellipse class="f2" cx="240" cy="133" rx="104" ry="12"/>
      <ellipse class="f3" cx="170" cy="119" rx="70" ry="8"/>
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
