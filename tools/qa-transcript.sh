#!/bin/sh
# qa-stage transcript: prints a dense Claude Code-like conversation for one side of the focused
# demo space, then idles so the pane keeps showing it. Wraps to the terminal width and fills its
# height. Usage: qa-transcript.sh <left|right> <title>
set -eu

side=${1:-left}
title=${2:-ABC-1401 Refund rounding}
cols=$(tput cols 2>/dev/null || true)
rows=$(tput lines 2>/dev/null || true)
[ -n "$cols" ] || cols=80
[ -n "$rows" ] || rows=50

exec python3 - "$side" "$title" "$cols" "$rows" <<'PY'
import sys
import time
import unicodedata

side, title, cols, rows = sys.argv[1:5]
cols = max(40, int(cols or 80))
rows = max(12, int(rows or 50))

ESC = "\x1b"


def rgb(r, g, b):
    return "%s[38;2;%d;%d;%dm" % (ESC, r, g, b)


BODY = rgb(241, 240, 255)
BLUE = rgb(122, 162, 247)
GREY = rgb(139, 139, 158)
ORANGE = rgb(255, 158, 100)
GREEN = rgb(158, 206, 106)
RED = rgb(247, 118, 142)
PINK = rgb(255, 65, 180)
CYAN = rgb(125, 207, 255)
DIM = rgb(96, 96, 115)
BOLD = ESC + "[1m"
OFF = ESC + "[0m"


def cells_of(spans):
    cells = []
    for text, style in spans:
        for ch in text:
            if unicodedata.combining(ch):
                if cells:
                    cells[-1][0] += ch
                else:
                    cells.append([ch, style, 0])
                continue
            wide = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
            cells.append([ch, style, wide])
    return cells


