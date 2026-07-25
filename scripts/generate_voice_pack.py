#!/usr/bin/env python3
"""Render Moonfall's narrator voice pack and premium ambience.

scripts/voice-lines.json maps each line id to an array of phrasing variants;
every variant is rendered to assets/voice/<id>.<n>.mp3 and the game picks one
at random per playback, so no two rounds sound alike.

Engines (all usable for free):
  elevenlabs  Used automatically when ELEVENLABS_API_KEY is set. Walks a
              model preference chain — Eleven v3 first, because it is the
              only model that reads the script's inline [audio tags] as
              delivery direction instead of speaking them, then
              multilingual_v2, then the cheap turbo/flash models as a last
              resort. Renders lines in dramatic-priority order under a hard
              budget guard, so a free tier that runs dry still yields a
              usable pack: whatever rendered is recorded in the manifest and
              the remaining lines fall back to on-device speech.
  edge        Default when no API key is set. Microsoft Edge neural voices
              (en-GB-RyanNeural), no account needed:  pip install edge-tts
  kokoro      Fully local, Apache-2.0 open weights:   pip install kokoro-onnx

If ffmpeg is on PATH, voice clips get a stone-hall storyteller treatment and
generated ambience/sfx are loudness-normalised. Run once and commit the audio;
deploys reuse the committed files and never spend credits again.
"""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINES_FILE = ROOT / "scripts" / "voice-lines.json"
VOICE_DIR = ROOT / "assets" / "voice"
AMBIENCE_DIR = ROOT / "assets" / "ambience"

EDGE_VOICE = os.environ.get("EDGE_VOICE", "en-GB-RyanNeural")
EDGE_RATE = os.environ.get("EDGE_RATE", "-12%")
EDGE_PITCH = os.environ.get("EDGE_PITCH", "-6Hz")
# "George" — warm, expressive British storyteller with far more intonation
# than the news-reader voices. Override with ELEVENLABS_VOICE_ID.
ELEVEN_VOICE = os.environ.get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
# Preference order, best first. The first model the API actually accepts for
# this account wins and is used for the whole run. Eleven v3 is the only one
# that understands the script's [audio tags]; everything below it gets the
# tags stripped so a fallback model never *says* the word "whispers".
MODEL_CHAIN = [name.strip() for name in os.environ.get(
    "ELEVENLABS_MODELS", "eleven_v3,eleven_multilingual_v2,eleven_turbo_v2_5").split(",") if name.strip()]
# Credits billed per character of input. The expressive models cost double
# the latency-optimised ones — that difference is the whole point of this
# pack, so the budget guard plans around the real number.
CREDITS_PER_CHAR = {
    "eleven_v3": 1.0,
    "eleven_multilingual_v2": 1.0,
    "eleven_multilingual_v1": 1.0,
    "eleven_turbo_v2_5": 0.5,
    "eleven_turbo_v2": 0.5,
    "eleven_flash_v2_5": 0.5,
    "eleven_flash_v2": 0.5,
}
RESERVE = int(os.environ.get("ELEVENLABS_RESERVE", "250"))
CREDIT_LIMIT = int(os.environ.get("ELEVENLABS_CREDIT_LIMIT", "10000"))
KOKORO_VOICE = os.environ.get("KOKORO_VOICE", "bm_george")

# Delivery direction for Eleven v3, e.g. "[whispers] Look." Stripped for
# every other engine, which would otherwise read the bracket aloud.
TAG_PATTERN = re.compile(r"\[[^\[\]]{1,48}\]\s*")

# Lines the table hears most often, or that carry the biggest moment, render
# first. If the free tier runs dry mid-run, what is missing is the filler.
PRIORITY = [
    "nightfall", "cue-night-wolves", "dawn-death", "reveal", "wake-village",
    "role-werewolf", "role-villager", "vote-death", "dawn-none",
    "cue-day-vote", "cue-day-discussion", "cue-night-seer", "cue-night-witch",
    "win-village", "win-wolves", "win-lovers", "role-seer", "role-witch",
    "role-hunter", "role-cupid", "another-death", "sleep-night-wolves",
    "sleep-night-seer", "sleep-night-witch", "cue-role-reveal",
]

