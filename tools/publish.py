#!/usr/bin/env python3
"""Publish an Iron Ledger release: build -> sign -> GitHub release -> update feed.

MUST run on the build host. The homelab cannot reach github.com or
api.github.com (its route to them is blackholed), only the release CDN.

    python3 tools/publish.py --notes "Fixed the muscle legend collision" \
                             --notes "Log defaults to today's date" \
                             [--bump patch|minor|major] [--dry-run]

Order matters: the release + APK asset are created BEFORE the feed is committed.
The app reads the feed from the main branch, so committing a feed that points at
a release which does not exist yet would offer an update that cannot download.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

OWNER = "Cuylerleon96"
REPO = "iron-ledger"
BRANCH = "main"
ASSET_NAME = "iron-ledger.apk"

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "android/version.properties"
FEED_FILE = ROOT / "update/info.json"
APK = ROOT / "android/app/build/outputs/apk/release/app-release.apk"


def token():
    cfg = pathlib.Path.home() / ".config/gh/hosts.yml"
    if not cfg.exists():
        sys.exit("no ~/.config/gh/hosts.yml — cannot authenticate to GitHub")
    m = re.search(r"oauth_token:\s*(\S+)", cfg.read_text())
    if not m:
        sys.exit("no oauth_token in ~/.config/gh/hosts.yml")
    return m.group(1)


TOKEN = token()


def api(method, path, data=None, raw=None, content_type="application/json"):
    url = path if path.startswith("http") else "https://api.github.com" + path
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", "token " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "iron-ledger-publish")
    if body is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            txt = r.read()
            return json.loads(txt) if txt else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:400]
        raise RuntimeError(f"{method} {url} -> {e.code}: {detail}") from None


def read_version():
    props = {}
    for line in VERSION_FILE.read_text().splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            props[k.strip()] = v.strip()
    return int(props.get("versionCode", 1)), props.get("versionName", "1.0.0")


def bump(code, name, kind):
    major, minor, patch = (name.split(".") + ["0", "0"])[:3]
    major, minor, patch = int(major), int(minor), int(patch)
    if kind == "major":
        major, minor, patch = major + 1, 0, 0
    elif kind == "minor":
        minor, patch = minor + 1, 0
    else:
        patch += 1
    return code + 1, f"{major}.{minor}.{patch}"


def run(cmd, **kw):
    print("  $", " ".join(cmd) if isinstance(cmd, list) else cmd, flush=True)
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, **kw)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        print(r.stderr[-3000:])
        raise SystemExit(f"command failed ({r.returncode})")
    return r.stdout


def ensure_repo():
    try:
        api("GET", f"/repos/{OWNER}/{REPO}")
        print("  repo exists")
        return
    except RuntimeError as e:
        if "-> 404" not in str(e):
            raise
    print("  creating public repo…")
    api("POST", "/user/repos", {
        "name": REPO,
        "description": "A gamified workout tracker with game-style stat charts. Local-first Android app.",
        "private": False,
        "has_issues": True,
        "has_wiki": False,
    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--notes", action="append", default=[], help="release note line (repeatable)")
    ap.add_argument("--bump", choices=["patch", "minor", "major"], default="patch")
    ap.add_argument("--dry-run", action="store_true", help="build and stage, do not publish")
    ap.add_argument("--no-bump", action="store_true", help="keep the current version")
    args = ap.parse_args()

    code, name = read_version()
    if not args.no_bump:
        code, name = bump(code, name, args.bump)
    VERSION_FILE.write_text(f"versionCode={code}\nversionName={name}\n")
    print(f"publishing v{name} (versionCode {code})")

    print("building web bundle…")
    run(["python3", "tools/build_www.py"])
    run(["npx", "cap", "sync", "android"])
    print("building release APK…")
    run("./gradlew assembleRelease --no-daemon", cwd=str(ROOT / "android"))
    if not APK.exists():
        sys.exit("release APK not produced (is keystore.properties present?)")

    digest = hashlib.sha256(APK.read_bytes()).hexdigest()
    size = APK.stat().st_size
    print(f"  apk {size/1048576:.2f} MB  sha256 {digest[:16]}…")

    apk_url = f"https://github.com/{OWNER}/{REPO}/releases/latest/download/{ASSET_NAME}"
    feed = {
        "versionCode": code,
        "versionName": name,
        "apkUrl": apk_url,
        "sha256": digest,
        "sizeBytes": size,
        "published": time.strftime("%Y-%m-%d"),
        "notes": args.notes or ["Update"],
    }

    if args.dry_run:
        print("\n--dry-run: would publish")
        print(json.dumps(feed, indent=2))
        return

    ensure_repo()

    tag = f"v{name}"
    print(f"creating release {tag}…")
    try:
        rel = api("POST", f"/repos/{OWNER}/{REPO}/releases", {
            "tag_name": tag,
            "name": f"Iron Ledger {tag}",
            "body": "\n".join("- " + n for n in feed["notes"]),
            "draft": False,
            "prerelease": False,
        })
    except RuntimeError as e:
        if "-> 422" in str(e):
            print("  release already exists, reusing it")
            rel = api("GET", f"/repos/{OWNER}/{REPO}/releases/tags/{tag}")
        else:
            raise

    # replace any existing asset with the same name
    for asset in rel.get("assets", []):
        if asset["name"] == ASSET_NAME:
            print("  removing previous asset")
            api("DELETE", f"/repos/{OWNER}/{REPO}/releases/assets/{asset['id']}")

    print("uploading APK asset…")
    upload = rel["upload_url"].split("{")[0] + f"?name={ASSET_NAME}"
    api("POST", upload, raw=APK.read_bytes(),
        content_type="application/vnd.android.package-archive")

    # the feed goes live only once the asset it points at really exists
    FEED_FILE.parent.mkdir(parents=True, exist_ok=True)
    FEED_FILE.write_text(json.dumps(feed, indent=2) + "\n")
    print("committing feed…")
    run(["git", "add", "update/info.json", "android/version.properties"])
    run(["git", "-c", "user.email=hermes@local", "-c", "user.name=Hermes",
         "commit", "-m", f"Release {tag}: {'; '.join(feed['notes'])}"])
    run(["git", "push", "origin", f"HEAD:{BRANCH}"])

    print(f"\npublished {tag}")
    print(f"  feed : https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/update/info.json")
    print(f"  apk  : {apk_url}")


if __name__ == "__main__":
    main()
