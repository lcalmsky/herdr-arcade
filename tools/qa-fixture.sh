#!/bin/sh
# Swaps a Herdr home's cards scan for the demo cast in tools/qa-sessions.json, so a QA shot shows
# every group without waiting on real work. --roster points the fixture at the live terminal
# addresses the stage placed; without it the sessions still scan, just with no terminals behind
# them. The original is kept as scan.sh.orig; --restore puts it back. The person's own home
# (~/.config/herdr-app) is refused.
set -eu

usage() {
  echo "usage: $0 <HERDR_APP_HOME> [--restore | --roster <path>]" >&2
  exit 1
}

[ $# -ge 1 ] && [ -n "${1:-}" ] || usage
HOME_DIR=$1
MODE=${2:-}
ROSTER=
if [ "$MODE" = "--roster" ]; then
  [ $# -eq 3 ] && [ -n "${3:-}" ] || usage
  ROSTER=$3
elif [ -n "$MODE" ] && [ "$MODE" != "--restore" ]; then
  usage
fi

HERE=$(cd "$(dirname "$0")" && pwd -P)
SESSIONS="$HERE/qa-sessions.json"
[ -f "$SESSIONS" ] || { echo "missing $SESSIONS" >&2; exit 1; }

real=$(cd "$HOME_DIR" 2>/dev/null && pwd -P) || { echo "no such home: $HOME_DIR" >&2; exit 1; }
personal=$(cd "$HOME/.config/herdr-app" 2>/dev/null && pwd -P) || personal="$HOME/.config/herdr-app"
case "$HOME_DIR" in
  "$HOME/.config/herdr-app"|"$HOME/.config/herdr-app/") personal_match=1 ;;
  *) personal_match=0 ;;
esac
if [ "$personal_match" = 1 ] || [ "$real" = "$personal" ]; then
  echo "refusing the person's Herdr home: $HOME_DIR" >&2
  exit 1
fi

SCAN="$real/mods/arcade-cards/scan.sh"
SESSIONS_COPY="$real/mods/arcade-cards/qa-sessions.json"
ROSTER_COPY="$real/mods/arcade-cards/qa-roster.json"
if [ "$MODE" = "--restore" ]; then
  [ -f "$SCAN.orig" ] || { echo "no scan.sh.orig in $real" >&2; exit 1; }
  mv "$SCAN.orig" "$SCAN"
  chmod +x "$SCAN"
  rm -f "$SESSIONS_COPY" "$ROSTER_COPY"
  echo "restored $SCAN"
  exit 0
fi

[ -f "$SCAN" ] || { echo "no scan.sh in $real — run tools/install.sh first" >&2; exit 1; }
if [ -f "$SCAN.orig" ]; then
  : # the first original stays the one restored
elif grep -q 'qa-fixture scan' "$SCAN" 2>/dev/null; then
  echo "warning: $SCAN is already the fixture and no original is kept" >&2
else
  cp -p "$SCAN" "$SCAN.orig"
fi

if [ -n "$ROSTER" ]; then
  [ -f "$ROSTER" ] || { echo "no roster: $ROSTER" >&2; exit 1; }
  cp "$ROSTER" "$ROSTER_COPY"
else
  rm -f "$ROSTER_COPY"
fi
cp "$SESSIONS" "$SESSIONS_COPY"

cat > "$SCAN" <<'FIXTURE'
#!/bin/sh
# qa-fixture scan: the demo cast from qa-sessions.json beside this script, with terminal ids from
# qa-roster.json when the stage placed them. Times are relative to the run, so the groups stay put
# however long the QA waits.
exec python3 - "$(dirname "$0")" <<'PY'
import json
import os
import sys
import time

here = sys.argv[1]


def read(name):
    try:
        with open(os.path.join(here, name), encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


now = int(time.time() * 1000)
minute = 60 * 1000
demo = os.path.realpath("/tmp/arcade-demo")
spec = read("qa-sessions.json") or {}
roster = read("qa-roster.json") or {}
placed = roster.get("sessions") or {}
fixed_at = roster.get("fixedAt")
sessions = spec.get("sessions") or []


def slug(text):
    return "-".join(str(text).lower().split())


def row_of(item, index, at):
    key = item["key"]
    name = item["name"]
    folder = os.path.join(demo, item["repo"], "%s-%s" % (key, slug(name)))
    spot = placed.get(item["sid"]) or {}
    return {
        "t": "s",
        "pid": 4200 + index,
        "sessionId": item["sid"],
        "cwd": spot.get("cwd") or folder,
        "name": name,
        "kind": "interactive",
        "jobId": None,
        "parkedJobId": None,
        "status": item["status"],
        "waitingFor": None,
        "startedAt": now - 3 * 60 * minute,
        "updatedAt": at,
        "statusUpdatedAt": at,
        "location": name,
        "identity": {"firstPrompt": "%s %s — start the work." % (key, name), "handoff": None},
        "customTitle": name,
        "agentName": "claude-%s" % key.lower().replace("-", ""),
        "lastPrompt": "%s %s — start the work." % (key, name),
        "lastAnswer": item.get("lastAnswer"),
        "lastSentence": item.get("lastSentence"),
        "currentAction": None,
        "lastToolName": "Bash",
        "lastToolAt": at,
        "lastMeaningfulAt": now - int(item.get("meaningfulAgoMs", item.get("agoMs", 0))),
        "pr": None,
        "background": item.get("background") or {"shells": 0, "agents": 0, "monitors": 0, "total": 0},
        "completed": [],
        "deadhd": item.get("deadhd"),
        "pages": [],
        "where": {"kind": "herdr-app", "paneId": None, "socket": None, "handle": None,
                  "terminalId": spot.get("terminalId")},
        "agent": "claude",
    }


rows = []
for index, item in enumerate(sessions):
    at = fixed_at if item.get("fixed") and fixed_at else now - int(item.get("agoMs", 0))
    rows.append(row_of(item, index, at))

for row in rows:
    print(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
print(json.dumps({
    "t": "meta",
    "roots": len({item["repo"] for item in sessions}),
    "updatedAt": now,
    "error": None,
    "pages": [],
    "unreadablePages": [],
    "objectives": {},
}, ensure_ascii=False, separators=(",", ":")))
PY
FIXTURE

chmod +x "$SCAN"
echo "installed the qa fixture at $SCAN (restore with $0 '$HOME_DIR' --restore)"
