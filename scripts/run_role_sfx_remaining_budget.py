import importlib.util
import subprocess
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    'moonfall_role_sfx', Path('scripts/generate_role_sfx_incremental.py')
)
role_sfx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(role_sfx)

priority = [
    ('wolves', '01'),
    ('death', '01'),
    ('revive', '01'),
    ('cupid', '01'),
    ('little-girl', '01'),
    ('witch', '01'),
    ('seer', '01'),
    ('thief', '01'),
    ('hunter', '01'),
    ('lovers', '01'),
    ('sheriff', '01'),
    ('judgement', '01'),
    ('wolves', '02'),
    ('cupid', '02'),
    ('little-girl', '02'),
    ('witch', '02'),
    ('death', '02'),
    ('revive', '02'),
    ('seer', '02'),
    ('thief', '02'),
    ('hunter', '02'),
    ('lovers', '02'),
    ('sheriff', '02'),
    ('judgement', '02'),
    ('wolves', '03'),
    ('cupid', '03'),
    ('little-girl', '03'),
    ('witch', '03'),
    ('death', '03'),
    ('revive', '03'),
]
rank = {key: index for index, key in enumerate(priority)}
role_sfx.EFFECTS = sorted(role_sfx.EFFECTS, key=lambda item: rank[(item[0], item[1])])
role_sfx.RESERVE = 0
role_sfx.WORST_CASE_NEXT_EFFECT = 160

role_sfx.main()

# main() commits every successful MP3 immediately. Commit its final budget/pack
# state as well, including the useful case where no more generation is affordable.
subprocess.run(['git', 'add', str(role_sfx.PACK_PATH), str(role_sfx.REPORT_PATH)], check=True)
changed = subprocess.run(['git', 'diff', '--cached', '--quiet']).returncode != 0
if changed:
    subprocess.run(['git', 'commit', '-m', 'Record final free-tier role SFX budget state'], check=True)
    subprocess.run(['git', 'pull', '--rebase', 'origin', 'main'], check=True)
    subprocess.run(['git', 'push'], check=True)
