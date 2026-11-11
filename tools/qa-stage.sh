#!/bin/sh
# Stages the gallery preview's demo workday in an isolated Herdr home: demo git repositories,
# live agent terminals behind the card fixture, the space document the rail groups, the CREDIT
# accounts fake and two Claude Code-like transcripts in the focused space's split panes. It never touches a window:
# the lead launches the app and captures. Everything it creates is under /tmp/arcade-demo, and
# every core call carries HC_SESSION. --restore puts the swapped files and the space document back.
#
# usage: qa-stage.sh <HERDR_APP_HOME> <HC_SESSION> [--restore]
set -eu

usage() {
  echo "usage: $0 <HERDR_APP_HOME> <HC_SESSION> [--restore]" >&2
  exit 1
}

[ $# -ge 2 ] && [ -n "${1:-}" ] && [ -n "${2:-}" ] || usage
HOME_DIR=$1
HC_SESSION=$2
MODE=${3:-}
if [ -n "$MODE" ] && [ "$MODE" != "--restore" ]; then usage; fi
if [ "$HC_SESSION" = "default" ]; then
  echo "refusing the person's default core session" >&2
  exit 1
fi

REPO=$(cd "$(dirname "$0")/.." && pwd -P)
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
[ -f "$REPO/tools/qa-sessions.json" ] || { echo "missing tools/qa-sessions.json" >&2; exit 1; }
[ -f "$REPO/tools/qa-cca.sh" ] || { echo "missing tools/qa-cca.sh" >&2; exit 1; }

python3 - "$REPO" "$real" "$HC_SESSION" "$MODE" <<'PY'
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

repo, home, session, mode = sys.argv[1:5]
demo = os.path.realpath("/tmp/arcade-demo")
roster_path = os.path.join(demo, "roster.json")
backup_doc = os.path.join(demo, "doc.before.json")
backup_store = os.path.join(demo, "store.before.json")
store_path = os.path.join(home, "data", "arcade-cards", "store.json")
view_path = os.path.join(home, "view.json")
cca_target = os.path.join(home, "mods", "arcade-accounts", "cca")
# The arcade layout draws a split pane at about 68x74 cells in the demo window, but the core
# starts every background terminal at 80x24, so the transcripts are told the pane's size.
TRANSCRIPT_COLS = "68"
TRANSCRIPT_ROWS = "74"
cca_orig = cca_target + ".orig"
hc = shutil.which("hc")
if not hc:
    sys.exit("hc not found on PATH")

env = dict(os.environ, HC_SESSION=session, HERDR_APP_HOME=home)
sessions = json.load(open(os.path.join(repo, "tools", "qa-sessions.json"), encoding="utf-8"))["sessions"]


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def run(args, **kwargs):
    return subprocess.run(args, env=env, capture_output=True, text=True, **kwargs)


def rpc(method, params, soft=False):
    request = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}) + "\n"
    result = run([hc, "connect", "--json"], input=request)
    for line in reversed(result.stdout.strip().splitlines()):
        try:
            value = json.loads(line)
        except Exception:
            continue
        if "result" in value:
            return value["result"]
        if "error" in value:
            if soft:
                return value["error"]
            fail("%s failed: %s" % (method, value["error"]))
    fail("%s got no answer from the core: %s" % (method, result.stderr.strip()))


def get_doc():
    result = rpc("doc.get", {"name": "herdr-app"})
    return result.get("value") or {"spaces": []}, int(result.get("version") or 0)


def set_doc(value, version):
    result = rpc("doc.set", {"name": "herdr-app", "value": value, "version": version}, soft=True)
    return result


# The rail moves spaces while the app is open, so the document version can change between the
# read and the write; read it again and retry.
def set_doc_retry(value, attempts=30):
    error = None
    for _ in range(attempts):
        _, version = get_doc()
        result = set_doc(value, version)
        if isinstance(result, dict) and "version" in result:
            return
        error = result
        if not (isinstance(result, dict) and result.get("kind") == "conflict"):
            break
        time.sleep(0.15)
    fail("the space document could not be written: %s" % (error,))