SOUNDSCAPES = [
    ("theme-loop", "loops", "theme",
     "Seamless looping dark fantasy title music: a slow mysterious harp melody over soft low strings, "
     "sparse and atmospheric, quiet, medieval, moonlit.", 20),
    ("night-loop", "loops", "night",
     "Seamless looping night ambience in a quiet medieval village: soft wind through old trees, "
     "steady crickets, a distant owl, very faint eerie low drone. No music, no voices, no footsteps.", 20),
    ("day-loop", "loops", "day",
     "Seamless looping early-morning ambience in a medieval village: gentle varied birdsong, "
     "light breeze in leaves, distant rooster crow, calm and warm. No music, no voices.", 18),
    ("howl", "stings", "howl",
     "A single lone wolf howl echoing across a dark valley at night, haunting and mournful, "
     "with long natural reverb tail.", 6),
    ("kill", "stings", "kill",
     "Dark fantasy death impact: a deep sub boom with a sharp vicious bite and tearing cloth, "
     "short eerie decaying tail. No music.", 4),
    ("heal", "stings", "heal",
     "Magical healing shimmer: warm rising glass chimes with an angelic glow and soft sparkles "
     "fading gently.", 3),
    ("victory", "stings", "victory",
     "Short triumphant dark-fantasy victory sting: one deep drum hit, then bright heroic bells "
     "swelling and fading.", 5),
]


def api(path, payload=None, key=None, timeout=180, method=None):
    request = urllib.request.Request(
        f"https://api.elevenlabs.io{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"xi-api-key": key, "content-type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def credits_used(key):
    """Credits actually spent this billing period.

    The legacy ``character_count`` on /v1/user/subscription counts only TTS
    characters, so an account that has also generated sound effects looks far
    emptier than it is (this repo once read 2,440 there against 5,534 real
    credits). The analytics endpoint is the honest number; fall back to the
    legacy counter only if it is unavailable.
    """
    now_ms = int(time.time() * 1000)
    try:
        data = json.loads(api(
            "/v1/workspace/analytics/query/usage-by-product-over-time",
            {"start_time": now_ms - 40 * 24 * 60 * 60 * 1000, "end_time": now_ms, "interval_seconds": 86400},
            key=key, timeout=60, method="POST"))
        index = data["columns"].index("total_usage")
        return sum(float(row[index] or 0) for row in data.get("rows", [])), True
    except Exception:  # noqa: BLE001 — fall back to the legacy counter
        data = json.loads(api("/v1/user/subscription", key=key, timeout=60))
        return float(data.get("character_count", 0)), False


def subscription_limit(key):
    try:
        data = json.loads(api("/v1/user/subscription", key=key, timeout=60))
        return int(data.get("character_limit") or CREDIT_LIMIT), data.get("tier", "?")
    except Exception:  # noqa: BLE001
        return CREDIT_LIMIT, "?"


def strip_tags(text):
    return TAG_PATTERN.sub("", text).strip()


def pick_engine():
    forced = os.environ.get("VOICE_ENGINE")
    if forced:
        return forced
    return "elevenlabs" if os.environ.get("ELEVENLABS_API_KEY") else "edge"


def synth_edge(text, out_path):
    import asyncio

    import edge_tts

    async def run():
        communicate = edge_tts.Communicate(strip_tags(text), EDGE_VOICE, rate=EDGE_RATE, pitch=EDGE_PITCH)
        await communicate.save(str(out_path))

    asyncio.run(run())


class ElevenLabs:
    """Synthesises with the best model this account will actually serve."""

    def __init__(self, key):
        self.key = key
        self.chain = list(MODEL_CHAIN)
        self.model = None

    @property
    def credits_per_char(self):
        return CREDITS_PER_CHAR.get(self.model or self.chain[0], 1.0)

    def _settings(self, model):
        if model == "eleven_v3":
            # v3 accepts only three stability points. "Natural" (0.5) keeps
            # the narrator on-script while still following the audio tags;
            # "Creative" (0.0) swings harder but can wander off the line.
            return {"stability": float(os.environ.get("ELEVENLABS_STABILITY", "0.5")),
                    "similarity_boost": 0.75}
        # Low stability + high style is what buys intonation on v2 models.
        return {"stability": 0.32, "similarity_boost": 0.75, "style": 0.6, "use_speaker_boost": True}

    def _payload(self, text, model):
        spoken = text if model == "eleven_v3" else strip_tags(text)
        return {"text": spoken, "model_id": model, "voice_settings": self._settings(model)}

    def __call__(self, text, out_path):
        # Once a model has worked, stay on it; a mid-run switch would change
        # the narrator's delivery halfway through the pack.
        candidates = [self.model] if self.model else list(self.chain)
        last_error = None
        for model in candidates:
            try:
                audio = api(f"/v1/text-to-speech/{ELEVEN_VOICE}", self._payload(text, model), key=self.key)
            except urllib.error.HTTPError as error:
                body = error.read().decode("utf-8", "replace")[:200]
                # 400/404/422 here means "this account cannot use this model";
                # anything else (401, 429, 5xx) is a real failure worth raising.
                if error.code in (400, 404, 422) and not self.model:
                    print(f"    · {model} unavailable (HTTP {error.code}); trying the next model")
                    last_error = RuntimeError(f"{model}: HTTP {error.code} {body}")
                    continue
                raise RuntimeError(f"{model}: HTTP {error.code} {body}") from error
            out_path.write_bytes(audio)
            if self.model != model:
                self.model = model
                print(f"    · narrator model locked to {model} "
                      f"({CREDITS_PER_CHAR.get(model, 1.0)} credits/char)")
            return
        raise last_error or RuntimeError("no usable ElevenLabs model")


_kokoro = None


def synth_kokoro(text, out_path):
    global _kokoro
    import soundfile
    from kokoro_onnx import Kokoro

    if _kokoro is None:
        _kokoro = Kokoro(str(ROOT / "scripts" / "kokoro-v1.0.onnx"), str(ROOT / "scripts" / "voices-v1.0.bin"))
    samples, sample_rate = _kokoro.create(strip_tags(text), voice=KOKORO_VOICE, speed=0.88, lang="en-gb")
    soundfile.write(str(out_path), samples, sample_rate)


def ffmpeg_process(raw_path, final_path, filters, bitrate="64k", rate="32000"):
    if not shutil.which("ffmpeg"):
        shutil.move(str(raw_path), str(final_path))
        return
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw_path),
         "-af", filters, "-ac", "1", "-ar", rate, "-b:a", bitrate, str(final_path)],
        check=True,
    )
    raw_path.unlink(missing_ok=True)


