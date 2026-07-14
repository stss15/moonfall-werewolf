import importlib.util
import shutil
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    'moonfall_role_sfx', Path('scripts/generate_role_sfx_incremental.py')
)
role_sfx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(role_sfx)

original_run = role_sfx.run


def run_without_ffmpeg(*args: str) -> None:
    if args and args[0] == 'ffmpeg':
        input_path = Path(args[args.index('-i') + 1])
        output_path = Path(args[-1])
        shutil.copyfile(input_path, output_path)
        return
    original_run(*args)


role_sfx.run = run_without_ffmpeg
role_sfx.main()
