import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


EFFECTS = [
    ('wolves', '01', 4.0, 'Aggressive werewolf pack wake cue, one dominant wolf snarls then unleashes a savage rising howl, two distant wolves answer, dark medieval horror, no music, no speech'),
    ('wolves', '02', 4.0, 'Ferocious close wolf growl erupts into a deep violent howl with a second pack howl behind it, terrifying moonlit forest, cinematic horror sting, no music, no speech'),
    ('wolves', '03', 4.0, 'Three supernatural wolves growling and breathing, sudden brutal alpha howl cuts through the night, threatening and animalistic, short game cue, no music, no speech'),
    ('cupid', '01', 3.0, 'Taut wooden bowstring drawn close, arrow released with a fast air whistle, lands in a magical warm heart shimmer, romantic fantasy game cue, no music, no speech'),
    ('cupid', '02', 3.0, 'Elegant bow draw creak, feathered arrow flies left to right, soft sparkling heart pulse blooms on impact, playful magical love cue, no speech'),
    ('cupid', '03', 3.0, 'Quick cupid arrow launch, bright airy whoosh, two gentle heartbeats and a tender magical chime bloom, whimsical love magic, no music, no speech'),
    ('lovers', '01', 3.0, 'Two soft human heartbeats gradually synchronize, warm magical shimmer joins them, intimate enchanted lovers reveal cue, no speech, no music'),
    ('lovers', '02', 3.0, 'Pair of heartbeats answer each other then beat together, delicate glowing love magic and soft breathy sparkle, fantasy game cue, no speech'),
    ('seer', '01', 3.0, 'Crystal orb awakens with a low glass resonance, ghostly reverse whisper textures swirl, one bright clairvoyant chime reveals a vision, no intelligible speech, no music'),
    ('seer', '02', 3.0, 'Mystical divination cue, crystal singing bowl shimmer, airy spectral whispers with no words, sudden sparkling vision reveal, dark fantasy, no music'),
    ('witch', '01', 3.0, 'Sinister old witch cackle in the distance followed by potion bottle clink and bubbling cauldron, theatrical dark fairy tale cue, no words, no music'),
    ('witch', '02', 3.0, 'Creepy restrained witch laugh, cork pops from potion vial, liquid bubbles and magical fizz rises sharply, short horror game cue, no speech'),
    ('witch', '03', 3.0, 'Low wicked female cackle echoing in a stone room, glass potion bottles rattle, poisonous bubbling hiss, dark fantasy cue, no intelligible words'),
    ('little-girl', '01', 2.5, 'Distant creepy young girl giggle in a dark hallway, one playful breath then silence, haunted but subtle, short horror game cue, no words, no music'),
    ('little-girl', '02', 2.5, 'Soft eerie childlike giggle from behind a door, tiny floorboard creak and a quick hush, unsettling supernatural horror cue, no speech'),
    ('little-girl', '03', 2.5, 'Faint haunted little girl laugh moving from far to near then abruptly stopping, chilling and restrained, no words, no music'),
    ('thief', '01', 2.5, 'Old iron keys quietly jingle, lockpick scrapes inside a medieval lock, tiny click as it opens, stealthy thief game cue, no music, no speech'),
    ('thief', '02', 2.5, 'Leather pouch rustle, two brass keys clink softly, lock mechanism turns and clicks open, secretive medieval thief cue, no speech'),
    ('hunter', '01', 2.5, 'Old hunting musket hammer pulled back with a heavy metallic cock, tense breath, abrupt powerful gunshot with short forest echo, no speech, no music'),
    ('hunter', '02', 2.5, 'Crossbow mechanism cranks and locks, taut string snaps forward with a violent bolt launch and wooden impact, dark medieval hunter cue, no speech'),
    ('death', '01', 4.0, 'Sudden werewolf attack in darkness, terrified adult scream cut short, savage snarling, ripping cloth and wet tearing impact, brief cinematic horror death sting, no music'),
    ('death', '02', 4.0, 'Human gasp turns into a sharp scream as a beast lunges, wolf growl, violent struggle and tearing flesh-like horror sound, ends abruptly, no music, no words'),
    ('death', '03', 4.0, 'Nightmare creature kill sting, panicked scream, heavy body impact, aggressive animal snarl and brutal ripping texture, short dark horror, no music'),
    ('revive', '01', 3.0, 'Dead silence, sudden deep human gasp back to life, desperate inhale and two recovering breaths, faint magical shimmer underneath, resurrection cue, no words, no music'),
    ('revive', '02', 3.0, 'A person jolts awake with a huge gasping breath, lungs refill, heartbeat returns and soft healing magic glows, dramatic revival game cue, no speech'),
    ('revive', '03', 3.0, 'Near silence then sharp life-restoring inhale, relieved breathing and a warm ascending magical pulse, fantasy healing resurrection cue, no words'),
    ('sheriff', '01', 2.0, 'Heavy wooden gavel strike in a village hall, metal sheriff badge lands on a table with a proud bright ring, short authority cue, no speech, no music'),
    ('sheriff', '02', 2.0, 'Single commanding gavel bang, leather and metal badge buckle clinks, dignified village authority sting, no music, no speech'),
    ('judgement', '01', 2.0, 'Three low tense drum hits followed by a heavy wooden verdict knock, ominous village judgement cue, no music melody, no speech'),
    ('judgement', '02', 2.0, 'Slow heartbeat-like thump, tense silence, final deep gavel impact with dark room echo, judgement vote cue, no speech, no music'),
]

