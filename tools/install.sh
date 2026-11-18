#!/bin/sh
# Copies the layout, theme and this repo's mods into the Herdr home, then checks each mod.
# The character images are built already and ship in the mods; tools/make-sprites.py rebuilds them.
set -eu
REPO=$(cd "$(dirname "$0")/.." && pwd)
HOME_DIR=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
SHARED=${HERDR_SHARED:-$REPO/vendor/herdr-shared}
SHARED_HOME=${HERDR_SHARED_HOME:-$HOME/.local/share/herdr-shared}
# The layout and keys merges below and the cards' scan.sh run python3: stop before copying anything.
command -v python3 >/dev/null 2>&1 || {
  printf 'install.sh: python3 is required (the layout and key merges and mods/arcade-cards/scan.sh use it)\n' >&2
  exit 1
}
for mod in arcade-cards arcade-scene arcade-rail arcade-accounts arcade-tabs arcade-pane arcade-editor; do
  mkdir -p "$HOME_DIR/mods/$mod"
  # The copy below must write real files: a link into the shared home from the last install
  # would be written through. The link step at the end puts the links back.
  find "$HOME_DIR/mods/$mod" -maxdepth 1 -type l -lname "$SHARED_HOME/*" -exec rm -f {} +
  cp -R "$REPO/mods/$mod/." "$HOME_DIR/mods/$mod/"
done
chmod +x "$HOME_DIR/mods/arcade-accounts/cca" "$HOME_DIR/mods/arcade-accounts/usage-tap.sh"
chmod +x "$HOME_DIR/mods/arcade-editor/hv" "$HOME_DIR/mods/arcade-editor/hv-open"
# With herdr-shared installed, the runtime files it carries link to its shared home; otherwise the
# copies above stay and a public install still works.
REPO_REAL=$(cd "$REPO" && pwd -P)
if [ -f "$SHARED/tools/link-installed.sh" ] && [ -d "$SHARED_HOME" ]; then
  installed=
  for mod in arcade-accounts arcade-cards arcade-editor; do
    dir=$(cd "$HOME_DIR/mods/$mod" 2>/dev/null && pwd -P) || continue
    case "$dir" in
      "$REPO_REAL"|"$REPO_REAL"/*) continue ;;
    esac
    installed="$installed $HOME_DIR/mods/$mod"
  done
  [ -z "$installed" ] || sh "$SHARED/tools/link-installed.sh" $installed
fi
mkdir -p "$HOME_DIR/layouts" "$HOME_DIR/themes"
cp "$REPO/layouts/arcade.json" "$REPO/layouts/arcade.png" "$HOME_DIR/layouts/"
cp "$REPO/themes/arcade.json" "$HOME_DIR/themes/"
# Private values (Jira/Slack hosts, repo names, ticket prefixes) stay out of the repo in
# $HOME_DIR/arcade.local.json as {"<mod id>": {"<prop>": <value>}}; they are merged into that mod's props.
python3 - "$HOME_DIR/arcade.local.json" "$HOME_DIR/layouts/arcade.json" <<'PY'
import json, os, sys
local, dst = sys.argv[1], sys.argv[2]
if os.path.exists(local):
    extra, layout = json.load(open(local)), json.load(open(dst))
    def walk(node):
        if isinstance(node, dict):
            if node.get("mod") in extra:
                node.setdefault("props", {}).update(extra[node["mod"]])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
    walk(layout)
    json.dump(layout, open(dst, "w"), ensure_ascii=False, indent=2)
PY
for mod in arcade-cards arcade-scene arcade-rail arcade-accounts arcade-tabs arcade-pane arcade-editor; do herdr-app check "$HOME_DIR/mods/$mod"; done
# Herdr reads layout shortcuts only from keys.json, so the arcade section is merged in there.
python3 - "$REPO/layouts/arcade.keys.json" "$HOME_DIR/keys.json" <<'PY'
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
keys = json.load(open(dst)) if os.path.exists(dst) else {}
keys["layout:arcade"] = json.load(open(src))
json.dump(keys, open(dst, "w"), ensure_ascii=False, indent=2)
PY
