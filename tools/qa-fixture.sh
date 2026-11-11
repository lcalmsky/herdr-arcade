#!/bin/sh
# Swaps a Herdr home's cards scan for a fixed cast of nine sessions, so a QA shot shows every
# group without waiting on real work. The original is kept as scan.sh.orig; --restore puts it
# back. The person's own home (~/.config/herdr-app) is refused.
set -eu

usage() {
  echo "usage: $0 <HERDR_APP_HOME> [--restore]" >&2
  exit 1
}

[ $# -ge 1 ] && [ -n "${1:-}" ] || usage
HOME_DIR=$1
MODE=${2:-}
if [ -n "$MODE" ] && [ "$MODE" != "--restore" ]; then usage; fi

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
if [ "$MODE" = "--restore" ]; then
  [ -f "$SCAN.orig" ] || { echo "no scan.sh.orig in $real" >&2; exit 1; }
  mv "$SCAN.orig" "$SCAN"
  chmod +x "$SCAN"
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

cat > "$SCAN" <<'FIXTURE'
#!/bin/sh
# qa-fixture scan: nine fixed sessions in the real scan.sh's line format. Times are relative
# to the run, so the groups stay put however long the QA waits.
exec python3 - <<'PY'
import json
import time

now = int(time.time() * 1000)
minute = 60 * 1000


def session(sid, key, name, status, ago, **extra):
    started = now - 3 * 60 * minute
    status_at = now - ago
    row = {
        "t": "s",
        "pid": 4100 + len(sid),
        "sessionId": sid,
        "cwd": "/Users/dev/git-repo/api-cserver-%s" % key,
        "name": name,
        "kind": "interactive",
        "jobId": None,
        "parkedJobId": None,
        "status": status,
        "waitingFor": None,
        "startedAt": started,
        "updatedAt": status_at,
        "statusUpdatedAt": status_at,
        "location": name,
        "identity": {"firstPrompt": "%s %s — start the work." % (key, name), "handoff": None},
        "customTitle": name,
        "agentName": "claude-%s" % key.lower(),
        "lastPrompt": "%s %s — start the work." % (key, name),
        "lastAnswer": "%s — wrapping up, will report." % name,
        "lastSentence": "%s — checking the flow." % name,
        "currentAction": None,
        "lastToolName": "Bash",
        "lastToolAt": status_at,
        "lastMeaningfulAt": status_at,
        "pr": None,
        "background": {"shells": 0, "agents": 0, "monitors": 0, "total": 0},
        "completed": [],
        "deadhd": None,
        "pages": [],
        "where": {"kind": "herdr-app", "paneId": "pane-%s" % key.lower(), "socket": None, "handle": None, "terminalId": "term-%s" % key.lower()},
        "agent": "claude",
    }
    row.update(extra)
    return row


rows = []
rows.append(session("qa-needs-1", "ABC-0001", "Deploy approval", "waiting", 42 * 1000, lastAnswer="ABC-0001 prod rollout — shall I proceed?"))
rows.append(session("qa-needs-2", "ABC-0002", "Refund policy", "waiting", 2 * minute, lastAnswer="ABC-0002 OK to delete the test fixture?"))
rows.append(session("qa-stall", "ABC-0003", "로그 파서", "busy", 20 * minute,
                    lastMeaningfulAt=now - 20 * minute, lastSentence="ABC-0003 출력이 20분째 없음."))
rows.append(session("qa-work-1", "ABC-0004", "Search ranking", "busy", 6 * minute,
                    lastMeaningfulAt=now - 10 * 1000, lastSentence="ABC-0004 index rebuild 3/7.",
                    deadhd={
                        "counts": {"done": 3, "now": 1, "blocked": 0, "left": 3},
                        "total": 7,
                        "items": [
                            {"state": "done", "label": "Check schema", "sub": None},
                            {"state": "done", "label": "Build index", "sub": None},
                            {"state": "done", "label": "Compare ranking", "sub": None},
                            {"state": "now", "label": "Tune weights", "sub": "Running"},
                            {"state": "left", "label": "Deploy", "sub": None},
                            {"state": "left", "label": "Check metrics", "sub": None},
                            {"state": "left", "label": "Write docs", "sub": None},
                        ],
                        "nowLabel": "Tune weights",
                        "states": ["done", "done", "done", "now", "left", "left", "left"],
                        "dataAt": now - 30 * 1000,
                        "off": False,
                    }))
rows.append(session("qa-work-2", "ABC-0005", "Onboarding form", "busy", 12 * minute,
                    lastMeaningfulAt=now - 20 * 1000, lastSentence="ABC-0005 writing component tests.",
                    background={"shells": 2, "agents": 0, "monitors": 0, "total": 2}))
rows.append(session("qa-work-3", "ABC-0006", "Cache invalidation", "busy", 3 * minute,
                    lastMeaningfulAt=now - 5 * 1000, lastSentence="ABC-0006 rebuilding cache keys."))
rows.append(session("qa-done-1", "ABC-0007", "Alert cleanup", "idle", 5 * minute,
                    lastAnswer="ABC-0007 alert rules cleaned up. PR #412 is up."))
rows.append(session("qa-done-2", "ABC-0008", "Onboarding docs", "idle", 32 * minute,
                    lastAnswer="ABC-0008 onboarding docs are in order."))
rows.append(session("qa-viewed", "ABC-0009", "릴리스 노트", "idle", 3 * 60 * minute,
                    lastAnswer="ABC-0009 릴리스 노트를 올렸어."))

for row in rows:
    print(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
print(json.dumps({
    "t": "meta",
    "roots": 2,
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
