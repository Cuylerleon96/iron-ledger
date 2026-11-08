#!/usr/bin/env python3
"""Create the public repo and point the local clone at it.

Run on the build host. The remote URL embeds the token so `git push` works
non-interactively; .git/config is never committed, so it cannot leak into the
public repo. The token is never printed.
"""
import json
import pathlib
import re
import subprocess
import urllib.error
import urllib.request

OWNER, REPO = "Cuylerleon96", "iron-ledger"
ROOT = pathlib.Path.home() / "Projects/fitness-app"

tok = re.search(r"oauth_token:\s*(\S+)",
                (pathlib.Path.home() / ".config/gh/hosts.yml").read_text()).group(1)


def api(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request("https://api.github.com" + path, data=body, method=method)
    req.add_header("Authorization", "token " + tok)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "iron-ledger-setup")
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        return {"_status": e.code, "_body": e.read().decode(errors="replace")[:300]}


r = api("GET", f"/repos/{OWNER}/{REPO}")
if r.get("_status") == 404:
    print("repo missing — creating public repo…")
    r = api("POST", "/user/repos", {
        "name": REPO,
        "description": "A gamified workout tracker with game-style stat charts. Local-first Android app.",
        "private": False, "has_issues": True, "has_wiki": False,
    })
print("repo        :", r.get("full_name"), "| private:", r.get("private"), "| status:", r.get("_status", 200))
if r.get("_status"):
    print("  detail:", r.get("_body"))
    raise SystemExit(1)

subprocess.run(["git", "remote", "remove", "origin"], cwd=str(ROOT), capture_output=True)
subprocess.run(["git", "remote", "add", "origin",
                f"https://{OWNER}:{tok}@github.com/{OWNER}/{REPO}.git"],
               cwd=str(ROOT), check=True)
print("remote 'origin' configured (URL not printed — it carries the token)")