# A midnight-table storyteller, not a cathedral. The old chain leaned on a
# long double echo that smeared consonants, and squashed the performance into
# a 9 LU range; a dramatic read needs its quiet lines to stay quiet, so the
# room is now short and close and the loudness range is left wide.
VOICE_FILTERS = os.environ.get(
    "VOICE_FILTERS",
    "asetrate=44100*0.98,aresample=44100,highpass=f=70,lowpass=f=11000,"
    "aecho=0.86:0.7:34|58:0.16|0.08,loudnorm=I=-16:TP=-1.5:LRA=14",
)
VOICE_RATE = os.environ.get("VOICE_RATE", "44100")
VOICE_BITRATE = os.environ.get("VOICE_BITRATE", "80k")
AMBIENCE_FILTERS = "loudnorm=I=-19:TP=-1.5:LRA=11"
STING_FILTERS = "loudnorm=I=-14:TP=-1.2:LRA=8"


def ordered_lines(lines):
    """Dramatic-priority order, then everything else in script order."""
    seen = set()
    for clip_id in PRIORITY:
        if clip_id in lines:
            seen.add(clip_id)
            yield clip_id, lines[clip_id]
    for clip_id, variants in lines.items():
        if clip_id not in seen:
            yield clip_id, variants


def prune_stale_variants(rendered_counts):
    """Delete clips left over from a longer previous script.

    The manifest is the contract the game and the tests read: if a line used
    to have three variants and now has two, `<id>.2.mp3` must not linger.
    """
    removed = 0
    for path in VOICE_DIR.glob("*.mp3"):
        stem = path.stem
        if "." not in stem:
            continue
        clip_id, _, index = stem.rpartition(".")
        if not index.isdigit():
            continue
        if int(index) >= rendered_counts.get(clip_id, 0):
            path.unlink(missing_ok=True)
            removed += 1
    return removed


