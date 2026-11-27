"""Brand-name guard: the product is «هامزیار» and its AI assistant is «هوشیار».

Fails when an off-brand spelling (همیار، هامشیار، همشیار، HumsyarX، Hamsyar …)
or a ZWNJ-split form («هوش‌یار»، «هام‌زیار») creeps back into tracked source.
Lines that only *warn* against the wrong names (e.g. «هرگز همشیار») are allowed.
"""
import io
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ZW = "\u200c"

FORBIDDEN = [
    ("هم" + ZW + "یار", "همیار → هامزیار"),
    ("همیار", "همیار → هامزیار"),
    ("هامشیار", "هامشیار → هامزیار"),
    ("همشیار", "همشیار → هامزیار"),
    ("هام" + ZW + "زیار", "هام‌زیار → هامزیار"),
    ("هوش" + ZW + "یار", "هوش‌یار → هوشیار"),
    ("HumsyarX", "HumsyarX → هامزیار / Humsyar"),
    ("HamzyarX", "HamzyarX → Humsyar"),
    ("Hamsyar", "Hamsyar → Humsyar"),
]
# A line that names the wrong spelling only to forbid it is fine.
ALLOW_LINE = re.compile(r"هرگز|نه همشیار|never", re.I)
SKIP = re.compile(
    r"(/dist/|/dist-landing/|node_modules|\.min\.js$|\.lock$|package-lock\.json$"
    r"|\.(png|jpe?g|webp|avif|gif|ico|svg|woff2?|ttf|pdf|mp3|mp4)$"
    r"|^tests/test_brand_consistency\.py$|^docs/|^\.agents/|CHANGELOG\.md$)"
)


def _tracked_files():
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
    ).stdout
    return [f for f in out.splitlines() if f and not SKIP.search(f)]


def test_no_off_brand_names_in_source():
    problems = []
    for rel in _tracked_files():
        try:
            text = io.open(ROOT / rel, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if ALLOW_LINE.search(line):
                continue
            for needle, hint in FORBIDDEN:
                if needle in line:
                    problems.append(f"{rel}:{lineno}: {hint}")
    assert not problems, "Off-brand names found:\n" + "\n".join(problems[:50])


def test_manifests_use_brand():
    for rel in (
        "apps/student/public/manifest.webmanifest",
        "miniapp/public/manifest.webmanifest",
        "miniapp/public-pwa/manifest.webmanifest",
    ):
        text = io.open(ROOT / rel, encoding="utf-8").read()
        assert '"short_name": "هامزیار"' in text, rel
