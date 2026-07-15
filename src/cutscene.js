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

function causeEffect(kind) {
  if (kind === 'wolf') return '<span class="cinema-claws"><i></i><i></i><i></i></span>';
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

export function cupidCinematic(view, selected = [], {loosed = false} = {}) {
  const names = selected.map(id => view.players[id]?.name || '').filter(Boolean);
  return `<div class="cupid-cinema ${selected.length === 2 ? 'ready' : ''} ${loosed ? 'loosed' : ''}">
    <div class="cupid-hearts"><span>${esc(names[0] || 'Choose a heart')}</span><b>♥</b><span>${esc(names[1] || 'Choose another')}</span></div>
    <img class="cupid-arrow" src="assets/sprites/props/arrow.png" alt="">
    <div class="heart-thread"><i></i><i></i><i></i><i></i><i></i></div>
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
