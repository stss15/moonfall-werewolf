#!/usr/bin/env python3
"""Render Moonfall's narrator voice pack from scripts/voice-lines.json.

The whole script is ~2 minutes of audio split into short, composable clips,
so it only ever needs to be generated once per voice. Output goes to
assets/voice/<id>.mp3 plus assets/voice/pack.json; the game plays these on
the Storyteller's phone and falls back to on-device Web Speech when absent.

Engines (all usable for free):
  elevenlabs  Used automatically when ELEVENLABS_API_KEY is set. The free
              tier's ~10k monthly credits cover this script several times
              over. Default voice is "Daniel" (deep British narrator);
              override with ELEVENLABS_VOICE_ID. Note: ElevenLabs' free
              tier requires attribution and is non-commercial.
  edge        Default when no API key is set. Microsoft Edge neural voices
              (en-GB-RyanNeural), no account needed:  pip install edge-tts
  kokoro      Fully local, Apache-2.0 open weights:   pip install kokoro-onnx
              (place kokoro-v1.0.onnx + voices-v1.0.bin next to this script)

If ffmpeg is on PATH, every clip gets a subtle "storyteller in a stone
hall" treatment: slight pitch-down, soft high roll-off, cavernous echo and
loudness normalisation. Without ffmpeg the raw clips are used as-is.

Usage:
  python3 scripts/generate_voice_pack.py            # auto-pick engine
  VOICE_ENGINE=kokoro python3 scripts/generate_voice_pack.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINES_FILE = ROOT / "scripts" / "voice-lines.json"
OUT_DIR = ROOT / "assets" / "voice"

EDGE_VOICE = os.environ.get("EDGE_VOICE", "en-GB-RyanNeural")
EDGE_RATE = os.environ.get("EDGE_RATE", "-12%")
EDGE_PITCH = os.environ.get("EDGE_PITCH", "-6Hz")
ELEVEN_VOICE = os.environ.get("ELEVENLABS_VOICE_ID", "onwK4e9ZLuTAKqWW03F9")  # "Daniel"
ELEVEN_MODEL = os.environ.get("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5")
KOKORO_VOICE = os.environ.get("KOKORO_VOICE", "bm_george")


def pick_engine() -> str:
    forced = os.environ.get("VOICE_ENGINE")
    if forced:
        return forced
    if os.environ.get("ELEVENLABS_API_KEY"):
        return "elevenlabs"
    return "edge"


def synth_edge(text: str, out_path: Path) -> None:
    import asyncio

    import edge_tts

    async def run() -> None:
        communicate = edge_tts.Communicate(text, EDGE_VOICE, rate=EDGE_RATE, pitch=EDGE_PITCH)
        await communicate.save(str(out_path))

    asyncio.run(run())


def synth_elevenlabs(text: str, out_path: Path) -> None:
    import urllib.request

    body = json.dumps({
        "text": text,
        "model_id": ELEVEN_MODEL,
        "voice_settings": {"stability": 0.4, "similarity_boost": 0.8, "style": 0.4},
    }).encode()
    request = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVEN_VOICE}",
        data=body,
        headers={
            "xi-api-key": os.environ["ELEVENLABS_API_KEY"],
            "content-type": "application/json",
            "accept": "audio/mpeg",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        out_path.write_bytes(response.read())


_kokoro = None


def synth_kokoro(text: str, out_path: Path) -> None:
    global _kokoro
    import soundfile
    from kokoro_onnx import Kokoro

    if _kokoro is None:
        model = ROOT / "scripts" / "kokoro-v1.0.onnx"
        voices = ROOT / "scripts" / "voices-v1.0.bin"
        _kokoro = Kokoro(str(model), str(voices))
    samples, sample_rate = _kokoro.create(text, voice=KOKORO_VOICE, speed=0.88, lang="en-gb")
    soundfile.write(str(out_path.with_suffix(".wav")), samples, sample_rate)
    shutil.move(str(out_path.with_suffix(".wav")), str(out_path))


def spookify(raw_path: Path, final_path: Path) -> None:
    """Slight pitch-down + stone-hall echo + loudness normalisation."""
    if not shutil.which("ffmpeg"):
        shutil.move(str(raw_path), str(final_path))
        return
    filters = os.environ.get(
        "VOICE_FILTERS",
        "asetrate=44100*0.97,aresample=44100,"
        "lowpass=f=7500,"
        "aecho=0.8:0.9:60|180:0.22|0.11,"
        "loudnorm=I=-17:TP=-1.5:LRA=8",
    )
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(raw_path),
            "-af", filters,
            "-ac", "1", "-ar", "24000", "-b:a", "64k",
            str(final_path),
        ],
        check=True,
    )
    raw_path.unlink(missing_ok=True)


def main() -> int:
    lines = json.loads(LINES_FILE.read_text())["lines"]
    engine = pick_engine()
    synth = {"edge": synth_edge, "elevenlabs": synth_elevenlabs, "kokoro": synth_kokoro}[engine]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Rendering {len(lines)} narrator clips with engine '{engine}'…")
    with tempfile.TemporaryDirectory() as scratch:
        for clip_id, text in lines.items():
            final_path = OUT_DIR / f"{clip_id}.mp3"
            raw_path = Path(scratch) / f"{clip_id}.raw.mp3"
            synth(text, raw_path)
            if not raw_path.exists() or raw_path.stat().st_size < 1000:
                raise RuntimeError(f"Engine produced no audio for '{clip_id}'")
            spookify(raw_path, final_path)
            print(f"  ✓ {clip_id} ({final_path.stat().st_size // 1024} KiB)")
    pack = {"version": 1, "engine": engine, "clips": sorted(lines.keys())}
    (OUT_DIR / "pack.json").write_text(json.dumps(pack, indent=2) + "\n")
    total = sum(item.stat().st_size for item in OUT_DIR.glob("*.mp3"))
    print(f"Voice pack complete: {len(lines)} clips, {total // 1024} KiB total, manifest at assets/voice/pack.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
