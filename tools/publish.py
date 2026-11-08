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
FEED_ASSET_NAME = "info.json"   # the feed is also shipped as a release asset

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
    ap.add_argument("--replace-release", action="store_true",
                    help="deliberately re-cut an existing tag (replaces its asset AND notes)")
    args = ap.parse_args()

    code, name = read_version()
    if not args.no_bump:
        code, name = bump(code, name, args.bump)
    VERSION_FILE.write_text(f"versionCode={code}\nversionName={name}\n")
    print(f"publishing v{name} (versionCode {code})")

    # Guard: versionCode must strictly increase. If the live feed already
    # advertises this version or higher, an update would be a silent no-op and
    # every installed app would sit on "up to date" forever. This is what a
    # stale android/version.properties copied over the bumped one causes — so
    # fail loudly here instead of publishing something nobody can install.
    if not args.dry_run and not (args.replace_release or args.no_bump):
        try:
            # Read the RELEASE-ASSET feed first: the raw.githubusercontent copy lags
            # by up to 5 minutes, and a stale reading weakens this guard (it would
            # compare against an older versionCode and let a non-advancing publish
            # through). Fall back to the repo copy only if the asset is unreachable.
            live = None
            for _src in (
                f"https://github.com/{OWNER}/{REPO}/releases/latest/download/info.json",
                f"https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}"
                f"/update/info.json?t={int(time.time())}",
            ):
                try:
                    with urllib.request.urlopen(_src, timeout=30) as r:
                        live = json.load(r)
                    if live:
                        break
                except Exception:                               # noqa: BLE001
                    continue
            if live is None:
                raise RuntimeError("no feed reachable")
            live_code = int(live.get("versionCode", 0))
            if live_code >= code:
                sys.exit(f"refusing to publish: the live feed is already at "
                         f"versionCode {live_code} (v{live.get('versionName')}) and this build is "
                         f"{code} (v{name}). versionCode MUST increase or no app will update.\n"
                         f"Check android/version.properties was not overwritten by a stale copy.")
            print(f"  live feed is at versionCode {live_code} — ok to publish {code}")
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            print("  no live feed yet — first release")
        except SystemExit:
            raise
        except Exception as e:                                  # noqa: BLE001
            print(f"  (could not read the live feed to compare versions: {e})")

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
    body = "\n".join("- " + n for n in feed["notes"])

    # Never silently reuse a tag: replacing an asset under an existing tag leaves
    # the release body describing different content, and the app sees no update
    # because the versionCode never moved.
    try:
        existing = api("GET", f"/repos/{OWNER}/{REPO}/releases/tags/{tag}")
    except RuntimeError:
        existing = None
    if existing and not args.replace_release:
        sys.exit(f"release {tag} already exists — refusing to overwrite it.\n"
                 f"Bump the version (android/version.properties) or pass "
                 f"--replace-release to re-cut this tag deliberately.")

    if existing:
        print(f"re-cutting release {tag} (notes and asset replaced)…")
        rel = api("PATCH", f"/repos/{OWNER}/{REPO}/releases/{existing['id']}",
                  {"name": f"Iron Ledger {tag}", "body": body,
                   "draft": False, "prerelease": False})
    else:
        print(f"creating release {tag}…")
        rel = api("POST", f"/repos/{OWNER}/{REPO}/releases", {
            "tag_name": tag,
            "name": f"Iron Ledger {tag}",
            "body": body,
            "draft": False,
            "prerelease": False,
        })

    # Replace every asset this publish is about to (re)upload. info.json matters
    # as much as the APK: uploading an asset name that already exists fails with
    # 422 already_exists, and because the failure lands AFTER the release body was
    # patched, a re-cut would silently keep the OLD feed live while appearing to
    # have succeeded.
    for asset in rel.get("assets", []):
        if asset["name"] in (ASSET_NAME, FEED_ASSET_NAME):
            print(f"  removing previous asset {asset['name']}")
            api("DELETE", f"/repos/{OWNER}/{REPO}/releases/assets/{asset['id']}")

    print("uploading APK asset…")
    upload = rel["upload_url"].split("{")[0]
    api("POST", upload + f"?name={ASSET_NAME}", raw=APK.read_bytes(),
        content_type="application/vnd.android.package-archive")

    # Also publish the feed as a release asset. The app prefers
    # releases/latest/download/info.json because it is fresh by construction,
    # whereas raw.githubusercontent.com serves through a CDN with a 5-minute TTL
    # that is not keyed on the query string — long enough for a freshly published
    # release to still read as "up to date".
    print("uploading feed asset…")
    api("POST", upload + f"?name={FEED_ASSET_NAME}",
        raw=(json.dumps(feed, indent=2) + "\n").encode(), content_type="application/json")

    # the feed goes live only once the asset it points at really exists
    FEED_FILE.parent.mkdir(parents=True, exist_ok=True)
    FEED_FILE.write_text(json.dumps(feed, indent=2) + "\n")
    print("committing feed…")
    # Stage the SOURCE that produced this APK, not just the feed and the version.
    # It used to stage only info.json + version.properties, so a real code change
    # would be compiled into a release, published, and left uncommitted — the
    # shipped binary and the repo disagreeing silently.
    #
    # Plain `git add -A`. .gitignore already covers every build output (www/,
    # node_modules/, android/.gradle/, android/app/src/main/assets/public/), so
    # nothing regenerated can be committed. An earlier attempt to ALSO exclude
    # them with :! pathspecs made git try to add the ignored paths anyway and
    # exit 1 — killing the commit, on a release that was already live.
    #
    # This runs after the release is published, so a failure here must never look
    # like a failed release: warn loudly and carry on.
    try:
        run(["git", "add", "-A"])
        run(["git", "-c", "user.email=hermes@local", "-c", "user.name=Hermes",
             "commit", "-m", f"Release {tag}: {'; '.join(feed['notes'])}"])
        run(["git", "push", "origin", f"HEAD:{BRANCH}"])
        left = run(["git", "status", "--porcelain"])
        if left.strip():
            print("  WARNING: source still uncommitted after this release:")
            for line in left.strip().splitlines()[:10]:
                print("    " + line)
    except SystemExit as e:
        print("\n  !!  The release IS published, but its source was NOT committed.")
        print(f"  !!  {e}")
        print("  !!  Fix by hand:  git add -A && git commit && git push origin HEAD:%s" % BRANCH)
        try:
            for line in run(["git", "status", "--porcelain"]).strip().splitlines()[:10]:
                print("    " + line)
        except SystemExit:
            pass

    print(f"\npublished {tag}")
    print(f"  feed : https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/update/info.json")
    print(f"  apk  : {apk_url}")


if __name__ == "__main__":
    main()
