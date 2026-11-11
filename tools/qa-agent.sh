#!/bin/sh
# One demo player's terminal: names itself and reports a fixed agent status to the core, then stays
# live so the rail has a face and a mood to draw. Usage: qa-agent.sh <status> <title>
set -eu

status=${1:-working}
title=${2:-Demo session}
esc=$(printf '\033')

printf '%s]2;%s\a' "$esc" "$title"
while :; do
  printf '%s]7501;state=%s\a' "$esc" "$status"
  sleep 20
done
