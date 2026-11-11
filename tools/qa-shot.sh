#!/bin/sh
# One QA capture of the arcade: restarts the tmux session, launches the app against
# HERDR_APP_HOME, minimizes it, then takes two shots ten seconds apart and crops the card
# strip and the scene. `herdr-app shot` reads the app's own frame, so a covered or minimized
# window still captures. Exits 2 when the screen is locked, a display is off, or the two
# shots are byte-identical (a frozen frame).
set -eu

usage() {
  echo "usage: $0 <HERDR_APP_HOME> <HC_SESSION> <out-prefix>" >&2
  exit 1
}

[ $# -eq 3 ] || usage
HOME_DIR=$1
SESSION=$2
# The session name is also the terminal core's HC_SESSION, so the QA app never attaches to the real sessions.
export HC_SESSION="$SESSION"
OUT=$3
PYTHON=${PYTHON:-/opt/homebrew/bin/python3.14}

# tmux runs the app against this home; the layout in that home decides what the shots show.
tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -c "$HOME_DIR" "HC_SESSION='$SESSION' HERDR_APP_HOME='$HOME_DIR' exec herdr-app"

# status answers only once the window has drawn its first frame.
tries=0
until HERDR_APP_HOME="$HOME_DIR" herdr-app status >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    echo "herdr-app did not answer status within 60 s" >&2
    exit 1
  fi
  sleep 1
done

HERDR_APP_HOME="$HOME_DIR" herdr-app do window.minimize >/dev/null 2>&1 || true

sleep 10
HERDR_APP_HOME="$HOME_DIR" herdr-app shot "$OUT-10s.png" >/dev/null
sleep 10
HERDR_APP_HOME="$HOME_DIR" herdr-app shot "$OUT-20s.png" >/dev/null

"$PYTHON" - "$OUT" <<'PY'
from PIL import Image
import sys
out = sys.argv[1]
for tag in ("10s", "20s"):
    image = Image.open("%s-%s.png" % (out, tag))
    image.crop((0, 0, 3360, 760)).save("%s-%s-top.png" % (out, tag))
    image.crop((2220, 150, 3360, 710)).save("%s-%s-scene.png" % (out, tag))
PY

status=0
if cmp -s "$OUT-10s.png" "$OUT-20s.png"; then
  echo "warning: the two shots are byte-identical — the frame is frozen" >&2
  status=2
fi
if ioreg -n Root -d1 2>/dev/null | grep -q 'CGSSessionScreenIsLocked"=Yes'; then
  echo "warning: the screen is locked" >&2
  status=2
fi
if pmset -g log 2>/dev/null | grep -E 'Display is turned (on|off)' | tail -1 | grep -q 'turned off'; then
  echo "warning: the display is off" >&2
  status=2
fi
exit "$status"