FREE_LIMIT = 10_000
RESERVE = 600
WORST_CASE_NEXT_EFFECT = 160
OUT_DIR = Path('assets/role-sfx')
PACK_PATH = OUT_DIR / 'pack.json'
REPORT_PATH = Path('role-sfx-generation-report.json')


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def usage_credits(key: str) -> float:
    now_ms = int(time.time() * 1000)
    payload = {
        'start_time': now_ms - 32 * 24 * 60 * 60 * 1000,
        'end_time': now_ms,
        'interval_seconds': 86400,
    }
    request = urllib.request.Request(
        'https://api.elevenlabs.io/v1/workspace/analytics/query/usage-by-product-over-time',
        data=json.dumps(payload).encode(),
        headers={'xi-api-key': key, 'content-type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        usage = json.loads(response.read())
    columns = usage.get('columns', [])
    usage_index = columns.index('total_usage')
    return sum(float(row[usage_index] or 0) for row in usage.get('rows', []))


def load_json(path: Path, fallback: dict) -> dict:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def save_state(manifest: dict, report: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PACK_PATH.write_text(json.dumps(manifest, indent=2) + '\n')
    REPORT_PATH.write_text(json.dumps(report, indent=2) + '\n')


def commit_effect(slot: str, variant: str, filename: str) -> None:
    run('git', 'add', f'assets/role-sfx/{filename}', str(PACK_PATH), str(REPORT_PATH))
    run('git', 'commit', '-m', f'Add {slot} role SFX variant {variant}')
    run('git', 'pull', '--rebase', 'origin', 'main')
    run('git', 'push')


def generate_effect(key: str, slot: str, variant: str, seconds: float, prompt: str, final: Path) -> float:
    payload = {
        'text': prompt,
        'duration_seconds': seconds,
        'prompt_influence': 0.55,
        'loop': False,
        'model_id': 'eleven_text_to_sound_v2',
    }
    generated = None
    billed = None
    for attempt in range(1, 6):
        request = urllib.request.Request(
            'https://api.elevenlabs.io/v1/sound-generation',
            data=json.dumps(payload).encode(),
            headers={'xi-api-key': key, 'content-type': 'application/json'},
            method='POST',
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                generated = response.read()
                billed = response.headers.get('character-cost')
            break
        except urllib.error.HTTPError as error:
            body = error.read().decode('utf-8', 'replace')[:400]
            if error.code != 429 or attempt == 5:
                raise RuntimeError(f'{slot}-{variant} failed HTTP {error.code}: {body}') from error
            delay = int(error.headers.get('Retry-After') or attempt * 18)
            print(f'{slot}-{variant}: rate limited; waiting {delay}s before retry {attempt + 1}/5')
            time.sleep(delay)
    if not generated or len(generated) < 800:
        raise RuntimeError(f'{slot}-{variant}: ElevenLabs returned no usable audio')

    with tempfile.TemporaryDirectory() as scratch:
        raw = Path(scratch) / f'{slot}-{variant}.raw.mp3'
        raw.write_bytes(generated)
        run(
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
            '-af', 'highpass=f=45,loudnorm=I=-16:TP=-1.5:LRA=7,alimiter=limit=0.92',
            '-b:a', '80k', str(final),
        )
    return float(billed or WORST_CASE_NEXT_EFFECT)


def main() -> None:
    key = os.environ.get('ELEVENLABS_API_KEY', '')
    if not key:
        raise SystemExit('Repository secret ELEVENLABS_API_KEY is missing')

    run('git', 'config', 'user.name', 'github-actions[bot]')
    run('git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_json(PACK_PATH, {'version': 1, 'variants': {}})
    manifest.setdefault('version', 1)
    manifest.setdefault('variants', {})
    report = load_json(REPORT_PATH, {'items': []})
    report.setdefault('items', [])

    starting_usage = usage_credits(key)
    local_billed = 0.0
    report['credits_before_incremental_run'] = starting_usage
    report['free_limit'] = FREE_LIMIT
    report['reserve'] = RESERVE
    print(f'ElevenLabs usage before incremental run: {starting_usage:.0f}/{FREE_LIMIT}')

    for slot, variant, seconds, prompt in EFFECTS:
        filename = f'{slot}-{variant}.mp3'
        final = OUT_DIR / filename
        existing = manifest['variants'].get(slot, [])
        if filename in existing and final.exists():
            print(f'skip existing {filename}')
            continue

        api_usage = usage_credits(key)
        observed_usage = max(api_usage, starting_usage + local_billed)
        if observed_usage + WORST_CASE_NEXT_EFFECT > FREE_LIMIT - RESERVE:
            print(f'STOP: {observed_usage:.0f} credits observed; keeping {RESERVE} reserve.')
            report['stopped_for_budget'] = True
            report['credits_observed_at_stop'] = observed_usage
            save_state(manifest, report)
            break

        billed = generate_effect(key, slot, variant, seconds, prompt, final)
        local_billed += billed
        manifest['variants'].setdefault(slot, []).append(filename)
        report['items'] = [item for item in report['items'] if not (item.get('slot') == slot and item.get('variant') == variant)]
        report['items'].append({
            'slot': slot,
            'variant': variant,
            'seconds': seconds,
            'character_cost_header': billed,
            'size_bytes': final.stat().st_size,
        })
        report['incremental_billed_headers_total'] = local_billed
        save_state(manifest, report)
        print(f'generated {filename}; billed header={billed:.0f}; committing immediately')
        commit_effect(slot, variant, filename)
        time.sleep(5)

    report['generated_variant_count'] = sum(len(files) for files in manifest['variants'].values())
    report['planned_variant_count'] = len(EFFECTS)
    report['complete'] = report['generated_variant_count'] >= len(EFFECTS)
    save_state(manifest, report)
    print(f"Role SFX pack now contains {report['generated_variant_count']}/{len(EFFECTS)} variants.")


if __name__ == '__main__':
    main()