def generate_voice_pack(lines, engine, synth, budget=None):
    """Render every variant it can afford, best lines first.

    ``budget`` is a callable returning the credits still safely spendable, or
    None for the free local engines. Returns True when the whole script
    rendered.
    """
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    rendered_counts = {}
    skipped = []
    fatal = None
    spent = 0.0
    with tempfile.TemporaryDirectory() as scratch:
        for clip_id, variants in ordered_lines(lines):
            rendered = 0
            for index, text in enumerate(variants):
                if budget is not None:
                    affordable, cost = budget(text)
                    if not affordable:
                        skipped.append(f"{clip_id}.{index}")
                        continue
                    spent += cost
                final_path = VOICE_DIR / f"{clip_id}.{index}.mp3"
                raw_path = Path(scratch) / f"{clip_id}.{index}.raw.mp3"
                try:
                    synth(text, raw_path)
                    if not raw_path.exists() or raw_path.stat().st_size < 800:
                        raise RuntimeError("engine produced no audio")
                except Exception as error:  # noqa: BLE001 — salvage whatever rendered
                    fatal = f"'{clip_id}' variant {index}: {error}"
                    break
                ffmpeg_process(raw_path, final_path, VOICE_FILTERS, bitrate=VOICE_BITRATE, rate=VOICE_RATE)
                rendered += 1
            # Variants must be contiguous from 0: the game picks an index at
            # random up to the manifest count.
            if rendered:
                rendered_counts[clip_id] = rendered
                print(f"  ✓ {clip_id} ({rendered}/{len(variants)} variants)")
            if fatal:
                break
    if fatal and len(rendered_counts) < max(8, len(lines) // 2):
        print(f"::error::Generation failed early ({fatal}); too little audio to keep. "
              "Is the key valid? A key ever committed to a public repo gets auto-revoked.")
        return False
    model = getattr(synth, "model", None)
    pack = {"version": 2, "engine": engine, "model": model, "clips": rendered_counts}
    (VOICE_DIR / "pack.json").write_text(json.dumps(pack, indent=2) + "\n")
    pruned = prune_stale_variants(rendered_counts)
    size = sum(item.stat().st_size for item in VOICE_DIR.glob("*.mp3"))
    total = sum(rendered_counts.values())
    if pruned:
        print(f"Removed {pruned} clip(s) left over from an earlier script.")
    if skipped:
        print(f"::warning::Out of credits before {len(skipped)} clip(s): {', '.join(skipped[:12])}"
              f"{'…' if len(skipped) > 12 else ''}. Those lines fall back to on-device speech.")
    if fatal:
        print(f"::warning::Generation interrupted at {fatal}. Salvaged {total} clips "
              f"across {len(rendered_counts)} of {len(lines)} lines ({size // 1024} KiB); "
              "missing lines fall back to on-device speech.")
    else:
        print(f"Voice pack complete: {total} clips across {len(rendered_counts)} lines, "
              f"{size // 1024} KiB, ≈{spent:.0f} credits spent.")
    return not fatal and not skipped


def generate_soundscapes(key):
    AMBIENCE_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"loops": {}, "stings": {}}
    limit, _ = subscription_limit(key)
    with tempfile.TemporaryDirectory() as scratch:
        for name, group, slot, prompt, seconds in SOUNDSCAPES:
            used, _ = credits_used(key)
            remaining = limit - used
            if remaining <= RESERVE + 400:
                print(f"  ✗ Skipping '{name}': only {remaining:.0f} credits left (reserve {RESERVE}).")
                continue
            try:
                audio = api("/v1/sound-generation",
                            {"text": prompt, "duration_seconds": seconds, "prompt_influence": 0.4,
                             "loop": group == "loops", "model_id": "eleven_text_to_sound_v2"},
                            key=key, timeout=300)
            except urllib.error.HTTPError as error:
                print(f"  ✗ '{name}' failed: HTTP {error.code} {error.read()[:160]!r}")
                continue
            raw_path = Path(scratch) / f"{name}.raw.mp3"
            raw_path.write_bytes(audio)
            final_path = AMBIENCE_DIR / f"{name}.mp3"
            ffmpeg_process(raw_path, final_path,
                           AMBIENCE_FILTERS if group == "loops" else STING_FILTERS,
                           bitrate="96k" if group == "loops" else "64k")
            manifest[group][slot] = f"{name}.mp3"
            time.sleep(1)
            print(f"  ✓ {name} ({final_path.stat().st_size // 1024} KiB)")
    if manifest["loops"] or manifest["stings"]:
        (AMBIENCE_DIR / "pack.json").write_text(json.dumps({"version": 1, **manifest}, indent=2) + "\n")
        print(f"Ambience pack complete: {len(manifest['loops'])} loops, {len(manifest['stings'])} stings.")
    else:
        print("No ambience was generated; the game keeps its procedural soundscape.")


