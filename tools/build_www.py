#!/usr/bin/env python3
"""Assemble the web assets that ship inside the APK.

Only runtime files are copied. Source tooling, the raw wger dump, tests and
node_modules deliberately stay out of the bundle.

The app version is INJECTED into the copied js/welcome.js from
android/version.properties (versionName). It is DISPLAY ONLY: the walkthrough's
once-only arming is keyed on a separate, hand-kept content revision
(welcome.js's WELCOME_VERSION), not on the release version, so shipping a new
release does not re-show the tour. The injection still matters because a
hand-kept APP_VERSION constant drifts (it sat at "1.0.0" for many releases, so
the number the tour showed stopped matching the build); the build fails loudly
if the anchor line is gone. WELCOME_VERSION is deliberately NOT injected — it is
bumped by hand, and only when the tour's own pages/copy change.
"""
import re
import shutil
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
www = root / "www"
VERSION_FILE = root / "android/version.properties"

# The exact line welcome.js must carry for injection to be possible.
APP_VERSION_RE = re.compile(r'const APP_VERSION = "[^"]*"')


def read_version_name(version_file=VERSION_FILE):
    """versionName from android/version.properties, or a loud failure."""
    try:
        text = pathlib.Path(version_file).read_text()
    except OSError as e:
        raise SystemExit(f"FATAL: cannot read {version_file}: {e}") from None
    for line in text.splitlines():
        if line.strip().startswith("versionName"):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"FATAL: no versionName line in {version_file}")


def inject_version(js_text, version):
    """Replace welcome.js's APP_VERSION with the real release version.

    Fails loudly when the anchor is missing: silently keeping a stale constant is
    the exact drift this exists to prevent, so it must never be a no-op.
    """
    injected, n = APP_VERSION_RE.subn(f'const APP_VERSION = "{version}"', js_text, count=1)
    if n != 1:
        raise SystemExit(
            'FATAL: could not inject APP_VERSION into js/welcome.js — the anchor '
            '`const APP_VERSION = "..."` was not found. The walkthrough version '
            'would drift from the release, so the build is refused.'
        )
    return injected


def build():
    version = read_version_name()

    if www.exists():
        shutil.rmtree(www)
    www.mkdir()

    for f in ("index.html", "manifest.webmanifest"):
        shutil.copy2(root / f, www / f)

    # `img/` carries runtime sprites the page loads relative to itself — the
    # header harness (js/hero.js) fetches `img/hero-sheet.png`. It is copied
    # like css/js/fonts/icons; anything the app needs at runtime must be here,
    # or the asset ships nowhere and the harness silently stays inert.
    for d in ("css", "js", "fonts", "icons", "img"):
        shutil.copytree(root / d, www / d)

    # Inject the real version into the COPIED bundle only; the source stays a
    # placeholder so the VM tests read js/welcome.js unchanged.
    welcome = www / "js" / "welcome.js"
    welcome.write_text(inject_version(welcome.read_text(), version))
    if f'const APP_VERSION = "{version}"' not in welcome.read_text():
        raise SystemExit("FATAL: APP_VERSION injection did not land in www/js/welcome.js")
    print(f"  injected APP_VERSION = {version} -> www/js/welcome.js")

    files = [p for p in www.rglob("*") if p.is_file()]
    total = sum(p.stat().st_size for p in files)
    print(f"www/ built: {len(files)} files, {total/1024:.0f} KB")
    for p in sorted(files):
        print(f"  {p.relative_to(root)}  {p.stat().st_size/1024:.1f} KB")


if __name__ == "__main__":
    build()
