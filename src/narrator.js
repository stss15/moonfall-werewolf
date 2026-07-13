// Storyteller voice-over built on the free, on-device Web Speech API.
// No network service is used: every modern phone ships its own voices.

const QUALITY_NAMES = /daniel|oliver|arthur|serena|stephanie|kate|aaron|evan|alex\b/;

let pendingTimer = null;
let watchdogTimer = null;
let pendingResolve = null;

function settleNarration(duration = 0) {
  clearTimeout(watchdogTimer);
  watchdogTimer = null;
  const resolve = pendingResolve;
  pendingResolve = null;
  if (resolve) resolve(duration);
}

export function narrationSupported() {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function pickNarratorVoice() {
  if (!narrationSupported()) return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  const english = voices.filter(voice => (voice.lang || '').toLowerCase().startsWith('en'));
  const pool = english.length ? english : voices;
  return pool
    .map(voice => {
      const name = (voice.name || '').toLowerCase();
      let score = 0;
      if (voice.localService) score += 4;
      if (QUALITY_NAMES.test(name)) score += 6;
      if (name.includes('google uk english male')) score += 6;
      if (name.includes('google uk english')) score += 5;
      if (name.includes('google us english')) score += 4;
      if (/natural|neural|premium|enhanced/.test(name)) score += 3;
      if ((voice.lang || '').toLowerCase() === 'en-gb') score += 2;
      if (voice.default) score += 1;
      return {voice, score};
    })
    .sort((a, b) => b.score - a.score)[0].voice;
}

export function narrate(text, {delay = 0, rate = .92, pitch = .82, volume = 1} = {}) {
  if (!narrationSupported() || !text) return Promise.resolve(0);
  stopNarration();
  const queuedAt = Date.now();
  return new Promise(resolve => {
    pendingResolve = resolve;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = pickNarratorVoice();
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        utterance.rate = rate;
        utterance.pitch = pitch;
        utterance.volume = volume;
        utterance.onend = () => settleNarration(Date.now() - queuedAt);
        utterance.onerror = () => settleNarration(Date.now() - queuedAt);
        speechSynthesis.cancel();
        speechSynthesis.speak(utterance);
        const estimated = Math.max(1800, text.trim().split(/\s+/).length * 560 / Math.max(.5, rate));
        watchdogTimer = setTimeout(() => settleNarration(Date.now() - queuedAt), estimated + 2500);
      } catch {
        settleNarration(Date.now() - queuedAt);
      }
    }, Math.max(0, delay));
  });
}

export function stopNarration() {
  clearTimeout(pendingTimer);
  clearTimeout(watchdogTimer);
  pendingTimer = null;
  watchdogTimer = null;
  if (!narrationSupported()) return;
  try { speechSynthesis.cancel(); } catch { /* no-op */ }
  settleNarration(0);
}

// Some engines (notably Chrome) load voices asynchronously; warming the list
// once means the first real cue already has the best narrator selected.
if (narrationSupported()) {
  try {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
  } catch { /* no-op */ }
}
