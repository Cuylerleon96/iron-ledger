#!/usr/bin/env python3
"""Verify the GitHub credential on the build host without ever printing it.

Reads the token from ~/.config/gh/hosts.yml and asks the API who it belongs to,
reporting scopes from the response header so we know whether it can create a
repo and cut releases.
"""
import json
import pathlib
import re
import urllib.request

cfg = pathlib.Path.home() / ".config/gh/hosts.yml"
if not cfg.exists():
    raise SystemExit("no ~/.config/gh/hosts.yml on this host")
tok = re.search(r"oauth_token:\s*(\S+)", cfg.read_text()).group(1)

req = urllib.request.Request(
    "https://api.github.com/user",
    headers={"Authorization": "token " + tok, "User-Agent": "iron-ledger-setup"},
)
with urllib.request.urlopen(req, timeout=30) as r:
    scopes = r.headers.get("X-OAuth-Scopes", "(none reported)")
    accepted = r.headers.get("X-Accepted-OAuth-Scopes", "")
    data = json.load(r)

print("login        :", data.get("login"))
print("name         :", data.get("name"))
print("public_repos :", data.get("public_repos"))
print("token_scopes :", scopes)
print("accepted     :", accepted)


def can(scope):
    have = [s.strip() for s in scopes.split(",") if s.strip()]
    return "repo" in have or scope in have


print("can create repo :", can("public_repo") or "repo" in scopes)
print("classic PAT 'repo' scope is needed to create a repo and upload release assets")
