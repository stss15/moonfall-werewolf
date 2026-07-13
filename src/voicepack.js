// Plays the pre-recorded narrator voice pack (assets/voice/*.mp3) when it has
// been generated, sequencing short clips into full lines on the Web Audio
// timeline. Each line may have several recorded phrasing variants; one is
// chosen at random per playback so no two rounds sound identical. When the
// pack is absent the caller falls back to the on-device Web Speech narrator.

let clipVariants = null; // Map<id, variantCount>
let packEngine = null;
const bufferCache = new Map();
let generation = 0;
let activeSources = [];

export async function initVoicePack() {
  try {
    const response = await fetch('assets/voice/pack.json', {cache: 'no-cache'});
    if (!response.ok) return false;
    const data = await response.json();
    if (Array.isArray(data?.clips) && data.clips.length) {
      // v1 packs: one un-numbered file per id.
      clipVariants = new Map(data.clips.map(id => [id, 0]));
    } else if (data?.clips && typeof data.clips === 'object' && Object.keys(data.clips).length) {
      clipVariants = new Map(Object.entries(data.clips).map(([id, count]) => [id, Math.max(1, Number(count) || 1)]));
    } else {
      return false;
    }
    packEngine = data.engine || null;
    return true;
  } catch {
    clipVariants = null;
    return false;
  }
}

export const voicePackReady = () => Boolean(clipVariants?.size);

export const voicePackEngine = () => packEngine;

export const voicePackCovers = ids => Boolean(clipVariants) && ids.length > 0 && ids.every(id => clipVariants.has(id));

function fileFor(id) {
  const count = clipVariants.get(id);
  if (!count) return `assets/voice/${id}.mp3`;
  const variant = Math.floor(Math.random() * count);
  return `assets/voice/${id}.${variant}.mp3`;
}

function bufferFor(context, file) {
  if (bufferCache.has(file)) return bufferCache.get(file);
  const promise = fetch(file)
    .then(response => {
      if (!response.ok) throw new Error(`missing narrator clip ${file}`);
      return response.arrayBuffer();
    })
    .then(bytes => context.decodeAudioData(bytes));
  bufferCache.set(file, promise);
  promise.catch(() => bufferCache.delete(file));
  return promise;
}

export function warmVoicePack(context, ids = null) {
  if (!context || !clipVariants) return;
  for (const id of ids || clipVariants.keys()) {
    const count = clipVariants.get(id);
    if (count === undefined) continue;
    if (!count) {
      bufferFor(context, `assets/voice/${id}.mp3`).catch(() => {});
    } else {
      for (let variant = 0; variant < count; variant += 1) {
        bufferFor(context, `assets/voice/${id}.${variant}.mp3`).catch(() => {});
      }
    }
  }
}

export function stopVoicePack() {
  generation += 1;
  for (const source of activeSources) {
    try { source.stop(); } catch { /* already ended */ }
  }
  activeSources = [];
}

// Plays a clip sequence and returns its total length in milliseconds (0 when
// the pack cannot serve it), so callers can pace the game on the spoken audio.
export async function playVoicePack(context, ids, {delay = 0, gap = .3, volume = 1} = {}) {
  if (!context || !voicePackCovers(ids)) return 0;
  stopVoicePack();
  const mine = generation;
  let buffers;
  try {
    buffers = await Promise.all(ids.map(id => bufferFor(context, fileFor(id))));
  } catch {
    return 0;
  }
  const spoken = buffers.reduce((total, buffer) => total + buffer.duration, 0);
  const totalMs = Math.round(Math.max(0, delay) + (spoken + Math.max(0, buffers.length - 1) * gap) * 1000);
  if (generation !== mine) return totalMs;
  const gain = context.createGain();
  gain.gain.value = volume;
  gain.connect(context.destination);
  let at = context.currentTime + Math.max(0, delay) / 1000;
  for (const buffer of buffers) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(at);
    at += buffer.duration + gap;
    activeSources.push(source);
  }
  return totalMs;
}
