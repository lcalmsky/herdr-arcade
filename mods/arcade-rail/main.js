// The space rail, faces first: each row leads with the Arcade faces of the agents in it (the
// same character as their card, ringed in their status colour) and then its name, ticket key
// first, as the cards print it (arcade-cards publishes its places through shared()).
// Spaces cut from one git repository sit under a heading with the repository's name; the
// Slack space opens into one row per thread tab. A narrow rail keeps one large face and
// a short label per row. A hollow ring by a row means a shell there has sat at its prompt for 10 min.
// props().role "buttons" draws the CREDIT panel's coin slot (a new space) and its settings button.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, terminals, panes, exec, run, openOverlay, props, shared } from "herdr";

const INK = { rail: "#251b47", card: "#251b47", raised: "#191035", shown: "#31265a", hover: "#31265a", line: "#483e74", shownLine: "#f9d54488", sep: "#483e74", t1: "#f1f0ff", t2: "#d0cdea", amber: "#f9d544", focus: "#f9d544" };
const FACE = { blocked: "#ff41b4", working: "#3adaf2", done: "#f9d544", idle: "#483e74" };
const IDLE_MS = 10 * 60 * 1000;
const REPO_MS = 30 * 1000;
const FOCUS_WATCH_MS = 100;
const CHARS = ["kid", "robot", "cat", "oldman", "frog", "punk"];
const NAME_FONT = "Galmuri11";
const DISPLAY = "Galmuri14";
// RAIL_MAX is the rail's "max" in layouts/arcade.json; change both together. From
// WIDE_W up a row has room for its faces and its name side by side.
export const RAIL_MAX = 200;
export const WIDE_W = 120;
// Mirrors arcade-cards: uppercase Jira-style keys by default, or only the layout's `ticketPrefixes`,
// matched case-insensitively, so a space named `abc-1408-ai` is ABC-1408 only when its prefix is listed.
function spaceKeyRe(prefixes = []) {
  const list = (Array.isArray(prefixes) ? prefixes : []).map((prefix) => String(prefix).trim()).filter(Boolean);
  if (!list.length) return /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-\d{1,5})(?![0-9])/;
  const any = list.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?:^|[^A-Za-z0-9])((?:${any})-\\d{1,5})(?![0-9])`, "i");
}
const SLACK_SESSIONS = "/.claude/state/bot-sessions/sessions/";
const KEY_DIGITS = /^[A-Z][A-Z0-9]*-(\d+)$/;

function charFor(key) {
  let h = 0x811c9dc5;
  for (const ch of String(key ?? "")) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return CHARS[h % CHARS.length];
}

// Where a terminal's program runs now; the recorded cwd is only where the terminal opened.
const REPOS_KEY = "arcade-rail.repos";

function loadRepos() {
  try {
    const raw = JSON.parse(localStorage.getItem(REPOS_KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function saveRepos(repos) {
  try { localStorage.setItem(REPOS_KEY, JSON.stringify(repos)); } catch {}
}

export function cwdOf(t) {
  return t?.foreground?.cwd || t?.cwd || null;
}

function agentName(a) {
  const live = String(a.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (live && !/^[~/]/.test(live) && !live.includes("@") && live !== a.program?.name) return live;
  return a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : a.program?.name ?? a.address;
}

// A space's crew row: its agents (blocked, working, done, idle, then address), at most 3
// faces (2 when a shell chip also needs the room) and how many shell-only terminals it has.
export function crewOf(spaceId, mine, list) {
  const rank = { blocked: 0, working: 1, done: 2, idle: 3 };
  const ordered = list.filter((a) => a.space === spaceId).sort((a, b) =>
    (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || String(a.address).localeCompare(String(b.address)));
  const agentAddresses = new Set(list.map((a) => a.address));
  const shells = mine.filter((t) => t.program?.shell && !agentAddresses.has(t.address)).length;
  const cap = shells > 0 && ordered.length > 3 ? 2 : 3;
  const faces = ordered.slice(0, cap);
  const tip = [ordered.map(agentName).join(", "), shells ? `${shells} shell${shells === 1 ? "" : "s"}` : ""]
    .filter(Boolean).join(" · ");
  return { faces, hidden: ordered.length - faces.length, shells, tip };
}

// A tile label: the shortest leading 2 or 3 code points no other space shares. When even three
// collide (`abc-1408-ai` / `abc-1421-ai`), the first later word no other colliding name has, a
// number first (ticket ids), cut to 4 (`1408` / `1421`); the 3-letter head when none differs.
export function tileLabels(names) {
  const norm = names.map((name) => String(name ?? "").toLowerCase().replace(/^[^\p{L}\p{N}]+/u, ""));
  const head = (name, count) => [...name].slice(0, count).join("");
  const words = (name) => name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return norm.map((name, index) => {
    if (!name) return "?";
    for (const count of [2, 3]) {
      const label = head(name, count);
      if (!norm.some((other, at) => at !== index && head(other, count) === label)) return label;
    }
    const rivals = norm.filter((other, at) => at !== index && head(other, 3) === head(name, 3)).map(words);
    const own = words(name).slice(1).filter((word) => !rivals.some((rival) => rival.includes(word)));
    const pick = own.find((word) => /^\p{N}+$/u.test(word)) ?? own[0];
    return pick ? head(pick, 4) : head(name, 3);
  });
}

function quiet(ms) {
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}

// A space the cards hold no session for (idle, or never scanned) is named from its own name.
export function spaceName(name, ticketPrefixes = []) {
  const text = String(name ?? "");
  const match = text.match(spaceKeyRe(ticketPrefixes));
  if (!match) return { key: null, rest: text };
  const rest = text.replace(match[1], " ").replace(/^\s*(?:msa|mfe|api|web|docs)-/, "")
    .replace(/(^|-)rd-\d{8}-\d{6}(?=-|$)/, "$1").replace(/(^|-)(?=[0-9a-f]*[a-f])[0-9a-f]{6}(?=-|$)/, "$1")
    .split(/[\s-]+/).filter(Boolean).join("-");
  return { key: match[1].toUpperCase(), rest: rest || null };
}

// The 76 px rail's heading: the name's first word, so `herdr-arcade-cards` reads `herdr`, not a cut-off middle.
export function narrowHead(head) {
  return String(head ?? "").split(/[-_.\s]+/).find(Boolean) ?? "";
}

// The shown space's frame: white in the wide rail, and a line in the rail's own line colour in both
// widths — only the name turns amber.
export function shownFrame(wide) {
  return { bg: wide ? INK.shown : null, border: wide ? 1 : 2, color: INK.line };
}

// The rail's rows, grouped. `rows` are spaceRows() in Herdr's order, `list` is agents() and `places`
// the cards' { [terminal address]: { key, rest, topic, slack } }. Every repository gets a heading, and a
// space named like its repository shows its agent instead; the Slack space becomes one row per tab.
export function railTree(rows, list, places = {}, ticketPrefixes = []) {
  const groups = [];
  const byKey = new Map();
  const labels = tileLabels(rows.map((row) => row.space.name));
  const nameOf = (agentsHere, fallback) => {
    const place = agentsHere.map((a) => places[a.address]).find((p) => p?.key);
    return place ? { key: place.key, rest: place.rest ?? null } : spaceName(fallback, ticketPrefixes);
  };
  const shortOf = (name, fallback) => name.key?.match(KEY_DIGITS)?.[1] ?? fallback;
  rows.forEach((row, index) => {
    const s = row.space;
    const here = list.filter((a) => a.space === s.id);
    const slack = here.length > 0 && here.every((a) => places[a.address]?.slack
      || String(cwdOf(row.mine.find((t) => t.address === a.address)) ?? "").includes(SLACK_SESSIONS));
    if (slack) {
      const tabs = s.tabs.map((tab) => ({ tab, crew: here.filter((a) => a.tab === tab.id) })).filter((t) => t.crew.length);
      groups.push({ head: "Slack", kind: "slack", rows: tabs.map(({ tab, crew }) => {
        const topic = crew.map((a) => places[a.address]?.topic).find(Boolean);
        return { id: tab.id, space: s, tab, crew, active: s.active && tab.active,
          name: { key: null, rest: topic ?? tab.name }, short: [...String(topic ?? tab.name)].slice(0, 2).join("") };
      }) });
      return;
    }
    const key = row.repo?.common ?? `space:${s.id}`;
    let group = byKey.get(key);
    if (!group) {
      group = { head: null, kind: "repo", common: row.repo?.common ?? null, rows: [], worktree: false };
      byKey.set(key, group);
      groups.push(group);
    }
    if (row.repo && !row.repo.base) group.worktree = true;
    const name = nameOf(here, s.name);
    group.rows.push({ id: s.id, space: s, tab: null, crew: here, active: s.active, name, short: shortOf(name, labels[index]), row });
  });
  for (const group of groups) {
    if (group.kind !== "repo" || !group.common) continue;
    group.head = group.common.replace(/\/\.git\/?$/, "").split("/").pop() || null;
    for (const entry of group.rows) {
      if (entry.name.key || entry.name.rest !== group.head) continue;
      entry.name = { key: null, rest: entry.crew.map(agentName).find(Boolean) ?? entry.name.rest };
    }
  }
  return groups;
}

// A rail key: ↑↓ move to the neighbouring row and wrap; ↩ and Space pick the row shown.
export function railKey(key, at, count) {
  if (!(count > 0)) return null;
  if (key === "down") return { at: (at + 1) % count, select: false };
  if (key === "up") return { at: (at - 1 + count) % count, select: false };
  if (key === "enter" || key === "space") return { at: Math.min(at, count - 1), select: true };
  return null;
}

export default class ArcadeRail extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "spaces";
    this.board = props()?.variant === "board";
    this.ticketPrefixes = Array.isArray(props()?.ticketPrefixes) ? props().ticketPrefixes : [];
    this.keyboard = false;
    if (this.role === "buttons") {
      this.handles = [cx.focus_handle(), cx.focus_handle()];
      cx.timer.every(FOCUS_WATCH_MS, (cx) => this.watchFocus(cx));
      return;
    }
    this.handle = cx.focus_handle();
    this.at = 0;
    this.width = 0;
    this.turns = {};
    // The last answers git gave are kept, so a launch draws its repository headings at once.
    this.repos = loadRepos();
    this.reading = false;
    cx.timer.every(REPO_MS, (cx) => this.readRepos(cx));
    cx.timer.every(30000, (cx) => cx.notify());
    cx.timer.every(FOCUS_WATCH_MS, (cx) => this.watchFocus(cx));
    this.readRepos(cx);
  }

  focusKey() {
    return `${this.keyboard ? 1 : 0}|${(this.handles ?? [this.handle]).map((handle) => (handle?.is_focused?.() ? 1 : 0)).join("")}`;
  }

  // A ring comes from is_focused(), which the shell does not redraw on; only the keyboard draws it,
  // since a click focuses the rail too.
  watchFocus(cx) {
    const key = this.focusKey();
    if (key === this.drawnFocus) return;
    this.drawnFocus = key;
    cx.notify();
  }

  // SpaceInfo.folder is where new terminals start, not where they are, so the repo comes from where a
  // terminal's program runs now (cwdOf).
  readRepos(cx) {
    if (this.reading) return;
    this.reading = true;
    const folders = [...new Set(terminals().map(cwdOf).filter(Boolean))];
    cx.spawn(async (later) => {
      const next = {};
      await Promise.all(folders.map(async (cwd) => {
        try {
          const r = await exec("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"]);
          const [common, top] = String(r.stdout ?? "").trim().split("\n");
          next[cwd] = r.code === 0 && common ? { common, base: Boolean(top) && `${top}/.git` === common } : null;
        } catch {
          next[cwd] = null;
        }
      }));
      this.repos = next;
      saveRepos(next);
      this.reading = false;
      this.groupSpaces();
      later.notify();
    });
  }

  // A cwd the rail has not asked git about yet — a terminal that showed up after the last read —
  // is read now, instead of leaving its spaces ungrouped until the next REPO_MS pass.
  readMissing(cx) {
    if (this.reading) return;
    if (!terminals().some((t) => { const cwd = cwdOf(t); return cwd && !(cwd in this.repos); })) return;
    this.readRepos(cx);
  }

  // Each space's first terminal cwd and the repository git found there; repo is undefined
  // while git hasn't been asked about that cwd yet.
  spaceRows() {
    const byAddress = new Map(terminals().map((t) => [t.address, t]));
    const paneList = panes();
    return spaces().map((s) => {
      const mine = this.spaceTerminals(s, byAddress, paneList);
      const cwd = mine.map(cwdOf).find(Boolean) ?? null;
      return { space: s, mine, repo: cwd ? this.repos[cwd] : null };
    });
  }

  // Keeps the spaces of one repository next to each other in Herdr's own order (base checkout
  // first), so ⌃1–9 follow the rail. Each order is tried once.
  groupSpaces() {
    const rows = this.spaceRows();
    if (rows.some((row) => row.repo === undefined)) return;
    const groups = new Map();
    for (const row of rows) {
      const key = row.repo?.common ?? row.space.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const want = [...groups.values()].flatMap((members) =>
      [...members.filter((r) => r.repo?.base), ...members.filter((r) => !r.repo?.base)]).map((r) => r.space.id);
    const have = rows.map((r) => r.space.id);
    const key = `${have.join(",")}>${want.join(",")}`;
    if (want.join(",") === have.join(",") || this.lastMove === key) return;
    this.lastMove = key;
    const order = [...have];
    want.forEach((id, index) => {
      if (order[index] === id) return;
      run("space.move", { id, index: index + 1 });
      order.splice(order.indexOf(id), 1);
      order.splice(index, 0, id);
    });
  }

  spaceTerminals(s, byAddress, paneList) {
    const tabs = new Set(s.tabs.map((t) => t.id));
    return paneList.filter((p) => p.terminal && tabs.has(p.tab)).map((p) => byAddress.get(p.terminal)).filter(Boolean);
  }

  // hc gives no last-activity time, so a shell counts as idle from when this view last saw its turn change.
  idleShells(list, now) {
    const idle = [];
    for (const t of list) {
      if (!t.program?.shell) continue;
      const seen = this.turns[t.address];
      if (!seen || seen.turn !== t.turn) this.turns[t.address] = { turn: t.turn, at: now };
      const since = now - this.turns[t.address].at;
      if (since >= IDLE_MS) idle.push(since);
    }
    return idle;
  }

  faces(crew, size, max) {
    const rank = { blocked: 0, working: 1, done: 2, idle: 3 };
    const ordered = [...crew].sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || String(a.address).localeCompare(String(b.address)));
    const shown = ordered.slice(0, max);
    const step = size - Math.round(size * 0.3);
    // Laid out by position, not negative margins, so the stack's width is exactly what it covers.
    const stack = div().relative().flex_none().h(size).w(size + step * Math.max(0, shown.length - 1))
      .children(shown.map((a, i) => div().absolute().top(0).left(step * i).size(size).rounded(size / 2).border(2)
        .border_color(FACE[a.status] ?? FACE.idle).bg(INK.card).overflow_hidden()
        .child(image(`mods/arcade-rail/faces/${charFor(a.address)}.png`).size_full())));
    return h_flex().flex_none().items_center()
      .child(stack)
      .when(ordered.length > max, (el) => el.child(div().ml(2).text_size(10).font_family(NAME_FONT).font_bold()
        .text_color(INK.t2).child(`+${ordered.length - max}`)));
  }

  select(entry) {
    run("space.select", { id: entry.space.id });
    if (entry.tab) run("tab.select", { id: entry.tab.id });
  }

  // The HIGH SCORE board: every repository a game title and each of its spaces a ranked row of one
  // face, its ticket key and its name. Same spaces, grouping and selection as the vertical rail.
  boardView() {
    const now = Date.now();
    const list = agents();
    const rows = this.spaceRows().map((row) => ({ ...row, repo: row.repo ?? null, idle: this.idleShells(row.mine, now) }));
    const places = shared("arcade-cards")?.places ?? {};
    const groups = railTree(rows, list, places, this.ticketPrefixes);
    const order = groups.flatMap((group) => group.rows);
    this.at = Math.min(Math.max(this.at ?? 0, 0), Math.max(0, order.length - 1));
    this.drawnFocus = this.focusKey();
    const focusedAt = (entry) => this.keyboard && Boolean(this.handle?.is_focused?.()) && order[this.at] === entry;
    const rank = (n) => div().w(18).flex_none().text_size(10).font_family(DISPLAY).text_color(INK.t2)
      .child(String(n).padStart(2, "0"));
    const face = (entry) => (entry.crew.length
      ? this.faces(entry.crew, 20, 1)
      : div().size(20).flex_none().rounded(10).border(2).border_dashed().border_color(INK.sep));
    const row = (entry, n) => h_flex().id(`rail-${entry.id}`).h(26).flex_none().px(4).gap(6).items_center().rounded(0).cursor_pointer()
      .when(entry.active, (el) => el.bg(INK.shown).border_l(2).border_color(INK.amber))
      .when(!entry.active, (el) => el.hover((h) => h.bg(INK.hover)))
      .when(focusedAt(entry), (el) => el.border(2).border_color(INK.focus))
      .role("row").aria_selected(Boolean(entry.active))
      .tooltip(this.entryTip(entry))
      .on_click(() => { this.at = order.indexOf(entry); this.select(entry); })
      .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: entry.space.id } } }))
      .child(rank(n))
      .child(face(entry))
      .child(h_flex().flex_1().min_w(0).gap(4).items_center()
        .when(Boolean(entry.name.key), (el) => el.child(div().flex_none().text_size(11).font_family(NAME_FONT).font_weight(800)
          .text_color(entry.active ? INK.amber : INK.t1).child(entry.name.key)))
        .when(Boolean(entry.name.rest), (el) => el.child(div().min_w(0).truncate().text_size(11).font_family(NAME_FONT)
          .font_weight(entry.name.key ? 600 : 700).text_color(entry.active ? INK.amber : INK.t2).child(entry.name.rest))));
    const heading = (group) => (group.head
      ? [div().pt(4).text_size(10).font_family(DISPLAY).text_color(INK.t2).child(group.head)]
      : []);
    return v_flex().id("high-score").size_full().p(8).gap(6).bg(INK.card).border(2).border_color(INK.line)
      .track_focus(this.handle).tab_index(0)
      .on_mouse_down("left", () => { this.keyboard = false; })
      .on_key_down((event, cx) => {
        const next = railKey(event.key, this.at, order.length);
        if (!next) return;
        this.keyboard = true;
        this.at = next.at;
        if (next.select) this.select(order[this.at]);
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().flex_none().text_size(12).font_family(DISPLAY).text_color(INK.amber).child("HIGH SCORE"))
      .child(v_flex().flex_1().min_h(0).gap(2).overflow_y_scroll()
        .children(groups.flatMap((group) => [...heading(group), ...group.rows.map((entry, index) => row(entry, index + 1))])));
  }

  entryTip(entry) {
    const idle = entry.row?.idle ?? [];
    const who = crewOf(entry.space.id, entry.row?.mine ?? [], entry.crew).tip;
    return [entry.name.key ? `${entry.name.key} ${entry.name.rest ?? ""}`.trim() : entry.name.rest, who,
      idle.length ? `${idle.length} idle shell${idle.length === 1 ? "" : "s"} · ${quiet(Math.max(...idle))}` : null]
      .filter(Boolean).join(" · ");
  }

  render(cx) {
    if (this.role === "buttons") return this.buttons();
    this.readMissing(cx);
    if (this.board) return this.boardView();
    const now = Date.now();
    const list = agents();
    const rows = this.spaceRows().map((row) => ({ ...row, repo: row.repo ?? null, idle: this.idleShells(row.mine, now) }));
    const places = shared("arcade-cards")?.places ?? {};
    const groups = railTree(rows, list, places, this.ticketPrefixes);
    const wide = this.width >= WIDE_W;
    const order = groups.flatMap((group) => group.rows);
    const rankOf = new Map(groups.flatMap((group) => group.rows.map((entry, index) => [entry, index + 1])));
    this.at = Math.min(Math.max(this.at ?? 0, 0), Math.max(0, order.length - 1));
    this.drawnFocus = this.focusKey();
    const focusedAt = (entry) => this.keyboard && Boolean(this.handle?.is_focused?.()) && order[this.at] === entry;
    const rank = (entry) => div().w(18).flex_none().text_size(10).font_family(DISPLAY).text_color(INK.t2)
      .child(String(rankOf.get(entry) ?? 1).padStart(2, "0"));

    const heading = (group) => div().h(24).flex_none().flex().items_center().when(wide, (el) => el.pl(12)).when(!wide, (el) => el.justify_center())
      .text_size(wide ? 12 : 10).font_family(wide ? DISPLAY : NAME_FONT).text_color(INK.amber)
      .child(div().min_w(0).truncate().child(wide ? group.head : narrowHead(group.head)));
    const tipOf = (entry) => this.entryTip(entry);
    const label = (entry) => h_flex().flex_1().min_w(0).gap(4).items_center()
      .when(Boolean(entry.name.key), (el) => el.child(div().flex_none().text_size(12).font_family(NAME_FONT).font_weight(800)
        .text_color(entry.active ? INK.amber : INK.t1).child(entry.name.key)))
      .when(Boolean(entry.name.rest), (el) => el.child(div().min_w(0).truncate().text_size(12).font_family(NAME_FONT)
        .font_weight(entry.name.key ? 600 : 700).text_color(entry.name.key ? INK.t2 : entry.active ? INK.amber : INK.t1)
        .child(entry.name.rest)));
    const ring = (entry) => (entry.row?.idle?.length ?? 0) > 0
      ? div().size(8).flex_none().rounded(4).border(2).border_color(INK.t2) : null;
    const wideRow = (entry) => {
      const frame = shownFrame(true);
      return h_flex().id(`rail-${entry.id}`).h(30).flex_none().ml(12).mr(6).pl(8).pr(6)
        .gap(8).items_center().rounded(0).cursor_pointer()
        .when(entry.active, (el) => el.bg(frame.bg).border(frame.border).border_color(frame.color))
        .when(!entry.active, (el) => el.hover((h) => h.bg(INK.hover)))
        .when(focusedAt(entry), (el) => el.border(2).border_color(INK.focus))
        .role("row").aria_selected(Boolean(entry.active))
        .tooltip(tipOf(entry))
        .on_click(() => { this.at = order.indexOf(entry); this.select(entry); })
        .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: entry.space.id } } }))
        .child(rank(entry))
        .child(entry.crew.length ? this.faces(entry.crew, 16, 3) : div().size(16).flex_none().rounded(8).border(2).border_dashed().border_color(INK.sep))
        .child(label(entry))
        .when(Boolean(ring(entry)), (el) => el.child(ring(entry)));
    };
    const narrowRow = (entry) => {
      const frame = shownFrame(false);
      return v_flex().id(`rail-${entry.id}`).flex_none().items_center().gap(2).pb(8).cursor_pointer()
        .role("row").aria_selected(Boolean(entry.active))
        .tooltip(tipOf(entry))
        .on_click(() => { this.at = order.indexOf(entry); this.select(entry); })
        .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: entry.space.id } } }))
        .child(div().relative().p(2).rounded(19).when(entry.active, (el) => el.border(frame.border).border_color(frame.color))
          .when(focusedAt(entry), (el) => el.border(2).border_color(INK.focus))
          .child(entry.crew.length ? this.faces(entry.crew, 30, 1) : div().size(30).rounded(15).border(2).border_dashed().border_color(INK.sep))
          .when(Boolean(ring(entry)), (el) => el.child(div().absolute().right(-2).bottom(-2).child(ring(entry)))))
        .child(div().text_size(10).font_family(NAME_FONT).font_weight(800).text_color(entry.active ? INK.amber : INK.t1).child(entry.short ?? "?"));
    };

    return v_flex().id("rail-tiles").size_full().pt(44).overflow_y_scroll()
      .track_focus(this.handle).tab_index(0)
      .on_mouse_down("left", () => { this.keyboard = false; })
      .on_key_down((event, cx) => {
        const next = railKey(event.key, this.at, order.length);
        if (!next) return;
        this.keyboard = true;
        this.at = next.at;
        if (next.select) this.select(order[this.at]);
        cx.stop_propagation();
        cx.notify();
      })
      .on_size_change((size, cx) => {
        if (size.width === this.width) return;
        this.width = size.width;
        cx.notify();
      })
      .children(groups.flatMap((group, index) => [
        ...(index > 0 ? [div().h(1).flex_none().mx(wide ? 12 : 14).my(6).bg(INK.sep)] : []),
        ...(group.head ? [heading(group)] : []),
        ...group.rows.map((entry) => (wide ? wideRow(entry) : narrowRow(entry))),
      ]));
  }

  // props().role "buttons": the coin slot under the CREDIT board, and the settings button beside it.
  buttons() {
    this.drawnFocus = this.focusKey();
    const lit = (handle) => Boolean(this.keyboard && handle?.is_focused?.());
    const action = (target) => (event, cx) => {
      if (event.key !== "enter" && event.key !== "space") return;
      this.keyboard = true;
      cx.stop_propagation();
      target();
      cx.notify();
    };
    const newHandle = this.handles?.[0];
    const settingsHandle = this.handles?.[1];
    const coin = div().id("rail-new").flex_1().min_w(0).h(32).rounded(0).flex().items_center().justify_center().cursor_pointer()
      .bg(INK.raised).border(2).border_color(INK.line)
      .text_size(10).font_family(NAME_FONT).text_color(INK.t2)
      .when(Boolean(newHandle), (el) => el.track_focus(newHandle).tab_index(0))
      .when(lit(newHandle), (el) => el.border_color(INK.focus).text_color(INK.focus))
      .role("button").accessibility_label("New space").tooltip("Insert coin · new space")
      .hover((h) => h.bg(INK.focus + "1f").border_color(INK.focus).text_color(INK.focus))
      .on_key_down(action(() => run("space.new")))
      .on_click(() => run("space.new"))
      .child(div().whitespace_nowrap().child("INSERT COIN"));
    const settings = div().id("rail-settings").size(32).flex_none().rounded(0).flex().items_center().justify_center().cursor_pointer()
      .bg(INK.raised).border(2).border_color(INK.line).text_color(INK.t2)
      .when(Boolean(settingsHandle), (el) => el.track_focus(settingsHandle).tab_index(0))
      .when(lit(settingsHandle), (el) => el.border_color(INK.focus).text_color(INK.focus))
      .role("button").accessibility_label("Settings").tooltip("Settings")
      .hover((h) => h.bg(INK.focus + "1f").border_color(INK.focus).text_color(INK.focus))
      .on_key_down(action(() => run("app.settings")))
      .on_click(() => run("app.settings"))
      .child(svg("mods/workspace-chrome/settings.svg").size(15));
    return v_flex().size_full().justify_end().px(8).pb(8).items_center()
      .on_mouse_down("left", () => { this.keyboard = false; })
      .child(h_flex().w_full().h(32).gap(6).items_center().child(coin).child(settings));
  }
}