def slug(text):
    return "-".join(str(text).lower().split())


def session_dir(item):
    return os.path.join(demo, item["repo"], "%s-%s" % (item["key"], slug(item["name"])))


def ids_for(sid):
    digest = hashlib.sha1(("qa-stage:" + sid).encode()).hexdigest()
    return "sp" + digest[:32], "tb" + digest[:32], "p" + digest[:32]


def first_terminal(space):
    stack = []
    for tab in space.get("tabs") or []:
        stack.append(tab.get("root"))
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        content = node.get("content") or {}
        if content.get("terminal"):
            return content["terminal"]
        stack.extend(node.get("children") or [])
    return None


def block(terminal, pane_id):
    return {"content": {"terminal": terminal}, "id": pane_id, "type": "block"}


def space_from(space_id, tab_id, panes, folder, name):
    return {"folder": folder, "id": space_id, "name": name,
            "tabs": [{"id": tab_id, "name": "", "root": {"children": [block(terminal, pane_id)
                                                                     for terminal, pane_id in panes],
                                                         "id": tab_id, "type": "row"}}]}


def hc_terminals():
    result = run([hc, "ls", "--json"])
    if result.returncode != 0:
        fail("hc ls failed: " + result.stderr.strip())
    return json.loads(result.stdout).get("terminals") or []


def hc_get(address):
    result = run([hc, "get", address, "--json"])
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except Exception:
        return None


def kill_demo_terminals():
    for terminal in hc_terminals():
        name = str(terminal.get("name") or "")
        if not name.startswith("qa-demo-"):
            continue
        run([hc, "kill", terminal["address"]])
        run([hc, "rm", terminal["address"]])


SHELLS = {"sh", "bash", "zsh", "fish", "dash", "ksh"}


def wait_for_shell(address, seconds=15):
    deadline = time.time() + seconds
    while time.time() < deadline:
        terminal = hc_get(address)
        name = str((terminal or {}).get("foreground", {}).get("name") or "")
        if name in SHELLS:
            return True
        time.sleep(0.5)
    return False


def start_transcript(address, folder, side, title):
    # The transcript ends in `sleep`, which swallows the stop key, so end it with Ctrl-C.
    run([hc, "keys", address, "ctrl+c"])
    if not wait_for_shell(address):
        fail("%s did not return to a shell for the transcript" % address)
    command = "cd %s && COLUMNS=%s LINES=%s exec sh %s %s %s" % (
        shell_quote(folder), TRANSCRIPT_COLS, TRANSCRIPT_ROWS,
        shell_quote(os.path.join(repo, "tools", "qa-transcript.sh")),
        shell_quote(side), shell_quote(title))
    run([hc, "send", address, command])


def shell_quote(text):
    return "'" + str(text).replace("'", "'\\''") + "'"


def run_agent(item, space_id, tab_id, folder):
    address = None
    command = [hc, "run", "--bg", "--keep", "--no-parent", "--json",
               "--name", "qa-demo-" + item["key"].lower(),
               "--cwd", folder,
               "--label", "herdr.space=" + space_id,
               "--label", "herdr.tab=" + tab_id,
               "--label", "herdr.seen=0",
               "--label", "where=" + item["repo"],
               "--", "sh", os.path.join(repo, "tools", "qa-agent.sh"),
               item.get("agent", "working"), "%s %s" % (item["key"], item["name"])]
    result = run(command)
    if result.returncode != 0:
        fail("hc run failed for %s: %s" % (item["sid"], result.stderr.strip() or result.stdout.strip()))
    try:
        address = json.loads(result.stdout.strip().splitlines()[-1]).get("address")
    except Exception:
        fail("hc run gave no address for %s" % item["sid"])
    return address


