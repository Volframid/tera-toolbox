"""Package explicit public files plus an official, checksum-verified runtime."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--runtime', required=True)
parser.add_argument('--output', default='dist')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
distribution = json.loads((root / 'distribution-files.json').read_text('utf-8'))
runtime = json.loads((root / 'runtime.json').read_text('utf-8'))
runtime_path = Path(args.runtime).resolve()
if hashlib.sha256(runtime_path.read_bytes()).hexdigest() != runtime['sha256']:
    raise SystemExit('Official runtime checksum mismatch')
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
name = f"tera-toolbox-graphite-v{distribution['version']}-windows-x64"
archive = output / (name + '.zip')
prefix = name + '/'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as release:
    for file in distribution['files']:
        path = PurePosixPath(file)
        if path.is_absolute() or '..' in path.parts or '\\' in file:
            raise SystemExit('Unsafe public path')
        if any(s in file.lower() for s in ('local_updates', 'user-assets', 'ui-backups', '.jsonl')):
            raise SystemExit('Private path in package')
        release.writestr(prefix + file, (root / file).read_bytes())
    release.writestr(prefix + 'config.json', (root / 'config.example.json').read_bytes())
    with zipfile.ZipFile(runtime_path) as electron:
        names = {i.filename for i in electron.infolist() if not i.is_dir()}
        if not {'electron.exe', 'LICENSE', 'LICENSES.chromium.html'} <= names:
            raise SystemExit('Incomplete official runtime')
        for info in electron.infolist():
            if info.is_dir():
                continue
            path = PurePosixPath(info.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in info.filename:
                raise SystemExit('Unsafe runtime path')
            release.writestr(prefix + 'node_modules/electron/dist/' + info.filename, electron.read(info))
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
checksum = output / (name + '.sha256')
checksum.write_text(f'{digest}  {archive.name}\n', encoding='ascii')
print(json.dumps({'archive': str(archive), 'checksumFile': str(checksum), 'bytes': archive.stat().st_size, 'sha256': digest}, indent=2))
