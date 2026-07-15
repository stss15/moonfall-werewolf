import {ROLES} from './roles.js';
import {sheetSprite} from './village.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[char]));

export function deathCauseKind(cause = '') {
  if (cause === 'the Werewolves' || cause === 'caught peeking') return 'wolf';
  if (cause === 'the Witch’s poison') return 'poison';
  if (cause === 'a broken heart') return 'heart';
  if (cause.includes('final shot')) return 'shot';
  if (cause === 'the village vote') return 'vote';
  return 'fate';
}

// Three tapered claw slashes, curved like a real swipe: each blade is a
// sliver that is widest mid-stroke and vanishes to a point at both ends.
function clawSwipe() {
  return `<svg class="cinema-claws" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="cin-claw" x1="0" y1="0" x2=".7" y2="1">
      <stop offset="0" stop-color="#ff8a70"/><stop offset=".45" stop-color="#c3202d"/><stop offset="1" stop-color="#4a0510"/>
    </linearGradient></defs>
    <g>
      <path class="cl c1" d="M17,28 C31,46 45,62 61,78 C45,64 30,48 13,31 Z" fill="url(#cin-claw)"/>
      <path class="cl c2" d="M31,18 C48,40 63,58 79,76 C62,60 46,40 26,21 Z" fill="url(#cin-claw)"/>
      <path class="cl c3" d="M50,14 C63,30 76,44 88,58 C76,46 62,32 45,17 Z" fill="url(#cin-claw)"/>
    </g>
  </svg>`;
}

function causeEffect(kind) {
  if (kind === 'wolf') return clawSwipe();
  if (kind === 'poison') return '<span class="cinema-poison"><i></i><i></i><i></i><i></i></span>';
  if (kind === 'heart') return '<span class="cinema-heart">♥</span>';
  if (kind === 'shot') return '<span class="cinema-bolt"><i></i></span>';
  if (kind === 'vote') return '<span class="cinema-votes"><i></i><i></i><i></i><i></i></span>';
  return '<span class="cinema-fate">✦</span>';
}

// Public dawn and judgement sequence. Every victim first falls as the same
// anonymous villager, then the true sheet evolves into view. This preserves
// the game's knowledge rules while giving each death room to land.
export function deathCinematic(view) {
  const deaths = view.lastDeaths || [];
  if (!deaths.length) {
    return `<div class="cinema-empty ${view.nightResult?.healed ? 'healed' : ''}">
      ${view.nightResult?.healed ? '<img src="assets/sprites/props/potion-green.png" alt="">' : '<span class="cinema-sun">☀</span>'}
      <strong>${view.nightResult?.healed ? 'A life was pulled back from the dark' : 'Every door opens'}</strong>
      <small>No death is revealed.</small>
    </div>`;
  }
  return `<div class="cinema-deaths" style="--deaths:${deaths.length}">${deaths.map((death, index) => {
    const role = ROLES[death.role] || ROLES.villager;
    const kind = deathCauseKind(death.cause);
    return `<article class="cinema-death cause-${kind}" style="--beat:${index}">
      <div class="cinema-stage">
        <div class="cinema-body disguise">${sheetSprite('villager', {anim: 'death', loop: false, speed: 1.25, seedText: `${death.id}-fall`})}</div>
        <div class="cinema-body truth">${sheetSprite(death.role || 'villager', {anim: 'death', loop: false, speed: 1.25, seedText: `${death.id}-truth`})}</div>
        ${causeEffect(kind)}
        <span class="cinema-ring"></span>
      </div>
      <div class="cinema-reveal"><span>${esc(death.name)}</span><strong>${esc(role.name)}</strong><small>Claimed by ${esc(death.cause)}</small></div>
    </article>`;
  }).join('')}</div>`;
}

// Cupid's stage: two heart-chips wait either side; a silken thread joins
// them once both are chosen; the arrow rests nocked below until it is
// loosed, then flies the thread left to right and bursts on the far heart.
export function cupidCinematic(view, selected = [], {loosed = false} = {}) {
  const names = selected.map(id => view.players[id]?.name || '').filter(Boolean);
  return `<div class="cupid-cinema ${selected.length === 2 ? 'ready' : ''} ${loosed ? 'loosed' : ''}">
    <div class="cupid-hearts">
      <span class="heart-chip ${names[0] ? 'filled' : ''}">${esc(names[0] || 'Choose a heart')}</span>
      <b>♥</b>
      <span class="heart-chip ${names[1] ? 'filled' : ''}">${esc(names[1] || 'Choose another')}</span>
    </div>
    <div class="cupid-lane">
      <div class="heart-thread"><i></i><i></i><i></i><i></i><i></i></div>
      <img class="cupid-arrow" src="assets/sprites/props/arrow.png" alt="">
      <span class="arrow-burst" aria-hidden="true">♥</span>
    </div>
  </div>`;
}

export function seerCinematic(view, action) {
  const target = view.players[action.target];
  const role = ROLES[action.result] || ROLES.villager;
  return `<div class="seer-cinema">
    <img class="seer-orb" src="assets/sprites/props/crystal-ball.png" alt="Crystal ball">
    <div class="seer-form mortal">${sheetSprite('villager', {anim: 'idle', seedText: `${action.target}-mortal`})}</div>
    <div class="seer-form true-form">${sheetSprite(action.result || 'villager', {anim: 'act', loop: false, speed: 1.35, seedText: `${action.target}-vision`})}</div>
    <div class="seer-runes"><i>ᚠ</i><i>ᚱ</i><i>ᛟ</i><i>ᚾ</i></div>
    <div class="seer-verdict"><span>${esc(target?.name || 'The chosen soul')}</span><strong>${esc(role.name)}</strong></div>
  </div>`;
}

export function hunterCinematic() {
  return `<div class="hunter-cinema">
    <div class="hunter-actor">${sheetSprite('hunter', {anim: 'act', loop: false, speed: 1.15, seedText: 'last-shot'})}</div>
    <span class="hunter-sight"><i></i><i></i></span>
    <span class="hunter-bolt"></span>
  </div>`;
}