def run_transcript(item, space_id, tab_id, folder, side, title):
    command = [hc, "run", "--bg", "--keep", "--no-parent", "--json",
               "--name", "qa-demo-" + item["key"].lower(),
               "--cwd", folder,
               "--label", "herdr.space=" + space_id,
               "--label", "herdr.tab=" + tab_id,
               "--label", "herdr.seen=0",
               "--label", "where=" + item["repo"],
               "--", "env", "COLUMNS=" + TRANSCRIPT_COLS, "LINES=" + TRANSCRIPT_ROWS,
               "sh", os.path.join(repo, "tools", "qa-transcript.sh"), side, title]
    result = run(command)
    if result.returncode != 0:
        fail("hc run failed for the %s transcript: %s" % (side, result.stderr.strip() or result.stdout.strip()))
    try:
        return json.loads(result.stdout.strip().splitlines()[-1]).get("address")
    except Exception:
        fail("hc run gave no address for the %s transcript" % side)


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=1)
        handle.write("\n")


def restore():
    result = run(["sh", os.path.join(repo, "tools", "qa-fixture.sh"), home, "--restore"])
    if result.returncode != 0 and "no scan.sh.orig" not in result.stderr:
        fail(result.stderr.strip())
    if os.path.exists(cca_orig):
        shutil.move(cca_orig, cca_target)
        os.chmod(cca_target, 0o755)
        print("restored " + cca_target)
    if os.path.exists(backup_store):
        shutil.copyfile(backup_store, store_path)
        os.remove(backup_store)
        print("restored " + store_path)
    if os.path.exists(backup_doc):
        value = read_json(backup_doc, None)
        if value is not None:
            set_doc_retry(value)
            print("restored the space document")
        os.remove(backup_doc)
    if os.path.exists(roster_path):
        for spot in (read_json(roster_path, {}) or {}).get("sessions", {}).values():
            run([hc, "keys", spot.get("terminalId", ""), "ctrl+c"])
    kill_demo_terminals()
    for name in (roster_path,):
        if os.path.exists(name):
            os.remove(name)
    print("qa stage restored")


if mode == "--restore":
    restore()
    sys.exit(0)

os.makedirs(demo, exist_ok=True)
for repo_name in sorted({item["repo"] for item in sessions}):
    root = os.path.join(demo, repo_name)
    os.makedirs(root, exist_ok=True)
    if not os.path.isdir(os.path.join(root, ".git")):
        git = subprocess.run(["git", "-C", root, "init", "-q"], capture_output=True, text=True)
        if git.returncode != 0:
            fail("git init failed in %s: %s" % (root, git.stderr.strip()))
for item in sessions:
    os.makedirs(session_dir(item), exist_ok=True)

current_doc, _ = get_doc()
if not os.path.exists(backup_doc):
    write_json(backup_doc, current_doc)
original = read_json(backup_doc, current_doc)
original_spaces = original.get("spaces") or []
if not original_spaces:
    fail("the core has no spaces to anchor the demo on")

active_id = read_json(view_path, {}).get("active")
anchor = next((space for space in original_spaces if space.get("id") == active_id), original_spaces[0])
anchor_terminal = first_terminal(anchor)
anchor_tab = (anchor.get("tabs") or [{}])[0].get("id")

kill_demo_terminals()

# The anchor space keeps the ids the window already has selected, so the transcripts land in the
# focused panes the moment the lead launches the app. A session marked `"split": "right"` shares
# the anchor tab as a second pane instead of getting a space of its own.
first = sessions[0]
first_title = "%s %s" % (first["key"], first["name"])
split_item = next((item for item in sessions if item.get("split") == "right"), None)
if split_item is not None and split_item["sid"] == first["sid"]:
    fail("the first session cannot also be the right pane")
if anchor_terminal and hc_get(anchor_terminal):
    start_transcript(anchor_terminal, session_dir(first), "left", first_title)
    anchor_space_id, anchor_tab_id = anchor["id"], anchor_tab
    anchor_pane = None
    for tab in anchor.get("tabs") or []:
        if tab.get("id") == anchor_tab:
            stack = [tab.get("root")]
            while stack:
                node = stack.pop()
                if not isinstance(node, dict):
                    continue
                content = node.get("content") or {}
                if content.get("terminal") == anchor_terminal:
                    anchor_pane = node.get("id")
                    break
                stack.extend(node.get("children") or [])
