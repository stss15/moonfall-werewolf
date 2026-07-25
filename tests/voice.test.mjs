import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {ROLES, STORY_CUES} from '../src/roles.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const asVariants = value => Array.isArray(value) ? value : [value];

test('the narrator script covers every line the game can compose', async () => {
  const {lines} = JSON.parse(await readFile(join(root, 'scripts/voice-lines.json'), 'utf8'));

  for (const [id, value] of Object.entries(lines)) {
    const variants = asVariants(value);
    assert.ok(variants.length >= 1, `line ${id} must have at least one variant`);
    for (const text of variants) {
      assert.ok(typeof text === 'string' && text.trim().length > 4, `line ${id} must contain spoken text in every variant`);
    }
  }

  // Every static phase cue the app narrates must have a recorded clip.
  const dynamicPhases = new Set(['dawn', 'day-result']);
  for (const phase of Object.keys(STORY_CUES)) {
    if (dynamicPhases.has(phase)) continue;
    assert.ok(lines[`cue-${phase}`], `missing narrator cue clip for phase ${phase}`);
  }

  // Every role can be revealed at dawn or after a vote.
  for (const roleId of Object.keys(ROLES)) {
    assert.ok(lines[`role-${roleId}`], `missing narrator role clip for ${roleId}`);
  }

  for (const id of ['nightfall', 'preview', 'wake-village', 'dawn-none', 'dawn-death', 'reveal', 'another-death',
    'vote-tied', 'vote-none', 'vote-death', 'win-village', 'win-wolves', 'win-lovers', 'win-none',
    'sleep-night-seer', 'sleep-night-wolves', 'sleep-night-witch']) {
    assert.ok(lines[id], `missing narrator clip ${id}`);
  }
});

test('a generated voice pack manifest matches the clips on disk', async t => {
  let pack;
  try {
    pack = JSON.parse(await readFile(join(root, 'assets/voice/pack.json'), 'utf8'));
  } catch {
    t.skip('no voice pack generated in this checkout (on-device speech fallback is used)');
    return;
  }
  const files = new Set(await readdir(join(root, 'assets/voice')));
  const {lines} = JSON.parse(await readFile(join(root, 'scripts/voice-lines.json'), 'utf8'));
  if (Array.isArray(pack.clips)) {
    // v1 pack: one un-numbered file per id.
    for (const id of pack.clips) {
      assert.ok(files.has(`${id}.mp3`), `pack.json lists ${id} but ${id}.mp3 is missing`);
    }
    return;
  }
  for (const [id, count] of Object.entries(pack.clips)) {
    assert.ok(lines[id], `pack.json lists ${id} but it is not in voice-lines.json`);
    assert.ok(count <= asVariants(lines[id]).length,
      `pack.json claims ${count} variants for ${id} but the script only writes ${asVariants(lines[id]).length}`);
    for (let variant = 0; variant < count; variant += 1) {
      assert.ok(files.has(`${id}.${variant}.mp3`), `pack.json says ${id} has ${count} variants but ${id}.${variant}.mp3 is missing`);
    }
  }

  // No orphans: a clip on disk that the manifest does not list can never be
  // played, and means an earlier, longer script was left behind.
  for (const file of files) {
    if (!file.endsWith('.mp3')) continue;
    const [id, variant] = [file.slice(0, file.lastIndexOf('.', file.length - 5)), Number(file.split('.').at(-2))];
    assert.ok(pack.clips[id] > variant, `${file} is on disk but pack.json does not list that variant`);
  }

  // Generation is budget-guarded on the free tier, so a partial pack is a
  // supported state: the game falls back to on-device speech per missing
  // line. Only report what is missing — do not fail the build for it.
  const missing = Object.keys(lines).filter(id => !pack.clips[id]);
  if (missing.length) t.diagnostic(`${missing.length} line(s) fall back to on-device speech: ${missing.join(', ')}`);
});

test('the on-device fallback speaks the same words as the recorded pack', async () => {
  const {lines} = JSON.parse(await readFile(join(root, 'scripts/voice-lines.json'), 'utf8'));
  const stripTags = text => text.replace(/\[[^\[\]]{1,48}\]\s*/g, '').trim();

  // Audio tags are delivery direction for Eleven v3. Any engine without tag
  // support has them stripped, so a tag must never carry meaning the
  // sentence needs — every variant has to read as clean prose without it.
  for (const [id, value] of Object.entries(lines)) {
    for (const text of asVariants(value)) {
      const spoken = stripTags(text);
      assert.ok(spoken.length > 3, `line ${id} is empty once its audio tags are stripped`);
      assert.ok(!/[[\]]/.test(spoken), `line ${id} has an unbalanced audio tag: ${text}`);
      assert.ok(/^[A-Z“"']/.test(spoken), `line ${id} does not start a sentence once tags are stripped: ${spoken}`);
    }
  }

  // The Web Speech fallback must not sound like a different narrator wrote it.
  const cueFor = {'role-reveal': 'cue-role-reveal', 'setup-thief': 'cue-setup-thief', 'setup-cupid': 'cue-setup-cupid',
    'setup-lovers': 'cue-setup-lovers', 'night-seer': 'cue-night-seer', 'night-wolves': 'cue-night-wolves',
    'night-witch': 'cue-night-witch', 'sheriff-vote': 'cue-sheriff-vote', 'day-discussion': 'cue-day-discussion',
    'day-vote': 'cue-day-vote'};
  const normalise = text => text.replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  for (const [phase, id] of Object.entries(cueFor)) {
    const spoken = asVariants(lines[id]).map(text => normalise(stripTags(text)));
    assert.ok(spoken.includes(normalise(STORY_CUES[phase])),
      `STORY_CUES['${phase}'] is not one of the recorded variants of ${id}`);
  }
});

test('a generated ambience pack manifest matches the files on disk', async t => {
  let pack;
  try {
    pack = JSON.parse(await readFile(join(root, 'assets/ambience/pack.json'), 'utf8'));
  } catch {
    t.skip('no ambience pack generated in this checkout (procedural soundscape is used)');
    return;
  }
  const files = new Set(await readdir(join(root, 'assets/ambience')));
  for (const group of ['loops', 'stings']) {
    for (const [slot, file] of Object.entries(pack[group] || {})) {
      assert.ok(files.has(file), `ambience pack lists ${group}.${slot} as ${file} but the file is missing`);
    }
  }
});
