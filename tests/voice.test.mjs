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
    for (let variant = 0; variant < count; variant += 1) {
      assert.ok(files.has(`${id}.${variant}.mp3`), `pack.json says ${id} has ${count} variants but ${id}.${variant}.mp3 is missing`);
    }
  }
  for (const id of Object.keys(lines)) {
    assert.ok(pack.clips[id], `voice-lines.json has ${id} but the generated pack does not`);
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