def main():
    raw = json.loads(LINES_FILE.read_text())["lines"]
    lines = {clip_id: ([value] if isinstance(value, str) else list(value)) for clip_id, value in raw.items()}
    engine = pick_engine()
    total_chars = sum(len(text) for variants in lines.values() for text in variants)
    clip_count = sum(len(variants) for variants in lines.values())
    print(f"Rendering {clip_count} clips ({len(lines)} lines, {total_chars} characters) with engine '{engine}'…")

    if engine != "elevenlabs":
        synth = {"edge": synth_edge, "kokoro": synth_kokoro}[engine]
        generate_voice_pack(lines, engine, synth)
        return 0

    key = os.environ["ELEVENLABS_API_KEY"]
    try:
        limit, tier = subscription_limit(key)
        used, exact = credits_used(key)
    except urllib.error.HTTPError as error:
        print(f"::error::ElevenLabs rejected the key (HTTP {error.code}). It is invalid or was "
              "auto-revoked after being committed publicly — create a fresh key and try again.")
        return 1

    synth = ElevenLabs(key)
    remaining = limit - used
    spendable = remaining - RESERVE
    estimate = math.ceil(total_chars * synth.credits_per_char)
    source = "measured usage" if exact else "legacy character counter (may understate)"
    print(f"ElevenLabs tier '{tier}': {used:.0f}/{limit} credits used per {source}; "
          f"{remaining:.0f} remaining, {spendable:.0f} spendable above the {RESERVE} reserve.")
    print(f"Full script at {synth.credits_per_char} credits/char ≈ {estimate} credits.")
    if spendable <= 0:
        print("::error::No credits available above the reserve. Nothing was spent.")
        return 1
    if estimate > spendable:
        print(f"::warning::Budget covers roughly {spendable / max(0.5, synth.credits_per_char):.0f} of "
              f"{total_chars} characters. Rendering in dramatic-priority order; whatever does not "
              "fit falls back to on-device speech.")

    # Ledger the generator keeps itself, re-synced against the API every few
    # clips so a mis-estimate can never walk past the reserve.
    ledger = {"spendable": spendable, "since_check": 0}

    def budget(text):
        cost = math.ceil(len(text) * synth.credits_per_char)
        if ledger["since_check"] >= 12:
            try:
                fresh, _ = credits_used(key)
                ledger["spendable"] = (limit - fresh) - RESERVE
                ledger["since_check"] = 0
            except Exception:  # noqa: BLE001 — keep trusting the local ledger
                ledger["since_check"] = 0
        if cost > ledger["spendable"]:
            return False, 0
        ledger["spendable"] -= cost
        ledger["since_check"] += 1
        return True, cost

    complete = generate_voice_pack(lines, engine, synth, budget=budget)
    if not (VOICE_DIR / "pack.json").exists():
        return 1
    if complete and os.environ.get("SKIP_SFX") != "1":
        print("Generating premium ambience and stings with the remaining budget…")
        try:
            generate_soundscapes(key)
        except Exception as error:  # noqa: BLE001 — the voice pack is already safe
            print(f"::warning::Ambience generation stopped early: {error}")
    try:
        used, _ = credits_used(key)
        print(f"Done. {limit - used:.0f} free-tier credits remain on the account.")
    except Exception:  # noqa: BLE001
        print("Done (could not re-check the remaining balance).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
