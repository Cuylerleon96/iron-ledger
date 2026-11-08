#!/usr/bin/env bash
# Sync the working tree to the Android build host.
#
# ALWAYS use this instead of hand-rolling an rsync. The build host OWNS two files
# that must not be overwritten from the source machine:
#
#   android/version.properties   publish.py bumps this on the host. Syncing a
#                                stale copy over it makes publish.py compute the
#                                same versionCode again, reuse the existing tag,
#                                and publish an update that no installed app can
#                                ever see (the version never moved).
#   android/keystore.properties  the signing secret — host-local, never shipped
#
# Build outputs and node_modules are derived, so they stay behind too.
set -euo pipefail

HOST="${1:-gaming-pc}"
DEST="${2:-~/Projects/fitness-app/}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rsync -a \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='www' \
  --exclude='android/app/build' \
  --exclude='android/build' \
  --exclude='android/.gradle' \
  --exclude='android/local.properties' \
  --exclude='android/app/src/main/assets/public' \
  --exclude='android/keystore.properties' \
  --exclude='android/version.properties' \
  "$DIR/" "$HOST:$DEST"

echo "synced $(basename "$DIR") -> $HOST:$DEST"
echo "  (version.properties and keystore.properties deliberately left to the build host)"