else:
    anchor_space_id, anchor_tab_id, anchor_pane = ids_for(first["sid"])
    anchor_terminal = run_transcript(first, anchor_space_id, anchor_tab_id, session_dir(first), "left", first_title)

anchor_panes = [(anchor_terminal, anchor_pane or "p" + hashlib.sha1(anchor_space_id.encode()).hexdigest()[:32])]
placed = {first["sid"]: {"cwd": session_dir(first), "terminalId": anchor_terminal}}
if split_item:
    split_title = "%s %s" % (split_item["key"], split_item["name"])
    split_terminal = run_transcript(split_item, anchor_space_id, anchor_tab_id, session_dir(split_item),
                                    "right", split_title)
    anchor_panes.append((split_terminal, ids_for(split_item["sid"])[2]))
    placed[split_item["sid"]] = {"cwd": session_dir(split_item), "terminalId": split_terminal}

# The document is already grouped by repository, so the rail's own space.move reconciliation has
# nothing to do and cannot race the write.
repo_order = {name: index for index, name in enumerate(sorted({item["repo"] for item in sessions}))}
ordered = [first] + sorted(sessions[1:], key=lambda item: (repo_order[item["repo"]], sessions.index(item)))
spaces = [space_from(anchor_space_id, anchor_tab_id, anchor_panes, session_dir(first), first_title)]

for item in ordered[1:]:
    if split_item and item["sid"] == split_item["sid"]:
        continue
    space_id, tab_id, pane_id = ids_for(item["sid"])
    folder = session_dir(item)
    address = run_agent(item, space_id, tab_id, folder)
    placed[item["sid"]] = {"cwd": folder, "terminalId": address}
    spaces.append(space_from(space_id, tab_id, [(address, pane_id)], folder,
                             "%s %s" % (item["key"], item["name"])))

set_doc_retry({"spaces": spaces})
written, _ = get_doc()
if len(written.get("spaces") or []) != len(spaces):
    fail("the space document did not take: wrote %d, read %d" % (len(spaces), len(written.get("spaces") or [])))

fixed_item = next((item for item in sessions if item.get("fixed")), None)
fixed_at = int(time.time() * 1000) - int(fixed_item.get("agoMs", 0)) if fixed_item else None
write_json(roster_path, {"fixedAt": fixed_at, "sessions": placed})

result = run(["sh", os.path.join(repo, "tools", "qa-fixture.sh"), home, "--roster", roster_path])
if result.returncode != 0:
    fail("qa-fixture failed: " + result.stderr.strip())
print(result.stdout.strip())

if os.path.exists(cca_target) and not os.path.exists(cca_orig):
    with open(cca_target, encoding="utf-8", errors="replace") as handle:
        already_fake = "qa-stage fake cca" in handle.read()
    if not already_fake:
        shutil.copyfile(cca_target, cca_orig)
        os.chmod(cca_orig, 0o755)
shutil.copyfile(os.path.join(repo, "tools", "qa-cca.sh"), cca_target)
os.chmod(cca_target, 0o755)
print("installed the CREDIT accounts fake at " + cca_target)

if fixed_item:
    if not os.path.exists(backup_store):
        os.makedirs(os.path.dirname(store_path), exist_ok=True)
        shutil.copyfile(store_path, backup_store) if os.path.exists(store_path) else write_json(backup_store, {})
    store = read_json(store_path, {})
    ack = "%s+%d" % (fixed_item["sid"], fixed_at // 1000)
    store["pulse.viewed"] = json.dumps([ack])
    write_json(store_path, store)
    print("marked %s viewed" % fixed_item["sid"])

print("staged %d demo sessions across %d repositories in %s" % (len(sessions), len({item["repo"] for item in sessions}), demo))
print("capture: tools/qa-shot.sh %s %s /tmp/arcade-qa" % (home, session))
PY
