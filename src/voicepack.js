// Plays the pre-recorded narrator voice pack (assets/voice/*.mp3) when it has
// been generated, sequencing short clips into full lines on the Web Audio
// timeline. When the pack is absent the caller falls back to the on-device
// Web Speech narrator, so a fresh clone still speaks without any build step.

let clipIds = null;
const bufferCache = new Map();
let generation = 0;
let activeSources = [];

export async function initVoicePack() {
  try {
    const response = await fetch('assets/voice/pack.json', {cache: 'no-cache'});
    if (!response.ok) return false;
    const data = await response.json();
    if (!Array.isArray(data?.clips) || !data.clips.length) return false;
    clipIds = new Set(data.clips);
    return true;
  } catch {
    clipIds = null;
    return false;
  }
}

export const voicePackReady = () => Boolean(clipIds?.size);

export const voicePackCovers = ids => Boolean(clipIds) && ids.length > 0 && ids.every(id => clipIds.has(id));

function bufferFor(context, id) {
  if (bufferCache.has(id)) return bufferCache.get(id);
  const promise = fetch(`assets/voice/${id}.mp3`)
    .then(response => {
      if (!response.ok) throw new Error(`missing narrator clip ${id}`);
      return response.arrayBuffer();
    })
    .then(bytes => context.decodeAudioData(bytes));
  bufferCache.set(id, promise);
  promise.catch(() => bufferCache.delete(id));
  return promise;
}

export function warmVoicePack(context, ids = null) {
  if (!context || !clipIds) return;
  for (const id of ids || clipIds) if (clipIds.has(id)) bufferFor(context, id).catch(() => {});
}

export function stopVoicePack() {
  generation += 1;
  for (const source of activeSources) {
    try { source.stop(); } catch { /* already ended */ }
  }
  activeSources = [];
}

export async function playVoicePack(context, ids, {delay = 0, gap = .3, volume = 1} = {}) {
  if (!context || !voicePackCovers(ids)) return 0;
  stopVoicePack();
  const mine = generation;
  let buffers;
  try {
    buffers = await Promise.all(ids.map(id => bufferFor(context, id)));
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
