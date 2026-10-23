"""Create a deterministic, whitelist-checked Bilibili Toy ZIP (Python 3 stdlib)."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'artifacts/toy/dist'
OUTPUT = ROOT / 'artifacts/toy/iron-cage-toy.zip'
# https://www.bilibili.com/toy/publish/guide/faq (checked 2026-10-24)
ALLOWED = set('.html .htm .css .js .json .wasm .data .md .csv .tsv .png .jpg .jpeg .gif .svg .webp .ico .woff2 .woff .ttf .eot .mp3 .wav .ogg .m4a .mp4 .webm .atlas .ani .part .nani .unityweb'.split())
MAX_BYTES = 50_000_000  # conservative decimal 50 MB


def validate(files):
    if 'index.html' not in files:
        raise ValueError('ZIP root requires index.html')
    for name, data in files.items():
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name:
            raise ValueError(f'Unsafe path: {name}')
        if path.suffix.lower() not in ALLOWED:
            raise ValueError(f'Toy will filter this extension: {name}')
        if path.suffix.lower() not in {'.html', '.css', '.js'}:
            continue
        text = data.decode('utf8')
        # Actual HTML resources, CSS URLs and runtime icon paths must resolve
        # from the uploaded folder, never from the Toy website root.
        refs = re.findall(r'(?:src|href)=[\"\x27]([^\"\x27]+)', text) if path.suffix == '.html' else []
        refs += re.findall(r'url\([\"\x27]?([^\"\x27)]+)', text) if path.suffix == '.css' else []
        refs += re.findall(r'[\"\x27](\.?/?icons/[^\"\x27]+)[\"\x27]', text)
        for ref in refs:
            if ref.startswith('data:') or ref.startswith('#'):
                continue
            if ref.startswith('/') or re.match(r'^[a-zA-Z]+:', ref):
                raise ValueError(f'Non-relative resource in {name}: {ref}')
            base = PurePosixPath('.') if path.suffix == '.js' else path.parent
            target = (base / ref.split('?')[0].split('#')[0]).as_posix()
            target = re.sub(r'(^|/)\./', r'\1', target)
            if target not in files:
                raise ValueError(f'Missing resource in {name}: {ref}')
        if path.suffix == '.html' and 'fonts.googleapis.com' in text:
            raise ValueError('Toy must work without external fonts')
    if sum(map(len, files.values())) > MAX_BYTES:
        raise ValueError('Uncompressed package exceeds 50 MB')


def package():
    files = {p.relative_to(DIST).as_posix(): p.read_bytes() for p in DIST.rglob('*') if p.is_file()}
    # Preserve the code and bundled Three.js notices in supported .md files.
    for name, source in {'LICENSE.md': ROOT / 'LICENSE', 'ASSETS.md': ROOT / 'ASSETS.md',
                         'THREE-LICENSE.md': ROOT / 'node_modules/three/LICENSE'}.items():
        files[name] = source.read_bytes()
    validate(files)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compresslevel=9)
    raw = OUTPUT.read_bytes()
    if len(raw) > MAX_BYTES:
        OUTPUT.unlink()
        raise ValueError('ZIP exceeds 50 MB')
    manifest = {'zip': str(OUTPUT), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                'files': len(files), 'uncompressedBytes': sum(map(len, files.values()))}
    OUTPUT.with_suffix('.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    package()
