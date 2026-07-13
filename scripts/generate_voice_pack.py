#!/usr/bin/env python3
"""Render Moonfall's narrator voice pack and premium ambience.

scripts/voice-lines.json maps each line id to an array of phrasing variants;
every variant is rendered to assets/voice/<id>.<n>.mp3 and the game picks one
at random per playback, so no two rounds sound alike.

Engines (all usable for free):
  elevenlabs  Used automatically when ELEVENLABS_API_KEY is set. Renders the
              voice pack with an expressive storyteller voice and, with the
              remaining budget, generates looping night/day ambience and a few
              hero sound effects via the sound-generation API. A hard budget
              guard keeps the account inside the free tier: the script checks
              the subscription quota before every spend and refuses any call
              that would drop remaining credits below ELEVENLABS_RESERVE
              (default 800). Free-tier output requires attribution
              ("audio by elevenlabs.io") and is non-commercial.
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
ELEVEN_MODEL = os.environ.get("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5")
ELEVEN_CREDITS_PER_CHAR = float(os.environ.get("ELEVENLABS_CREDITS_PER_CHAR", "0.5"))
RESERVE = int(os.environ.get("ELEVENLABS_RESERVE", "800"))
KOKORO_VOICE = os.environ.get("KOKORO_VOICE", "bm_george")

SOUNDSCAPES = [
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


def api(path, payload=None, key=None, timeout=180):
    request = urllib.request.Request(
        f"https://api.elevenlabs.io{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"xi-api-key": key, "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def remaining_credits(key):
    data = json.loads(api("/v1/user/subscription", key=key))
    used, limit = data.get("character_count", 0), data.get("character_limit", 0)
    return limit - used, data.get("tier", "?")


def pick_engine():
    forced = os.environ.get("VOICE_ENGINE")
    if forced:
        return forced
    return "elevenlabs" if os.environ.get("ELEVENLABS_API_KEY") else "edge"


def synth_edge(text, out_path):
    import asyncio

    import edge_tts

    async def run():
        communicate = edge_tts.Communicate(text, EDGE_VOICE, rate=EDGE_RATE, pitch=EDGE_PITCH)
        await communicate.save(str(out_path))

    asyncio.run(run())


def synth_elevenlabs(text, out_path):
    body = {
        "text": text,
        "model_id": ELEVEN_MODEL,
        # Low stability + high style: maximum intonation and delivery variety.
        "voice_settings": {"stability": 0.32, "similarity_boost": 0.75, "style": 0.55},
    }
    out_path.write_bytes(api(f"/v1/text-to-speech/{ELEVEN_VOICE}", body, key=os.environ["ELEVENLABS_API_KEY"]))


_kokoro = None


def synth_kokoro(text, out_path):
    global _kokoro
    import soundfile
    from kokoro_onnx import Kokoro

    if _kokoro is None:
        _kokoro = Kokoro(str(ROOT / "scripts" / "kokoro-v1.0.onnx"), str(ROOT / "scripts" / "voices-v1.0.bin"))
    samples, sample_rate = _kokoro.create(text, voice=KOKORO_VOICE, speed=0.88, lang="en-gb")
    soundfile.write(str(out_path), samples, sample_rate)


def ffmpeg_process(raw_path, final_path, filters, bitrate="64k"):
    if not shutil.which("ffmpeg"):
        shutil.move(str(raw_path), str(final_path))
        return
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw_path),
         "-af", filters, "-ac", "1", "-ar", "32000", "-b:a", bitrate, str(final_path)],
        check=True,
    )
    raw_path.unlink(missing_ok=True)


VOICE_FILTERS = os.environ.get(
    "VOICE_FILTERS",
    "asetrate=44100*0.97,aresample=44100,lowpass=f=7500,"
    "aecho=0.8:0.9:60|180:0.22|0.11,loudnorm=I=-16:TP=-1.5:LRA=9",
)
AMBIENCE_FILTERS = "loudnorm=I=-19:TP=-1.5:LRA=11"
STING_FILTERS = "loudnorm=I=-14:TP=-1.2:LRA=8"


def generate_voice_pack(lines, engine, synth):
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    with tempfile.TemporaryDirectory() as scratch:
        for clip_id, variants in lines.items():
            for index, text in enumerate(variants):
                final_path = VOICE_DIR / f"{clip_id}.{index}.mp3"
                raw_path = Path(scratch) / f"{clip_id}.{index}.raw.mp3"
                synth(text, raw_path)
                if not raw_path.exists() or raw_path.stat().st_size < 800:
                    raise RuntimeError(f"Engine produced no audio for '{clip_id}' variant {index}")
                ffmpeg_process(raw_path, final_path, VOICE_FILTERS)
                total += 1
            print(f"  ✓ {clip_id} ({len(variants)} variant{'s' if len(variants) > 1 else ''})")
    pack = {"version": 2, "engine": engine, "clips": {clip_id: len(variants) for clip_id, variants in lines.items()}}
    (VOICE_DIR / "pack.json").write_text(json.dumps(pack, indent=2) + "\n")
    size = sum(item.stat().st_size for item in VOICE_DIR.glob("*.mp3"))
    print(f"Voice pack complete: {total} clips across {len(lines)} lines, {size // 1024} KiB.")


def generate_soundscapes(key):
    AMBIENCE_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"loops": {}, "stings": {}}
    with tempfile.TemporaryDirectory() as scratch:
        for name, group, slot, prompt, seconds in SOUNDSCAPES:
            remaining, _ = remaining_credits(key)
            if remaining <= RESERVE + 400:
                print(f"  ✗ Skipping '{name}': only {remaining} credits left (reserve {RESERVE}).")
                continue
            before = remaining
            try:
                audio = api("/v1/sound-generation",
                            {"text": prompt, "duration_seconds": seconds, "prompt_influence": 0.4},
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
            after, _ = remaining_credits(key)
            print(f"  ✓ {name} ({final_path.stat().st_size // 1024} KiB, cost {before - after} credits, {after} left)")
    if manifest["loops"] or manifest["stings"]:
        (AMBIENCE_DIR / "pack.json").write_text(json.dumps({"version": 1, **manifest}, indent=2) + "\n")
        print(f"Ambience pack complete: {len(manifest['loops'])} loops, {len(manifest['stings'])} stings.")
    else:
        print("No ambience was generated; the game keeps its procedural soundscape.")


def main():
    raw = json.loads(LINES_FILE.read_text())["lines"]
    lines = {clip_id: ([value] if isinstance(value, str) else list(value)) for clip_id, value in raw.items()}
    engine = pick_engine()
    synth = {"edge": synth_edge, "elevenlabs": synth_elevenlabs, "kokoro": synth_kokoro}[engine]
    total_chars = sum(len(text) for variants in lines.values() for text in variants)
    print(f"Rendering {sum(len(v) for v in lines.values())} clips "
          f"({len(lines)} lines, {total_chars} characters) with engine '{engine}'…")

    if engine == "elevenlabs":
        key = os.environ["ELEVENLABS_API_KEY"]
        remaining, tier = remaining_credits(key)
        voice_cost = math.ceil(total_chars * ELEVEN_CREDITS_PER_CHAR)
        print(f"ElevenLabs tier '{tier}': {remaining} credits remaining. "
              f"Voice pack will cost ≈{voice_cost}; reserve is {RESERVE}.")
        if remaining - voice_cost < RESERVE:
            print("::error::Not enough free-tier credits for the voice pack. Nothing was spent.")
            return 1
        generate_voice_pack(lines, engine, synth)
        if os.environ.get("SKIP_SFX") != "1":
            print("Generating premium ambience and stings with the remaining budget…")
            generate_soundscapes(key)
        remaining, _ = remaining_credits(key)
        print(f"Done. {remaining} free-tier credits remain on the account.")
    else:
        generate_voice_pack(lines, engine, synth)
    return 0


if __name__ == "__main__":
    sys.exit(main())
