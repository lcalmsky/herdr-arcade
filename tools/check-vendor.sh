#!/bin/sh
# Checks that the copies tools/vendor.sh wrote from herdr-shared are byte-identical to it and kept
# their exec bit. Skips when herdr-shared is not checked out, since a public checkout has no copy
# to compare against.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
SHARED=${HERDR_SHARED:-$HOME/git-repo/herdr-shared}

if [ ! -d "$SHARED" ]; then
  echo "check-vendor.sh: no herdr-shared at $SHARED; skipping the drift check" >&2
  exit 0
fi

status=0
count=0
while read -r source target; do
  [ -n "$source" ] || continue
  count=$((count + 1))
  if ! cmp -s "$SHARED/$source" "$REPO/$target"; then
    printf 'check-vendor.sh: %s differs from %s; run herdr-shared tools/vendor.sh\n' "$target" "$source" >&2
    status=1
    continue
  fi
  if [ -x "$SHARED/$source" ] && [ ! -x "$REPO/$target" ]; then
    printf 'check-vendor.sh: %s lost its exec bit\n' "$target" >&2
    status=1
  elif [ ! -x "$SHARED/$source" ] && [ -x "$REPO/$target" ]; then
    printf 'check-vendor.sh: %s gained an exec bit\n' "$target" >&2
    status=1
  fi
done <<'PAIRS'
bin/cca mods/arcade-accounts/cca
bin/usage-tap.sh mods/arcade-accounts/usage-tap.sh
bin/usage-api.mjs mods/arcade-accounts/usage-api.mjs
bin/codex-usage.mjs mods/arcade-accounts/codex-usage.mjs
bin/models.mjs mods/arcade-accounts/models.mjs
bin/scan.sh mods/arcade-cards/scan.sh
bin/hv mods/arcade-editor/hv
bin/hv-open mods/arcade-editor/hv-open
tools/herdr-open/build.sh tools/herdr-open/build.sh
tools/herdr-open/open.applescript tools/herdr-open/open.applescript
tools/herdr-open/set-default.swift tools/herdr-open/set-default.swift
PAIRS

[ "$status" -eq 0 ] || exit "$status"
echo "check-vendor.sh: $count vendored files match herdr-shared"