def leading(cells):
    count = 0
    for ch, _style, wide in cells:
        if ch != " ":
            break
        count += wide
    if count == 0 and len(cells) > 1 and cells[0][0] in "•●✻◆" and cells[1][0] == " ":
        count = 2
    return min(count, cols // 3)


def wrap(spans):
    cells = cells_of(spans)
    indent = leading(cells)
    lines = []
    current = []
    used = 0
    space_at = None
    index = 0
    while index < len(cells):
        ch, _style, wide = cells[index]
        if used + wide > cols:
            if ch != " " and space_at is not None and space_at > indent:
                carry = current[space_at + 1:]
                lines.append(current[:space_at])
                current = [[" ", OFF, 1] for _ in range(indent)]
                used = indent
                space_at = None
                for carry_cell in carry:
                    current.append(carry_cell)
                    used += carry_cell[2]
                    if carry_cell[0] == " ":
                        space_at = len(current) - 1
                continue
            lines.append(current)
            current = [[" ", OFF, 1] for _ in range(indent)]
            used = indent
            space_at = None
            if ch == " ":
                index += 1
            continue
        current.append(cells[index])
        used += wide
        if ch == " ":
            space_at = len(current) - 1
        index += 1
    lines.append(current)
    return [[(ch, style) for ch, style, _wide in line] for line in lines]


def render(line):
    return "".join(style + text for text, style in line) + OFF


body = []


def add(*spans):
    body.append(list(spans))


def blank():
    body.append([])


def bullet(text, color=BLUE):
    add(("• ", color), (text, BODY))


def result(text):
    body.append([("  ", BODY), ("⎿  ", GREY), (text, GREY)])


def note(text, color=GREY):
    add((text, color))


def prose(text, color=BODY):
    add(("  " + text, color))


def message(text):
    add(("• ", BODY), (text, BODY))


def diff_add(number, code):
    add(("  " + number + "  ", DIM), ("+ ", GREEN), (code, GREEN))


def diff_del(number, code):
    add(("  " + number + "  ", DIM), ("- ", RED), (code, RED))


if side == "right":
    state = "blocked"
    bullet('Background command "export ledger snapshot" finished (exit 0)')
    result("Wrote /work/api/tmp/ledger-2026-11-11.json (18.4 MB)")
    result("Compared 412,908 rows against the source snapshot")
    blank()
    message("Reviewing the export path. Three findings, each independent:")
    blank()
    add(("1. ", BLUE), ("Duplicate rows on retry — src/export/ledger.ts:118", BODY))
    prose("The retry loop re-reads the cursor after a lost acknowledgement,")
    prose("so a batch can be appended twice. Guard it with the batch id,")
    prose("not the cursor, before the next append.")
    blank()
    add(("2. ", BLUE), ("Timezone drift — src/export/snapshot.ts:64", BODY))
    prose("Day buckets are built in local time, but the reader expects UTC.")
    prose("One hour of rows lands in the wrong partition near midnight.")
    blank()
    add(("3. ", BLUE), ("Missing null check — src/export/format.ts:203", BODY))
    prose("`account.currency` is null for archived accounts, and the")
    prose("formatter throws before the row is written.")
    blank()
    bullet('Read src/export/ledger.ts')
    result("Read 268 lines (ctrl+r to expand)")
    bullet('Read src/export/snapshot.ts')
    result("Read 184 lines (ctrl+r to expand)")
    bullet('Read src/export/format.ts')
    result("Read 97 lines (ctrl+r to expand)")
    bullet('Read src/export/ledger.test.ts')
    result("Read 212 lines (ctrl+r to expand)")
    bullet('Grep "batchId" src/export')
    result("Found 7 matches in 3 files")
    add(("     ", DIM), ("src/export/ledger.ts:118     ", DIM), ("if (seen.has(batchId)) return;", GREY))
    add(("     ", DIM), ("src/export/ledger.ts:141      ", DIM), ("seen.set(fingerprint, batch.id);", GREY))
    add(("     ", DIM), ("src/export/ledger.test.ts:73  ", DIM), ('it("appends a batch once", ...)', GREY))
    blank()
    bullet('Bash "cat /work/api/tmp/ledger-2026-11-11.json | wc -l"')
    result("412908")
    bullet('Bash git log --oneline -5 src/export')
    result("5 commits")
    add(("     ", DIM), ("4f2c1a9 Add ledger export retry", GREY))
    add(("     ", DIM), ("9b7d3e2 Split snapshot writer from exporter", GREY))
    add(("     ", DIM), ("c81e004 Bucket export rows by UTC day", GREY))
    blank()
    bullet('Read docs/export/runbook.md')
    result("Read 58 lines (ctrl+r to expand)")
    result("Step 4: a retry must carry the same batch id")
    result("Retries are expected to be idempotent")
    bullet('Bash npm test -- ledger')
    result("Running 31 tests…")
    add(("     ", BODY), ("✓ 31 passed", GREEN), (" (8.1s)", GREY))
    blank()
    message("31 ledger tests pass, but none of them retry a batch after")
    prose("a lost acknowledgement; the duplicate path stays uncovered.")
    blank()
    bullet('Bash git status --short')
    result("M src/export/ledger.ts")
    blank()
    note("Review 6 files, ran 3 shell commands")
    blank()
    add(("✻ ", ORANGE), ("Thinking… (1m 44s · ↓ 1.8k tokens)", ORANGE))
    blank()
    message("Summarised the review: three independent defects, each with")
    prose("a file and line, and no changes applied. The duplicate-row")
    prose("fix is the one that affects today totals, so it goes first.")
    blank()
    message("Should I apply all three, or start with the duplicate rows only?")
    blank()
    add(("Waiting for your answer. ", BODY), ("esc", GREY), (" to interrupt", GREY))
    blank()
    session = "api-ABC-1402"
    status = [
        [("⎇ ", BLUE), ("feat/ABC-1402", GREEN), (" │ ", DIM), ("ram 21/48G 44%", BODY)],
        [("◆ ", BODY), ("Opus", BODY), (" │ ", DIM), ("◷ 1h 06m  18.2M tok", BODY),
         (" │ ", DIM), ("$12.40", GREEN)],
        [("▦ ", BODY), ("ctx 16%", BODY), (" │ ", DIM), ("cache → 16:44", BODY)],
        [("▸▸ ", DIM), ("bypass permissions on · 1 monitor", DIM)],
    ]
else:
    state = "working"
    bullet('Read src/api/refunds.ts')
    result("Read 214 lines (ctrl+r to expand)")
    bullet('Read src/api/refunds.test.ts')
    result("Read 166 lines (ctrl+r to expand)")
    bullet('Grep "round" src/api')
    result("Found 12 matches in 4 files")
    add(("     ", DIM), ("src/api/refunds.ts:31    ", DIM), ("lines.reduce((sum, l) => ...", GREY))
    add(("     ", DIM), ("src/api/refunds.ts:52    ", DIM), ("return roundCents(total) / 100;", GREY))
    add(("     ", DIM), ("src/api/money.ts:12      ", DIM), ("function roundCents(cents)", GREY))
    add(("     ", DIM), ("src/api/refunds.test.ts:88 ", DIM), ("rounds a three-way split once", GREY))
    blank()
    note("Read 1 file, ran 2 shell commands")
    blank()
    add(("✻ ", ORANGE), ("Thinking… (3m 12s · ↓ 2.1k tokens)", ORANGE))
    blank()
    message("Each refund line is rounded to cents before the lines are")
    prose("summed, so three $0.005 refunds become 0.01 + 0.01 + 0.01")
    prose("instead of 0.02. I will sum in integer cents and round once")
    prose("at the boundary, which keeps the split and the total")
    prose("consistent for every currency with 2 decimals.")
    blank()
    prose("The rounding helper in money.ts already works in integer")
    prose("cents, and refunds is the only caller that rounds per line.")
    prose("One Update is enough.")
    blank()
    add(("● ", ORANGE), ("Update", BOLD), ("(", BODY), ("src/api/refunds.ts", CYAN), (")", BODY))
    result("Updated src/api/refunds.ts with 6 additions and 2 removals")
    diff_del("31", "const cents = lines.map((line) =>")
    diff_del("32", "  Math.round(line.amount * 100));")
    diff_del("33", "return cents.reduce((sum, value) => sum + value, 0) / 100;")
    diff_add("31", "const cents = lines.reduce(")
    diff_add("32", "  (sum, line) => sum + Math.round(line.amount * 100), 0);")
    diff_add("33", "return roundCents(cents) / 100;")
    blank()
    bullet('Bash npm test -- refunds')
    result("Running 48 tests…")
    add(("     ", BODY), ("✓ 48 passed", GREEN), (" (12.4s)", GREY))
    blank()
    message("All 48 refund tests pass. The three-way split now returns")
    prose("0.02 for three $0.005 lines, and the property test covers")
    prose("10,000 random splits.")
    blank()
    bullet('Bash git diff --stat')
    result("2 files changed, 14 insertions(+), 6 deletions(-)")
    add(("     ", DIM), ("src/api/refunds.ts       | 12 +++++-----", GREY))
    add(("     ", DIM), ("src/api/refunds.test.ts  |  8 ++++++++", GREY))
    blank()
    bullet('Read skills/api-check/SKILL.md')
    result("Read 84 lines (ctrl+r to expand)")
    blank()
    note("Read 3 files, ran 4 shell commands")
    blank()
    message("Summarised the change: refunds now sum in cents and round")
    prose("once at the boundary. The new test covers the three-way")
    prose("split and the property test covers random splits. No public")
    prose("API changes.")
    blank()
    bullet('Background command "refund property test" finished (exit 0)')
    result("Ran 1 file, 1 shell command")
    blank()
    add(("• ", BLUE), ("Agent \"reviewer\" finished · 2m 16s", BODY))
    result("No further findings in src/api/money.ts")
    blank()
    message("ABC-1401 is fixed. The PR is ready to open when you want it.")
    blank()
    session = "api-ABC-1401"
    status = [
        [("⎇ ", BLUE), ("feat/ABC-1401", GREEN), (" │ ", DIM), ("ram 19/48G 39%", BODY)],
        [("◆ ", BODY), ("Opus", BODY), (" │ ", DIM), ("◷ 42m  12.4M tok", BODY),
         (" │ ", DIM), ("$8.20", GREEN)],
        [("▦ ", BODY), ("ctx 13%", BODY), (" │ ", DIM), ("cache → 16:43", BODY)],
        [("▸▸ ", DIM), ("bypass permissions on · 1 shell", DIM)],
    ]

physical = []
for line in body:
    physical.extend(wrap(line))

name = " " + session + " "
rule_width = max(0, cols - sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1 for ch in name) - 1)
tail = [[("─" * rule_width, DIM), (name, BODY), ("─", DIM)]]
tail.append([])
tail.append([("❯ ", BODY), ("█", PINK)])
tail.append([])
for line in status:
    tail.extend(wrap(line))

pad = rows - len(physical) - len(tail)
if pad > 0:
    physical.extend([[] for _ in range(pad)])

out = [ESC + "]2;" + title + "\x07" + ESC + "]7501;state=" + state + "\x07" + ESC + "[2J" + ESC + "[H"]
for line in physical + tail:
    out.append(render(line))
sys.stdout.write("\n".join(out) + "\n")
sys.stdout.flush()
time.sleep(86400)
PY
