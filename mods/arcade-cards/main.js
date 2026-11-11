// Arcade cards: every session is a pocket card with a Arcade character on it, laid
// left to right in three groups (Needs you, Working, Done) and scrolled sideways.
// The data, grouping, sort, keys and opening are Pulse's (scan.sh every 3 s); Herdr
// agents Pulse doesn't list (other programs) join the same groups. props().role "head"
// draws the space's name and "tools" the branch, pages and search; tools reads the strip
// copy's state through shared().

import { View, div, image, svg, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex, h_virtual_list, VirtualListScrollHandle, Popup } from "gpui-base";
import { exec, run, appHome, settings, readTextFile, writeTextFile, terminals, panes, agents, spaces, focused, nextCommand, props, shared, setShared, openOverlay, closeOverlay } from "herdr";

const INK = {
  bg: "#191035", chrome: "#31265a", surface: "#251b47", line: "#483e74", edge: "#483e74", rule: "#483e74", cabEdge: "#6b3fd1",
  t1: "#f1f0ff", t2: "#d0cdea", t3: "#aaa6c9", accent: "#ff41b4", accentInk: "#210715",
  focus: "#f9d544", play: "#3adaf2", chipBg: "#31265a",
};
const FLASH_KEY = "arcade-cards.flash";
export const NOTICE_KEY = "arcade-cards.notice";
export const NOTICE_ACT_KEY = "arcade-cards.notice-act";
export const NO_PAGE_FLASH = "No page can open yet — try again after the scan";
// Band, chip ink and dot per lane; `word` is the state line on a card.
const TONE = {
  needs: { ink: INK.accent, dot: INK.accent, label: "Needs you", word: "YOUR TURN" },
  stall: { ink: INK.t3, dot: INK.t3, label: "Stalled", word: "PAUSED" },
  working: { ink: INK.play, dot: INK.play, label: "Working", word: "PLAYING" },
  done: { ink: INK.focus, dot: INK.focus, label: "Done", word: "CLEARED" },
};
const SEG = { done: INK.focus, now: INK.play, side: INK.play, blocked: INK.accent, left: INK.rule };
const GROUP_COLOR = { attention: TONE.needs.dot, working: TONE.working.dot, done: TONE.done.dot };
const GROUP_TITLE = { attention: "CONTINUE?", working: "NOW PLAYING", done: "CLEAR!" };
const GROUP_SUB = { attention: "Your turn", working: "In play", done: "Cleared" };
const FONT = "Galmuri11";
const DISPLAY = "Galmuri14";
// Running text and the terminal keep their own faces; titles use Galmuri14.
const BODY_FONT = "Galmuri11";
const POLL_MS = 3000;
const FOCUS_WATCH_MS = 100;
const STALL_MS = 10 * 60 * 1000;
const SNOOZE_MS = 10 * 60 * 1000;
const DONE_WINDOW_MS = 12 * 60 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const MAX_DONE = 5;
const SEEN_KEY = "pulse.seen";
const VIEWED_KEY = "pulse.viewed";
const UNDO_MS = 6000;
const NONE = "\u0000none";
const SHARED_KEY = "arcade-cards";
const BADGES = { "herdr-app": "herdr", herdr: "herdr", tmux: "tmux", orca: "orca" };
const CHARS = ["kid", "robot", "cat", "oldman", "frog", "punk"];
const WHO = { kid: "Kid", robot: "Robot", cat: "Cat", oldman: "Old man", frog: "Frog", punk: "Punk" };
// The cards block's height at scale 1, which is also the beach's height. geometry(k) gives
// every length and text size in the strip at another height; the row can be dragged, so the
// block measures itself and scales to it.
export const BASE_BLOCK_H = 276;
export const BLOCK_H_MIN = 240, BLOCK_H_MAX = 420;
const STEP_ROWS = Math.floor((252 - 24 - 20) / 22);
const STRIP_ID = "cc-strip";
// Hairlines land on the half-pixel grid; a 1 px border stays 1.
const half = (value) => Math.round(value * 2) / 2;

export function geometry(k = 1) {
  const s = (value) => half(value * k);
  const CARD_W = s(240), CARD_H = s(252), STEPS_W = s(240), MORE_W = s(120);
  const HEAD_H = s(50), FACE = s(40), FACE_PAD = s(8);
  const STATE_H = s(16);
  const PAD_X = s(20), GROUP_GAP = s(24), CARD_GAP = s(12), LANE_W = s(112);
  const STRIP_TOP_PAD = s(12), STRIP_BOTTOM_PAD = s(12), LEGEND_H = s(28);
  const BODY_PAD = s(10), CHIP_PAD = s(6);
  const STRIP_H = half(CARD_H + STRIP_BOTTOM_PAD);
  return {
    k, CARD_W, CARD_H, STEPS_W, MORE_W, HEAD_H, FACE, FACE_PAD, STATE_H,
    STEP_ROWS, PAD_X, GROUP_GAP, CARD_GAP, LANE_W,
    STRIP_TOP_PAD, STRIP_BOTTOM_PAD, LEGEND_H, STRIP_H,
    STRIP_BLOCK_H: half(STRIP_TOP_PAD + STRIP_H),
    BODY_H: s(196), TOPIC_LINE: s(16), MSG_LINE: s(17), FOOT_H: s(14), TRAY_H: s(22),
    TEXT_W: half(CARD_W - 4 - 2 * BODY_PAD),
    // The message panel sits inside the body at CHIP_PAD and keeps a 2 px mood edge on the left,
    // so the text wraps to less than TEXT_W and never reaches gpui's truncate.
    MSG_W: half(CARD_W - 4 - 2 * BODY_PAD - 2 * CHIP_PAD - 2),
    COL_W: half(CARD_W - 4 - 2 * BODY_PAD - FACE - FACE_PAD),
    PROGRESS_H: s(14), PROGRESS_GAP: s(8), BAR_H: s(6), BAR_GAP: s(2), BAR_RADIUS: 0, PROGRESS_MB: s(4),
    TAG_H: s(22), TAG_MAX_W: s(110), TAG_PAD: s(8), TAG_RADIUS: 0, TAG_CHIP_GAP: s(5), TAG_ICON: s(11), TAG_GAP: s(6),
    STEP_H: s(20), STEP_GAP: s(6), STEP_GLYPH_W: s(14), SPINNER: s(9), STEP_TRAIL_W: s(72),
    STEPS_PAD: s(10), STEPS_GAP: s(2), STEPS_HEAD_H: s(20), STEPS_HEAD_GAP: s(8),
    CARD_RADIUS: 0, BODY_PT: s(8), BODY_PAD, BODY_PB: s(8), MSG_MT: s(4), MSG_SPINNER_MR: s(6),
    TRAY_MB: s(4), TRAY_GAP: s(4), CHIP_H: s(18), CHIP_PAD, CHIP_RADIUS: 0, FOOT_GAP: s(8),
    MORE_GAP: s(4),
    // The control panel's info area: a small face, then the key, topic, two dialogue lines and
    // the state, against a 2 px mood edge on the left.
    INFO_FACE: s(32), INFO_PAD: s(12), INFO_GAP: s(12), INFO_GAP_Y: s(2), INFO_LINE: s(16), INFO_TAG_GAP: s(8),
    LEGEND_PAD: s(16), LEGEND_GAP: s(14), LEGEND_ITEM_GAP: s(5),
    KEYCAP_H: s(18), KEYCAP_PAD: s(4), KEYCAP_RADIUS: 0,
    TEXT: {
      base: s(13), persona: s(11), key: s(13), tagSub: s(10),
      progress: s(11), page: s(11), stepGlyph: s(11), stepLabel: s(12), stepTrail: s(11),
      stepsHead: s(11), stepsCount: s(11),
      topic: s(12), message: s(12), chip: s(10), badge: s(9), foot: s(11),
      groupTitle: s(13), groupSub: s(10), moreCount: s(18), moreLabel: s(11),
      empty: s(13), legend: s(11), keycap: s(10), legendTitle: s(13),
    },
  };
}

// The hover label wraps only at newlines, so the heading and the details get a line each.
export function cardTooltip(topic, title, details) {
  const heading = [...new Set([topic, title].filter(Boolean))].join(" · ");
  return [heading, details.filter(Boolean).join(" · ")].filter(Boolean).join("\n");
}

// The block's measured height, clamped, is the strip's scale.
export function cardsScale(height) {
  return Math.max(BLOCK_H_MIN, Math.min(BLOCK_H_MAX, Math.round(height))) / BASE_BLOCK_H;
}

// The screen under the card's head takes the height the head, progress line, tray and state
// leave, so the message wraps over that room instead of one line over a stretch of bare card.
export function screenHeight({ showProgress = false, tray = false } = {}, g = geometry(1)) {
  const fixed = g.HEAD_H + g.MSG_MT + (showProgress ? g.PROGRESS_H + g.PROGRESS_MB : 0)
    + (tray ? g.TRAY_H + g.TRAY_MB : 0) + g.STATE_H;
  return Math.max(0, g.CARD_H - 4 - g.BODY_PT - g.BODY_PB - fixed);
}

export function screenLines(height, g = geometry(1)) {
  return Math.max(1, Math.floor(height / g.MSG_LINE));
}

// Herdr measures a mod in on-screen px, which carry the app's zoom; the strip's lengths are
// written at zoom 1, so the measured height is divided back by it.
export function zoomOf(s = settings()) {
  const z = Number(s?.zoom);
  return z > 0 ? z : 1;
}

// cmd +/-/0 in this layout change the terminals' text size in settings.json, never the zoom,
// so the strip and the beach keep their size. Herdr's own stepper clamps to the same 8..32.
export const TERM_FONT = 14, TERM_FONT_MIN = 8, TERM_FONT_MAX = 32;
export function nextSettings(person, command, shown = TERM_FONT) {
  const next = { ...person };
  if (command === "font_reset") {
    delete next.font_size;
    next.zoom = 1;
    return next;
  }
  const d = command === "font_in" ? 1 : command === "font_out" ? -1 : 0;
  if (!d) return null;
  const now = Number(next.font_size ?? shown) || TERM_FONT;
  next.font_size = Math.max(TERM_FONT_MIN, Math.min(TERM_FONT_MAX, Math.round(now) + d));
  return next;
}

export const STRIP_H = geometry(1).STRIP_H;
export const STRIP_BLOCK_H = geometry(1).STRIP_BLOCK_H;
export const TEXT_W = geometry(1).TEXT_W;

// A classic mouse wheel's notch is one card; a trackpad gathers WHEEL_STEP px per card, but the
// first movement of a gesture takes one at once so a small nudge is not swallowed. Downward moves right.
export const WHEEL_STEP = 60;
export const WHEEL_GESTURE_GAP = 200;

function stripStarts(widths) {
  const starts = [];
  let sum = 0;
  for (const width of widths) {
    starts.push(sum);
    sum += width;
  }
  return starts;
}

// The farthest the strip can scroll: any further and the last card already touches the right edge.
export function maxOffset(widths, viewportW) {
  if (!Array.isArray(widths) || !widths.length) return 0;
  const total = widths.reduce((sum, width) => sum + width, 0);
  return Math.max(0, total - (viewportW > 0 ? viewportW : 0));
}

export function clampOffset(off, widths, viewportW) {
  const value = Number.isFinite(off) ? off : 0;
  return Math.max(0, Math.min(maxOffset(widths, viewportW), value));
}

// The card at the left edge: the first whose END passes the offset, with 1 px of rounding tolerance.
export function leftIndexAt(off, widths) {
  if (!Array.isArray(widths) || !widths.length) return 0;
  const starts = stripStarts(widths);
  for (let i = 0; i < widths.length; i += 1) {
    if (starts[i] + widths[i] > off + 1) return i;
  }
  return widths.length - 1;
}

// The last card fully on screen: its END is within the right edge, with the same 1 px tolerance.
export function rightIndexAt(off, widths, viewportW) {
  if (!Array.isArray(widths) || !widths.length || !(viewportW > 0)) return -1;
  const starts = stripStarts(widths);
  const edge = off + viewportW + 1;
  let last = -1;
  for (let i = 0; i < widths.length; i += 1) {
    if (starts[i] + widths[i] > edge) break;
    last = i;
  }
  return last;
}

// Where centring `index` leaves the left edge; null while the viewport width is unknown.
export function centeredOffset(index, widths, viewportW) {
  if (!Array.isArray(widths) || !widths.length || !(viewportW > 0)) return null;
  const at = Math.max(0, Math.min(widths.length - 1, index ?? 0));
  const starts = stripStarts(widths);
  return clampOffset(starts[at] + widths[at] / 2 - viewportW / 2, widths, viewportW);
}

// `state.off` is the strip's scroll position in px. A native sideways swipe moves that estimate by its
// own delta; a wheel step asks the list to scroll to a card and sets the estimate to where the list
// then puts it (it aligns a partly visible card to its nearest edge). `state.index` is the card at the
// left edge only for the fallback when the viewport width is unknown.
export function wheelStepFor(state, event, now, widths, viewportW) {
  const list = Array.isArray(widths) ? widths : [];
  const count = list.length;
  const dx = event.delta?.x ?? 0;
  const dy = event.delta?.y ?? 0;
  const lines = event.delta_lines;
  const lx = lines?.x ?? 0;
  const ly = lines?.y ?? 0;
  const phase = event.touch_phase;

  const measured = count > 0 && viewportW > 0;
  const starts = measured ? stripStarts(list) : null;
  const off = measured ? clampOffset(state.off ?? 0, list, viewportW) : null;
  const index = measured ? leftIndexAt(off, list) : Math.max(0, Math.min(count - 1, state.index ?? 0));

  const settle = (acc, gesture, dir, step) => ({
    state: {
      ...state,
      acc,
      at: now,
      gesture,
      dir,
      index: measured ? leftIndexAt(step.off, list) : step.index,
      off: measured ? clampOffset(step.off, list, viewportW) : (state.off ?? 0),
    },
    target: step.target,
  });
  const still = { index, off, target: null };
  const move = (forward) => {
    if (!measured) {
      if (forward < 0) return index > 0 ? { index: index - 1, off, target: index - 1 } : still;
      if (index >= count - 1) return still;
      const target = index + 1;
      return { index: target, off, target };
    }
    if (forward < 0) {
      if (off <= 1) return still;
      const target = starts[index] < off - 1 ? index : index - 1;
      if (target < 0) return still;
      return { index: target, off: starts[target], target };
    }
    const right = rightIndexAt(off, list, viewportW);
    if (right >= count - 1) return still;
    const target = right + 1;
    return { index: target, off: starts[target] + list[target] - viewportW, target };
  };

  if (phase === "ended" || phase === "cancelled") return settle(0, false, 0, still);
  // Sideways-dominant travel is the native horizontal scroll: it already moved the content, so only
  // the estimate follows it.
  if ((lines && Math.abs(lx) > Math.abs(ly)) || Math.abs(dx) >= Math.abs(dy)) {
    if (!measured) return { state: { ...state, index }, target: null };
    const next = clampOffset(off - dx, list, viewportW);
    return { state: { ...state, off: next, index: leftIndexAt(next, list) }, target: null };
  }
  if (lines && ly !== 0) {
    // One notch, one card: a fast spin still asks for one card per event.
    return settle(0, false, 0, move(ly < 0 ? 1 : -1));
  }

  const dir = dy < 0 ? 1 : -1;
  // A new gesture, a pause, or a reversal takes a card at once; otherwise pixels accumulate.
  const fresh = phase === "started" || !state.gesture || now - (state.at ?? 0) > WHEEL_GESTURE_GAP || dir !== state.dir;
  if (fresh) return settle(0, true, dir, move(dir));

  const total = (state.acc ?? 0) - dy;
  if (Math.abs(total) < WHEEL_STEP) return settle(total, true, dir, still);
  // At most one card per event: the rest of a flick is dropped rather than carried.
  return settle(0, true, dir, move(total > 0 ? 1 : -1));
}

// One character per terminal (or per session outside Herdr): FNV-1a of the key. The rail
// uses the same function on the agent's address, so a card and its rail face match.
export function charFor(key) {
  let h = 0x811c9dc5;
  for (const ch of String(key ?? "")) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return CHARS[h % CHARS.length];
}

export function toneKey(tone) {
  if (tone === TONE.done) return "done";
  if (tone === TONE.working) return "working";
  if (tone === TONE.stall) return "stall";
  return "needs";
}

// A selected card takes the score yellow while the strip has the keyboard, the play cyan otherwise.
export function selectedTone(focused) {
  return focused ? { border: INK.focus, title: INK.focus } : { border: INK.play, title: INK.t1 };
}

// One line per character and state, in each character's voice.
const PERSONA = {
  kid:    { needs: ["Help me!", "One more!"], stall: "Uh… what now", working: "On my way!", done: "I won!" },
  robot:  { needs: ["Confirm please.", "Need input."], stall: "Power down…", working: "Computing…", done: "All clear." },
  cat:    { needs: ["Meow?", "One look?"], stall: "…meow", working: "Meow meow!", done: "Meow—!" },
  oldman: { needs: "Just one look", stall: "Time to rest", working: "Steady now", done: "All done" },
  frog:   { needs: "Ribbit?", stall: "…ribbit", working: "Hop hop!", done: "Ribbit!" },
  punk:   { needs: ["Hey, hurry!", "Waiting here!"], stall: "Tch…", working: "Let's go!", done: "Finished!" },
};
// A list takes turns, one line per POLL_MS: the strip redraws on every poll.
export function personaLine(who, key, now = Date.now()) {
  const line = PERSONA[who]?.[key] ?? "";
  return Array.isArray(line) ? line[Math.floor(now / POLL_MS) % line.length] : line;
}

function clean(value) {
  if (typeof value !== "string") return null;
  const collapsed = value.trim().split(/\s+/).join(" ");
  return collapsed || null;
}

function clip(value, limit) {
  const text = clean(value);
  if (!text) return null;
  return text.length > limit ? text.slice(0, limit) : text;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return null;
}

function fold(value) {
  const decomposed = String(value ?? "").normalize("NFD");
  return Array.from(decomposed).filter((ch) => {
    const code = ch.codePointAt(0);
    return code < 0x300 || code > 0x36f;
  }).join("").toLowerCase();
}

// Galmuri11's advances, which the card draws in: Hangul and symbols a full em, capitals and digits
// two thirds, lowercase a little over half, a space under half. An estimate under the drawn width
// leaves gpui truncating a line wrapLines thought fit, so each share rounds up.
export function textWidth(text, size) {
  let width = 0;
  for (const ch of String(text ?? "")) {
    const code = ch.codePointAt(0);
    if (/\s/.test(ch)) width += size * 0.42;
    else if (code >= 0x2000) width += size;
    else if (/[A-Z0-9]/.test(ch)) width += size * 0.67;
    else if (/[a-z]/.test(ch)) width += size * 0.59;
    else width += size * 0.5;
  }
  return width;
}

// Lines of `text` at `size` px that fit `width`, at most `lines`; the last one ends in "…" when text is
// left over. gpui clips but has no multi-line ellipsis, so the card cuts its text itself.
export function wrapLines(text, size, width, lines, firstIndent = 0) {
  const source = clean(text);
  if (!source || lines <= 0) return [];
  const all = [];
  let current = "";
  let room = width - firstIndent;
  for (const ch of source) {
    if (textWidth(current + ch, size) <= room) { current += ch; continue; }
    const cut = current.lastIndexOf(" ");
    if (ch !== " " && cut > 0) {
      all.push(current.slice(0, cut));
      current = current.slice(cut + 1) + ch;
    } else {
      all.push(current);
      current = ch === " " ? "" : ch;
    }
    room = width;
  }
  if (current.trim()) all.push(current);
  if (all.length <= lines) return all.map((line) => line.trim());
  const kept = all.slice(0, lines).map((line) => line.trim());
  const lastRoom = lines === 1 ? width - firstIndent : width;
  let last = kept[lines - 1];
  while (last && textWidth(`${last}…`, size) > lastRoom) {
    const cut = last.lastIndexOf(" ");
    last = cut > 0 ? last.slice(0, cut) : last.slice(0, -1);
  }
  kept[lines - 1] = `${last.trimEnd()}…`;
  return kept;
}

// Without a layout's `ticketPrefixes` a key must be uppercase Jira-style, so a folder like `worker-2`
// is not one; with prefixes set, only those match, case-insensitively, and the key still prints uppercase.
function ticketKeyRe(prefixes = []) {
  const list = (Array.isArray(prefixes) ? prefixes : []).map((prefix) => String(prefix).trim()).filter(Boolean);
  if (!list.length) return /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-\d{1,5})(?![0-9])/;
  const any = list.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?:^|[^A-Za-z0-9])((?:${any})-\\d{1,5})(?![0-9])`, "i");
}

// Where a session runs, ticket key first: `api-cserver-ABC-1435` is ABC-1435 / cserver / api. The card
// footer and the rail (through setShared) both use `label`.
export function placeOf(cwd, slackThread = null, knownRepos = [], ticketPrefixes = []) {
  if (slackThread) return { key: null, rest: null, repo: null, label: "Slack", slack: true };
  const parts = String(cwd ?? "").split("/").filter(Boolean);
  if (!parts.length) return { key: null, rest: null, repo: null, label: null, slack: false };
  let repo = null;
  let leaf = parts.at(-1);
  const workspaces = parts.indexOf("workspaces");
  const worktrees = parts.lastIndexOf("worktrees");
  if (workspaces >= 0 && parts[workspaces + 2]) {
    repo = parts[workspaces + 1];
    leaf = parts[workspaces + 2];
  } else if (worktrees >= 2 && parts[worktrees - 1] === ".claude" && parts[worktrees + 1]) {
    repo = parts[worktrees - 2];
    leaf = parts[worktrees + 1];
  } else {
    repo = (Array.isArray(knownRepos) ? knownRepos : []).find((name) => leaf.startsWith(`${name}-`)) ?? null;
  }
  const match = leaf.match(ticketKeyRe(ticketPrefixes));
  if (!match) return { key: null, rest: null, repo, label: leaf, slack: false };
  let rest = leaf.replace(match[1], " ");
  if (repo && rest.startsWith(`${repo}-`)) rest = rest.slice(repo.length + 1);
  rest = rest.split(/[\s-]+/).filter(Boolean).join("-")
    .replace(/(^|-)rd-\d{8}-\d{6}(?=-|$)/, "").replace(/(^|-)(?=[0-9a-f]*[a-f])[0-9a-f]{6}(?=-|$)/, "")
    .replace(/^-+|-+$/g, "") || null;
  return { key: match[1].toUpperCase(), rest, repo, label: [rest, repo].filter(Boolean).join(" · ") || match[1].toUpperCase(), slack: false };
}

// A Slack thread session's folder is named <channel>-<thread seconds>_<fraction>.
export function slackThreadOf(cwd) {
  const match = String(cwd ?? "").split("/").pop().match(/^([A-Z0-9]+)-(\d+)_(\d+)$/);
  return match ? { channel: match[1], ts: `${match[2]}.${match[3]}` } : null;
}

export const LINKS_W = 264;
// The links popup's height: 6 px padding, a 50 px head, 30 px rows, then a separator and "Copy all".
// The checklist row leads the links and brings its own separator when links follow it.
export function linksMenuHeight(count, checklist = false) {
  return 6 + 50 + (checklist ? 30 + (count ? 9 : 0) : 0) + (count ? count * 30 + 9 + 30 : 30) + 6;
}

// The deadhd plugin's Enable button sends one of these (register.tsx): while a turn runs the prompt is
// queued and tells the skill to leave the checklist off when that work leaves nothing to do.
export const CHECKLIST_PROMPT = "Use the deadhd skill to show this session's checklist.";
export const CHECKLIST_QUEUED_PROMPT = "Use the deadhd skill to show this session's checklist. This request was queued with the enable button while earlier work runs. When that work finishes and nothing is left to do, don't enable it — just reply in one line.";

// A card's links in the order its menu lists them: ticket, pull requests, Slack thread, pages. `hot` is
// the menu's letter key for the first of each kind. `jiraBase` and `slackBase` come from the layout's
// props; with either empty that kind offers no row and no key.
export function linksOf(item, { jiraBase = "", slackBase = "" } = {}) {
  const links = [];
  if (item.jiraKey && jiraBase) links.push({ kind: "jira", label: "Jira ticket", meta: item.jiraKey, url: `${jiraBase}${item.jiraKey}`, hot: "j" });
  (item.prLinks ?? []).forEach((pr, i) => links.push({ kind: "pr", label: "Pull request", meta: pr.tag, url: pr.url, hot: i === 0 ? "p" : null }));
  if (item.slack && slackBase) {
    links.push({ kind: "slack", label: "Slack thread", meta: item.lane ? `${item.lane} lane` : null,
      url: `${slackBase}${item.slack.channel}/p${item.slack.ts.replace(".", "")}`, hot: "s" });
  }
  (item.pages ?? []).filter((page) => page.openable).forEach((page, i) => links.push({ kind: "page", label: page.label || "Page", meta: null, url: page.url, hot: i === 0 ? "g" : null }));
  return links.filter((link) => link.url);
}

// The rail's names for the terminals the cards know: { [address]: { key, rest, topic, slack } }.
export function placesOf(items) {
  const places = {};
  for (const item of items) {
    if (!item.terminal || !item.spot) continue;
    places[item.terminal] = { key: item.spot.key, rest: item.spot.rest, topic: item.topic ?? null, slack: item.spot.slack };
  }
  return places;
}

// A session name someone chose (`claude -n`, `/rename`), not one a launcher generated: those end in
// -MMdd-NN, and Slack thread tabs are mv-<thread seconds>.
export function chosenTitle(name) {
  const text = clean(name);
  if (!text || /-(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])-\d{2}$/.test(text) || /^mv-\d+$/.test(text)) return null;
  return text;
}

// The beach's cast: one entry per visible card, in strip order. `focusOf` says where a
// click on the character goes, and `since` is when the session entered its current state.
export function castOf(groups, selId, focusOf) {
  const cast = [];
  for (const group of groups) {
    for (const item of group.items) {
      const mood = group.id === "done" ? (item.viewed ? "viewed" : "done")
        : group.id === "attention" ? (item.bucket === "stall" ? "stall" : "needs")
          : "working";
      cast.push({
        id: item.sessionId,
        who: charFor(item.charKey),
        mood,
        topic: clip(item.topic ?? item.title, 40),
        focus: focusOf ? focusOf(item) : null,
        selected: item.sessionId === selId,
        since: item.since ?? null,
      });
    }
  }
  return cast;
}

// A group's lane: the two-line stage title, its count and the tooltip naming the group.
export function laneParts(group) {
  return { color: group.color, title: group.title, sub: `${GROUP_SUB[group.id]} ${group.count}`,
    count: String(group.count), tip: group.title };
}

export function emptyText(query, filtering) {
  if (query) return "No matching sessions";
  return filtering ? "Nothing in this filter" : "All quiet for now";
}

export function filterGroups(groups, filter) {
  if (!Array.isArray(filter) || !filter.length) return groups;
  return groups.filter((group) => filter.includes(group.id));
}

// The session the control panel's info area describes: the selected one, else the first
// session waiting for an answer.
export function infoItemOf(groups, selected) {
  if (selected) return selected;
  return (groups ?? []).find((group) => group.id === "attention")?.items[0] ?? null;
}

// The tools role's parts: the branch chip only when the focused pane is on a branch, and the page count.
export function toolsParts(state = {}, branch = "") {
  const pages = Array.isArray(state.pages) ? state.pages : [];
  return { branch: Boolean(branch), pageCount: pages.length + (state.unreadable ?? 0) };
}

// What a session is about, from scan.sh's identity: the handoff it started from, the Slack thread it
// answers, a pasted brief's heading, else the first sentence of its first prompt.
export function topicOf(identity, key = null, objective = null) {
  if (!identity && !objective) return null;
  identity ??= {};
  const first = (value) => String(value).split(/(?<=[.?!])\s/)[0];
  let topic = objective ?? identity.handoff ?? (identity.slack?.topic ? first(identity.slack.topic) : null) ?? identity.paste ?? null;
  if (!topic && identity.firstPrompt) {
    topic = first(String(identity.firstPrompt).replace(/https?:\/\/\S+/g, " ").replace(/\[Image #\d+\]/g, " ").replace(/`/g, "")
      .replace(/(?:~|\/)[\w.-]*(?:\/[\w.-]+){2,}/g, " ").replace(/^\s*\/[\w-]+\s+/, "")
      .split(/\s+/).join(" ").trim().replace(/^(이거|지금|여기|내가|방금|아까)\s+/, ""));
  }
  if (!topic) return null;
  topic = topic.replace(/<@[A-Z0-9]+>/g, "")
    .replace(/\s*[—-]\s*rolling-delivery.*$/i, "").replace(/\s*\(rolling-delivery\)/i, "")
    .replace(/\s*(실행|본)?\s*핸드오프\s*$/, "").replace(/\s*\([^)]*(?:\d{4}-\d\d-\d\d|ts \d)[^)]*\)/g, "");
  topic = clean(topic);
  if (topic && key && topic.toUpperCase().startsWith(key)) topic = clean(topic.slice(key.length).replace(/^[\s—:-]+/, ""));
  return topic;
}

// The card footer's place text: a session that is not Claude Code names its agent first.
export function footerOf(item) {
  const place = item.spot?.label ?? item.place ?? "";
  const agent = item.raw?.agent === "codex" ? "Codex" : item.raw?.agent === "gemini" ? "Gemini" : null;
  if (!agent) return place;
  return place ? `${agent} · ${place}` : agent;
}

// A reply as one plain line: links, markdown marks and list bullets go; a bold heading right before a
// list ("**앞으로 할 것** - …") goes, a bold sentence stays.
export function cleanMessage(value) {
  if (typeof value !== "string") return null;
  return clean(value.replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*[^*]+\*\*\s*(?=-\s)/g, "")
    .replace(/\*\*/g, "").replace(/`/g, "")
    .replace(/(^|\s)-\s+/g, "$1"));
}

function minutesOf(ms) {
  return Math.max(0, Math.floor(ms / 60000));
}

function shortDuration(ms) {
  const minutes = Math.max(1, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function agoText(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function etaText(eta, now) {
  if (!Number.isFinite(eta)) return null;
  const minutes = Math.ceil((eta - now) / 60000);
  return minutes > 0 ? `~${minutes}m left` : null;
}

function trailingComponent(path) {
  const text = String(path ?? "").replace(/\/+$/, "");
  if (!text) return "";
  const parts = text.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function normalizeLabel(value) {
  return String(value ?? "").toLowerCase().replace(/[-_]/g, "");
}

function ackSession(key) {
  const index = key.lastIndexOf("+");
  return index > 0 ? key.slice(0, index) : key;
}

// The tower's session name: the terminal title without leading symbols, else the tab, else the program.
function agentName(a) {
  const live = String(a.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (live && !/^[~/]/.test(live) && !live.includes("@") && live !== a.program?.name) return live;
  return a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : a.program?.name ?? a.address;
}

const ATTACH_GRACE_MS = 15000;

// The pane already running `claude attach` for a background session, from the scan's view of it.
function attachedFocus(where) {
  if (where.paneId && panes().some((candidate) => candidate.pane === where.paneId)) return { pane: where.paneId };
  if (!where.terminalId || !liveTerminals().some((terminal) => terminal.address === where.terminalId)) return null;
  const pane = panes().find((candidate) => candidate.terminal === where.terminalId);
  return pane ? { pane: pane.pane } : { terminal: where.terminalId };
}

function liveTerminals() {
  return terminals().filter((terminal) => terminal.state === "live" && !String(terminal.address ?? "").includes("/"));
}

// The Herdr terminal a Pulse session runs in: by its foreground pid, else by its terminal id.
// The terminal id comes from HC_TERMINAL_ID, which background daemons and forks inherit from the
// terminal they were started in, so it is trusted only while that terminal still sits in the session's folder:
// its foreground process's cwd, or its own, which Herdr keeps from when the terminal started.
export function terminalOf(raw, live) {
  const byPid = live.find((terminal) => Number(terminal.foreground?.pid) === Number(raw.pid));
  if (byPid) return byPid;
  const id = raw.where?.terminalId;
  const terminal = id ? live.find((candidate) => candidate.address === id) : null;
  const folder = (path) => String(path ?? "").replace(/\/+$/, "");
  const here = [terminal?.foreground?.cwd, terminal?.cwd].filter(Boolean).map(folder);
  return terminal && raw.cwd && here.includes(folder(raw.cwd)) ? terminal : null;
}

// Sending a conversation to the background starts a "bg" session (`jobId`) and leaves the interactive
// record frozen at the hand-off, still "busy", with `parkedJobId` naming that job. The pair is one
// conversation: the background session keeps its id and state, takes the terminal and checklist of
// the record it replaced, and the frozen record is dropped.
export function foldHandoffs(sessions) {
  const jobs = new Map(sessions.filter((raw) => raw.kind === "bg" && raw.jobId).map((raw) => [raw.jobId, raw]));
  const heirs = new Map();
  for (const old of sessions) {
    const bg = old.kind !== "bg" && old.parkedJobId ? jobs.get(old.parkedJobId) : null;
    if (bg && !heirs.has(bg)) heirs.set(bg, old);
  }
  if (!heirs.size) return sessions;
  const replaced = new Set(heirs.values());
  return sessions.filter((raw) => !replaced.has(raw)).map((raw) => {
    const old = heirs.get(raw);
    return old ? { ...raw, where: old.where ?? raw.where, deadhd: raw.deadhd ?? old.deadhd } : raw;
  });
}

export const HISTORY_MAX = 50;
const NAV_SETTLE_MS = 1000;

// The terminals visited, in visit order; list[at] is where the user is and the entries after it are the forward ones.
export function visitHistory(history, terminal) {
  if (!terminal || history.list[history.at] === terminal) return history;
  let list = [...history.list.slice(0, history.at + 1), terminal];
  if (list.length > HISTORY_MAX) list = list.slice(list.length - HISTORY_MAX);
  return { list, at: list.length - 1 };
}

// A dead terminal is skipped rather than stopping the walk: the person asked for the previous one still open.
export function stepHistory(history, delta, alive) {
  const { list, at } = history;
  for (let index = at + delta; index >= 0 && index < list.length; index += delta) {
    const terminal = list[index];
    if (alive.has(terminal) && terminal !== list[at]) return { history: { list, at: index }, target: terminal };
  }
  return { history, target: null };
}

// The fade is as wide as the strip's end padding, so it covers only empty canvas until a card scrolls under it.
function edgeFade(side, width) {
  const rect = PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
  const [from, to] = side === "left" ? [INK.surface, `${INK.surface}00`] : [`${INK.surface}00`, INK.surface];
  // Kept 12 px off the top and bottom so its square fill stays clear of the panel's rounded corners.
  return div().absolute().top(12).bottom(12)[side](0).w(width)
    .child(window.paint_path(rect, Background.linear_gradient(90, from, to)).absolute().top(0).left(0).size_full());
}

function backgroundLabel(counts) {
  if (!counts) return null;
  const parts = [];
  if (counts.shells > 0) parts.push(`${counts.shells} shell${counts.shells === 1 ? "" : "s"}`);
  if (counts.agents > 0) parts.push(`${counts.agents} agent${counts.agents === 1 ? "" : "s"}`);
  if (counts.monitors > 0) parts.push(`${counts.monitors} monitor${counts.monitors === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

function keycap(label, k = 1) {
  const g = geometry(k);
  return h_flex().h(g.KEYCAP_H).min_w(g.KEYCAP_H).px(g.KEYCAP_PAD).rounded(g.KEYCAP_RADIUS).border(2).border_color(INK.line).bg(INK.bg)
    .items_center().justify_center()
    .child(div().text_size(g.TEXT.keycap).font_family(DISPLAY).text_color(INK.focus).child(label));
}

function pageIcon(size, color = INK.t3) {
  return svg("mods/workspace-chrome/file-text.svg").size(size).flex_none().text_color(color);
}

// Opens a page URL, then deletes the alert files behind it. Resolves true when it opened.
async function openPageFiles(page) {
  let opened = false;
  try {
    const result = await exec("open", [page.url]);
    opened = result.code === 0;
  } catch {}
  if (!opened) return false;
  try {
    await exec("rm", ["-f", ...(page.files ?? [])]);
  } catch {}
  return true;
}

export default class ArcadeCards extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "cards";
    if (this.role === "head") return;
    if (this.role === "tools") {
      this.handle = cx.focus_handle();
      // The chip's ring comes from is_focused(), and the shell redraws only on notify or reload.
      cx.timer.every(FOCUS_WATCH_MS, (cx) => this.watchToolsFocus(cx));
      return;
    }
    if (this.role === "links") {
      this.handle = cx.focus_handle();
      this.active = 0;
      this.error = null;
      // Focus can't change during render; the timer catches the popup once it is on screen.
      this.handle.focus();
      cx.timer.after(50, () => this.handle.focus());
      return;
    }
    this.knownRepos = Array.isArray(props()?.knownRepos) ? props().knownRepos : [];
    this.jiraBase = props()?.jiraBase ?? "";
    this.slackBase = props()?.slackBase ?? "";
    this.ticketPrefixes = Array.isArray(props()?.ticketPrefixes) ? props().ticketPrefixes : [];
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.wheel = { acc: 0, index: 0, off: 0, at: 0, gesture: false, dir: 0 };
    this.lastFlash = shared(FLASH_KEY)?.token ?? null;
    this.lastNoticeAct = shared(NOTICE_ACT_KEY)?.token ?? null;
    this.blockHeight = null;
    this.k = 1;
    this.geo = geometry(1);
    this.sessions = [];
    this.meta = { roots: 0, pages: [], unreadablePages: [] };
    this.err = null;
    this.notice = null;
    this.sel = null;
    this.selIndex = 0;
    this.handoff = false;
    this.panelHover = null;
    this.infoWidth = 0;
    this.doneCursor = null;
    this.query = "";
    this.expanded = new Set();
    this.stepTop = {};
    this.replyCursor = null;
    this.noticeAction = null;
    this.showAllDone = false;
    this.showKeys = false;
    this.snoozed = {};
    this.since = {}; // agent address -> { s, at }: when this view saw its status change
    this.seen = this.loadSeen();
    this.viewed = this.loadViewed();
    this.scanning = false;
    this.published = null;
    this.history = { list: [], at: -1 };
    this.navTarget = null;
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") {
          this.handle.focus();
          cx.notify();
        } else if (command === "toggle") {
          // Bound to ctrl-alt-p by the "layout:arcade-cards" section of keys.json (see README).
          if (this.handle.is_focused()) run("pane.go", { direction: "down" });
          else this.handle.focus();
          cx.notify();
        } else if (command === "font_in" || command === "font_out" || command === "font_reset") {
          // Bound to cmd-=/cmd-+, cmd-- and cmd-0 in the same keys.json section.
          await this.changeTermFont(command);
        } else if (command === "back" || command === "forward") {
          // Bound to cmd-[ / cmd-] in the same keys.json section, standing in for agent.prev / agent.next.
          this.navigate(command === "back" ? -1 : 1);
        }
      }
    });
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
    // Herdr's pane.go moves focus without notifying this view.
    cx.timer.every(FOCUS_WATCH_MS, (cx) => this.watchFocus(cx));
    this.poll(cx);
  }

  // The block's height is the strip row's, so the strip and its text scale with it.
  sizeChanged(size, cx) {
    if (this.role === "panel" || !(size.height > 0)) return;
    const k = cardsScale(size.height / zoomOf());
    const height = Math.round(k * BASE_BLOCK_H);
    if (height === this.blockHeight) return;
    this.blockHeight = height;
    this.k = k;
    this.geo = geometry(this.k);
    cx.notify();
  }

  // settings.json is the person's file; a stale snapshot is retried like Herdr's Settings does.
  async changeTermFont(command) {
    const file = `${appHome()}/settings.json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await readTextFile(file);
        const person = raw ? JSON.parse(raw) : {};
        const next = nextSettings(person, command, Number(settings()?.font_size) || TERM_FONT);
        if (!next) return;
        await writeTextFile(file, JSON.stringify(next, null, 2) + "\n", raw);
        return;
      } catch {}
    }
  }

  loadSeen() {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((key) => typeof key === "string") : [];
    } catch {
      return [];
    }
  }

  saveSeen() {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(this.seen));
    } catch {}
  }

  loadViewed() {
    try {
      const raw = localStorage.getItem(VIEWED_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((key) => typeof key === "string") : [];
    } catch {
      return [];
    }
  }

  saveViewed() {
    try {
      localStorage.setItem(VIEWED_KEY, JSON.stringify(this.viewed));
    } catch {}
  }

  poll(cx) {
    if (this.scanning) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      let error = null;
      let sessions = this.sessions;
      let meta = this.meta;
      try {
        const result = await exec("sh", [`${appHome()}/mods/arcade-cards/scan.sh`]);
        if (result.code !== 0) {
          throw new Error((result.stderr || result.stdout || "").trim() || `scan.sh exited ${result.code}`);
        }
        const parsed = this.parseScan(result.stdout ?? "");
        if (!parsed.meta) throw new Error("scan.sh returned no meta line");
        sessions = parsed.sessions;
        meta = parsed.meta;
      } catch (error_) {
        error = String(error_?.message ?? error_);
      }
      this.scanning = false;
      if (error) {
        this.err = String(error).replace(/\.$/, "");
      } else {
        this.err = meta.error ? String(meta.error).replace(/\.$/, "") : null;
        this.sessions = sessions;
        this.meta = meta;
        this.pruneSeen();
      }
      cx.notify();
    });
  }

  parseScan(output) {
    const sessions = [];
    let meta = null;
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (value?.t === "s") sessions.push(value);
      else if (value?.t === "meta") meta = value;
    }
    return { sessions, meta };
  }

  pruneSeen() {
    const live = new Set(this.sessions.map((session) => session.sessionId));
    for (const a of agents()) live.add(`agent:${a.address}`);
    const kept = this.seen.filter((key) => live.has(ackSession(key)));
    if (kept.length !== this.seen.length) {
      this.seen = kept;
      this.saveSeen();
    }
    const viewed = this.viewed.filter((key) => live.has(ackSession(key)));
    if (viewed.length !== this.viewed.length) {
      this.viewed = viewed;
      this.saveViewed();
    }
  }

  flash(cx, message, action = null, ms = 4000) {
    const token = {};
    this.notice = message;
    this.noticeAction = action;
    this.noticeToken = token;
    cx.notify();
    cx.timer.after(ms, (later) => {
      if (this.noticeToken === token) {
        this.notice = null;
        this.noticeAction = null;
        later.notify();
      }
    });
  }

  undoNotice() {
    if (!this.noticeAction) return;
    this.noticeAction.run();
    this.notice = null;
    this.noticeAction = null;
  }

  // Herdr agents Pulse doesn't list, as cards: blocked -> Needs you, working -> Working,
  // done and idle -> Done. Claude Code agents are left to Pulse's own rows.
  agentItems(now, claimed) {
    const items = [];
    const list = agents();
    const present = new Set(list.map((a) => a.address));
    for (const address of Object.keys(this.since)) if (!present.has(address)) delete this.since[address];
    for (const a of list) {
      if (this.since[a.address]?.s !== a.status) this.since[a.address] = { s: a.status, at: now };
      if (claimed.has(a.address) || a.app === "claude-code") continue;
      const group = a.status === "blocked" ? "attention" : a.status === "working" ? "working" : "done";
      const since = this.since[a.address].at;
      const sessionId = `agent:${a.address}`;
      const ackKey = `${sessionId}+${a.seq}`;
      items.push({
        sessionId,
        pid: null,
        agent: a,
        raw: { status: a.status, cwd: null, name: agentName(a) },
        bucket: group === "attention" ? "wait" : group,
        group,
        title: clip(agentName(a), 60) ?? a.address,
        since,
        updatedAt: since,
        sortDate: since,
        place: clip(a.space_name, 40),
        spot: { key: null, rest: null, repo: null, label: clip(a.space_name, 40), slack: false },
        topic: null,
        round: null,
        lane: null,
        keyTag: null,
        jiraKey: null,
        prTag: null,
        extraPRs: [],
        prLinks: [],
        slack: null,
        hasChecklist: false,
        counts: null,
        total: null,
        progress: null,
        stepStates: null,
        steps: [],
        progressStale: false,
        blocked: group === "attention",
        eta: null,
        nowLabel: null,
        nowLine: a.program?.name ? `${a.program.name} is working` : null,
        answer: "Waiting for your reply",
        prompt: null,
        replyTail: null,
        lastSentence: null,
        background: null,
        pages: [],
        where: { kind: "herdr", terminalId: a.address },
        terminal: a.address,
        ackKey,
        viewed: this.viewed.includes(ackKey),
        badge: "herdr",
        charKey: a.address,
      });
    }
    return items;
  }

  buildModel(now) {
    const seen = new Set(this.seen);
    const live = liveTerminals();
    const claimed = new Set();
    const items = [];
    for (const raw of foldHandoffs(this.sessions)) {
      const deadhd = raw.deadhd ?? null;
      const hasChecklist = Boolean(deadhd && !deadhd.off && deadhd.counts && (deadhd.total ?? 0) > 0);
      const counts = hasChecklist ? deadhd.counts : null;
      const background = raw.background ?? { shells: 0, agents: 0, monitors: 0, total: 0 };
      const terminal = terminalOf(raw, live);
      if (terminal) claimed.add(terminal.address);

      let bucket;
      if (raw.status === "waiting") bucket = "wait";
      else if (raw.status === "busy") {
        const hasBackground = (background.total ?? 0) > 0;
        const last = raw.lastMeaningfulAt;
        bucket = !hasBackground && last && now - last > STALL_MS ? "stall" : "working";
      } else if (raw.status === "shell") {
        bucket = (counts?.blocked ?? 0) > 0 ? "wait" : "working";
      } else if (raw.status === "idle") {
        bucket = "done";
      } else {
        bucket = "working";
      }
      // A native agent's approval prompt is never on disk; when the agent reports to Herdr, its
      // blocked status is what tells us the session is waiting for the person.
      if (raw.agent && raw.agent !== "claude" && terminal) {
        const spoke = agents().find((entry) => entry.address === terminal.address);
        if (spoke?.status === "blocked") bucket = "wait";
      }

      let group = bucket === "wait" || bucket === "stall" ? "attention" : bucket === "done" ? "done" : "working";
      if (group === "attention" && bucket === "stall" && (this.snoozed[raw.sessionId] ?? 0) > now) {
        group = "working";
      }

      const since = raw.statusUpdatedAt ?? raw.startedAt ?? null;
      const updatedAt = Math.max(raw.statusUpdatedAt ?? 0, raw.lastMeaningfulAt ?? 0) || null;
      const title = clip(firstNonEmpty(
        hasChecklist ? deadhd.title : null,
        raw.customTitle,
        raw.agentName,
        raw.name,
        raw.lastPrompt ? clip(raw.lastPrompt, 60) : null,
      ), 60) ?? "Untitled session";

      const location = clip(raw.location, 40);
      const place = location && normalizeLabel(location) !== normalizeLabel(title) ? location : null;
      const keyTag = deadhd?.key && deadhd.key.toLowerCase() !== title.trim().toLowerCase() ? deadhd.key : null;
      const identity = raw.identity ?? null;
      const spot = placeOf(raw.cwd, identity?.slack ?? null, this.knownRepos, this.ticketPrefixes);
      if (!spot.key && !spot.slack && deadhd?.key) spot.key = String(deadhd.key).toUpperCase();
      const topic = clip(firstNonEmpty(chosenTitle(raw.customTitle), hasChecklist ? deadhd.title : null, topicOf(identity, spot.key, spot.key ? this.meta?.objectives?.[spot.key] : null)), 120);
      const round = spot.key && Number.isFinite(identity?.round) ? identity.round : null;
      const lane = clean(identity?.slack?.lane);

      const prs = [];
      if (hasChecklist && deadhd.pr?.href) {
        prs.push({ url: deadhd.pr.href, label: deadhd.pr.text ?? null, number: deadhd.pr.number ?? 0 });
      }
      if (raw.pr?.url && !prs.some((pr) => pr.url === raw.pr.url)) {
        prs.push({ url: raw.pr.url, label: raw.pr.label ?? null, number: raw.pr.number ?? 0 });
      }
      const prRepo = (url) => String(url ?? "").split("/")[4] ?? null;
      const prTag = prs[0] ? (prs[0].label ?? (prs[0].number
        ? `${spot.repo && prRepo(prs[0].url) && prRepo(prs[0].url) !== spot.repo ? prRepo(prs[0].url) : ""}#${prs[0].number}`
        : null)) : null;
      const extraPRs = prs.slice(1).map((pr) => pr.label ?? (pr.number ? `#${pr.number}` : pr.url)).filter(Boolean);

      const progress = hasChecklist && (deadhd.total ?? 0) > 0
        ? { done: Math.max(0, counts.done), total: deadhd.total }
        : null;
      const steps = hasChecklist && Array.isArray(deadhd.items) ? deadhd.items : [];
      const eta = hasChecklist && Number.isFinite(deadhd.eta) ? etaText(deadhd.eta, now) : null;
      const nowLabel = clean(hasChecklist ? deadhd.nowLabel : null);
      const currentAction = clean(raw.currentAction);
      const lastSentence = clean(raw.lastSentence);
      let nowLine = null;
      if (nowLabel) nowLine = `▶ ${nowLabel}`;
      else if (currentAction) nowLine = currentAction;
      else if (lastSentence) nowLine = lastSentence;

      let answer;
      if (bucket === "stall") {
        const quiet = Math.max(1, minutesOf(now - (raw.lastMeaningfulAt ?? since ?? now)));
        answer = `No new activity for ${quiet} minute${quiet === 1 ? "" : "s"}. Check whether it is stuck`;
      } else if (hasChecklist && (counts?.blocked ?? 0) > 0 && deadhd.blockedAsk) {
        answer = deadhd.blockedAsk;
      } else {
        answer = clean(raw.lastAnswer)
          ?? (raw.waitingFor === "permission prompt" ? "Waiting for permission approval" : "Waiting for your reply");
      }

      const pages = Array.isArray(raw.pages) ? raw.pages : [];
      const ackKey = `${raw.sessionId}+${since != null ? Math.floor(since / 1000) : "none"}`;
      const sortDate = since ?? updatedAt;

      if (group === "done") {
        if (seen.has(ackKey)) continue;
        if (sortDate == null || now - sortDate > DONE_WINDOW_MS) continue;
      }

      items.push({
        sessionId: raw.sessionId,
        pid: raw.pid,
        raw,
        bucket,
        group,
        title,
        since,
        updatedAt,
        sortDate,
        place,
        spot,
        topic,
        round,
        lane,
        keyTag,
        jiraKey: deadhd?.key ?? spot.key ?? null,
        prTag,
        extraPRs,
        prLinks: prs.map((pr, i) => ({ url: pr.url, tag: (i === 0 ? prTag : extraPRs[i - 1]) ?? pr.url })),
        slack: spot.slack ? slackThreadOf(raw.cwd) : null,
        hasChecklist,
        counts,
        total: deadhd?.total ?? null,
        progress,
        stepStates: deadhd?.states ?? null,
        steps,
        progressStale: Boolean(deadhd?.dataAt && now - deadhd.dataAt > STALE_MS),
        blocked: (counts?.blocked ?? 0) > 0,
        eta,
        nowLabel,
        nowLine,
        answer,
        replyTail: clean(raw.lastAnswer),
        lastSentence,
        background,
        pages,
        where: raw.where ?? {},
        ackKey,
        viewed: this.viewed.includes(ackKey),
        badge: BADGES[raw.where?.kind] ?? null,
        terminal: terminal?.address ?? null,
        charKey: terminal?.address ?? raw.sessionId,
      });
    }

    for (const item of this.agentItems(now, claimed)) {
      if (item.group === "done" && (seen.has(item.ackKey) || now - item.sortDate > DONE_WINDOW_MS)) continue;
      items.push(item);
    }

    const sortAsc = (a, b) => {
      if (a.sortDate == null && b.sortDate == null) return a.sessionId < b.sessionId ? -1 : 1;
      if (a.sortDate == null) return 1;
      if (b.sortDate == null) return -1;
      if (a.sortDate !== b.sortDate) return a.sortDate - b.sortDate;
      return a.sessionId < b.sessionId ? -1 : 1;
    };
    const sortDesc = (a, b) => {
      if (a.sortDate == null && b.sortDate == null) return a.sessionId < b.sessionId ? -1 : 1;
      if (a.sortDate == null) return 1;
      if (b.sortDate == null) return -1;
      if (a.sortDate !== b.sortDate) return b.sortDate - a.sortDate;
      return a.sessionId < b.sessionId ? -1 : 1;
    };

    // Replies first, then stalls, so Space (which skips stalls) always starts at the leftmost card.
    const stalled = (item) => (item.bucket === "stall" ? 1 : 0);
    const attention = items.filter((item) => item.group === "attention").sort((a, b) => stalled(a) - stalled(b) || sortAsc(a, b));
    const working = items.filter((item) => item.group === "working").sort(sortAsc);
    const done = items.filter((item) => item.group === "done").sort(sortDesc);
    return {
      attention,
      working,
      done,
      counts: { attention: attention.length, working: working.length, done: done.length },
    };
  }

  matches(item, tokens) {
    if (!tokens.length) return true;
    const fields = [
      item.title,
      item.topic,
      item.place,
      item.spot?.label,
      trailingComponent(item.raw.cwd),
      item.raw.name,
      item.keyTag,
      item.jiraKey,
      item.prTag,
      ...item.extraPRs,
    ].filter(Boolean).map(fold);
    return tokens.every((token) => fields.some((field) => field.includes(token)));
  }

  viewData(now = Date.now()) {
    const model = this.buildModel(now);
    this.places = placesOf([...model.attention, ...model.working, ...model.done]);
    const tokens = fold(this.query).split(/\s+/).filter(Boolean);
    const filter = (list) => (tokens.length ? list.filter((item) => this.matches(item, tokens)) : list);
    const attention = filter(model.attention);
    const working = filter(model.working);
    const doneAll = filter(model.done);
    const doneVisible = this.showAllDone || tokens.length ? doneAll : doneAll.slice(0, MAX_DONE);
    const hiddenDone = doneAll.length - doneVisible.length;
    const groups = [
      { id: "attention", title: GROUP_TITLE.attention, color: GROUP_COLOR.attention, items: attention, count: attention.length },
      { id: "working", title: GROUP_TITLE.working, color: GROUP_COLOR.working, items: working, count: working.length },
      { id: "done", title: GROUP_TITLE.done, color: GROUP_COLOR.done, items: doneVisible, count: doneAll.length },
    ];
    const shown = filterGroups(groups, shared("arcade-filter"));
    const doneShown = shown.some((group) => group.id === "done");
    return { model, groups: shown, allGroups: groups, hiddenDone: doneShown ? hiddenDone : 0, now, counts: model.counts };
  }

  stepWindow(steps) {
    const states = steps.map((step) => step.state);
    const total = states.length;
    const first = (state) => { const at = states.indexOf(state); return at >= 0 ? at : null; };
    const focus = first("now") ?? first("side") ?? first("blocked") ?? first("left") ?? total - 1;
    return { total, focus };
  }

  stepMaxTop(item) {
    return Math.max(0, item.steps.length - STEP_ROWS);
  }

  openSteps(item) {
    const { focus } = this.stepWindow(item.steps);
    this.stepTop[item.sessionId] = Math.min(Math.max(focus - 1, 0), this.stepMaxTop(item));
    this.expanded.add(item.sessionId);
  }

  scrollSteps(item, delta) {
    const top = this.stepTop[item.sessionId] ?? 0;
    this.stepTop[item.sessionId] = Math.max(0, Math.min(this.stepMaxTop(item), top + delta));
  }

  // A checklist can lose steps while the column is open, so the top is clamped here too.
  visibleSteps(item) {
    const top = Math.min(this.stepTop[item.sessionId] ?? 0, this.stepMaxTop(item));
    return item.steps.slice(top, top + STEP_ROWS);
  }

  stepCounter(item) {
    const shown = this.visibleSteps(item).length;
    if (shown >= item.steps.length) return null;
    const top = Math.min(this.stepTop[item.sessionId] ?? 0, this.stepMaxTop(item));
    return `${top + 1}–${top + shown} / ${item.steps.length}`;
  }

  // The strip's items, left to right: one per card plus a "N more" tile after Done. Each
  // carries its width (its left gap included) so the virtual list can place it.
  buildStrip(data) {
    const g = this.geo ?? geometry(1);
    const strip = [];
    let firstGroup = true;
    let player = 0;
    for (const group of data.groups) {
      if (!group.items.length) continue;
      group.items.forEach((item, index) => {
        const lead = index > 0 ? g.CARD_GAP : firstGroup ? g.PAD_X : g.GROUP_GAP;
        const lane = index === 0 ? g.LANE_W : 0;
        const open = this.expanded.has(item.sessionId) && item.steps.length > 0;
        player += 1;
        strip.push({
          kind: "card", item, group, head: index === 0, lead: lead + lane, player,
          w: lead + lane + g.CARD_W + (open ? g.STEPS_W : 0), key: `card-${item.sessionId}`,
        });
      });
      if (group.id === "done" && data.hiddenDone > 0) {
        strip.push({ kind: "more", group, head: false, lead: g.CARD_GAP, w: g.CARD_GAP + g.MORE_W, key: "more-done", count: data.hiddenDone });
      }
      firstGroup = false;
    }
    if (strip.length) strip[strip.length - 1].w += g.PAD_X;
    return strip;
  }

  // The control panel's buttons: every shown group in order, its sessions numbered P1 upward
  // across the groups. Empty groups draw no plate.
  panelGroups(groups) {
    let player = 0;
    return (groups ?? []).filter((group) => group.items.length).map((group) => ({
      id: group.id,
      title: group.title,
      color: group.color,
      items: group.items.map((item) => ({ item, player: (player += 1) })),
    }));
  }

  focusKey() {
    return `${Boolean(this.handle?.is_focused?.())}|${focused()?.terminal ?? ""}`;
  }

  // The to-read chip has its own ring, and its copy of this view has no other timer to notice a focus change.
  watchToolsFocus(cx) {
    const key = this.handle?.is_focused?.() ? "1" : "0";
    if (key === this.drawnFocus) return;
    this.drawnFocus = key;
    cx.notify();
  }

  watchFocus(cx) {
    this.trackVisit();
    if (this.focusKey() !== this.drawnFocus) cx.notify();
    // The head's tools copy has no legend of its own, so a chip click hands its notice here.
    const flash = shared(FLASH_KEY);
    if (flash?.token && flash.token !== this.lastFlash) {
      this.lastFlash = flash.token;
      this.flash(cx, flash.message);
    }
    const noticeAct = shared(NOTICE_ACT_KEY);
    if (noticeAct?.token && noticeAct.token !== this.lastNoticeAct) {
      this.lastNoticeAct = noticeAct.token;
      if (noticeAct.act === "retry") {
        this.err = null;
        this.poll(cx);
      } else if (noticeAct.act === "undo") {
        this.undoNotice();
      }
      cx.notify();
    }
  }

  // After a back/forward, the terminal being left can still show as focused for a few watches; recording it
  // would drop the forward entries. So until the target shows (or NAV_SETTLE_MS passes) nothing is recorded.
  trackVisit(now = Date.now()) {
    const terminal = focused()?.terminal ?? null;
    if (!terminal) return;
    if (this.navTarget) {
      if (terminal === this.navTarget) {
        this.navTarget = null;
        return;
      }
      if (now < this.navUntil) return;
      this.navTarget = null;
    }
    this.history = visitHistory(this.history, terminal);
  }

  navigate(delta) {
    const alive = new Set(liveTerminals().map((terminal) => terminal.address));
    const { history, target } = stepHistory(this.history, delta, alive);
    if (!target) return;
    this.history = history;
    this.navTarget = target;
    this.navUntil = Date.now() + NAV_SETTLE_MS;
    run("pane.focus", { terminal: target });
  }

  // While the strip doesn't have the keyboard, the selection moves to the card of the pane that just took focus.
  // A pane whose card hasn't been scanned yet stays pending, so the card is chosen once it appears.
  followFocus(data) {
    const terminal = focused()?.terminal ?? null;
    if (terminal === this.followed) return;
    if (!terminal || this.handle?.is_focused()) {
      this.followed = null;
      return;
    }
    const item = data.groups.flatMap((group) => group.items).find((row) => row.terminal === terminal);
    if (!item) return;
    this.followed = terminal;
    this.markViewed(item);
    this.sel = item.sessionId;
    this.reveal(item.sessionId, data);
  }

  selectedItem(data) {
    const rows = data.groups.flatMap((group) => group.items);
    if (this.sel === NONE) return null;
    // Nothing chosen yet starts at the first card. A card dismissed from the strip, or filtered out by the
    // search, hands the selection to the card now in its place; a card whose session ended on its own leaves nothing selected, so no other session looks
    // like the one closing.
    const kept = rows.find((item) => item.sessionId === this.sel);
    if (kept || !(this.sel == null || this.handoff || this.query)) return kept ?? null;
    return rows[Math.min(this.selIndex, rows.length - 1)] ?? null;
  }

  reveal(sessionId, data) {
    const strip = this.buildStrip(data);
    const index = strip.findIndex((entry) => entry.kind === "card" && entry.item.sessionId === sessionId);
    if (index < 0) return;
    this.scroll.scroll_to_item(index, "center");
    // Centring moves the left edge; the wheel continues from the offset it lands on.
    if (!this.wheel) return;
    const widths = strip.map((entry) => entry.w);
    const centered = centeredOffset(index, widths, this.wheel.viewportW);
    if (centered == null) {
      this.wheel.index = index;
      return;
    }
    this.wheel.off = centered;
    this.wheel.index = leftIndexAt(centered, widths);
  }

  markViewed(item) {
    if (!item || item.group !== "done") return false;
    if (this.viewed.includes(item.ackKey)) return false;
    this.viewed = [...this.viewed, item.ackKey];
    this.saveViewed();
    return true;
  }

  markSeen(item, cx) {
    if (!item || item.group !== "done") return false;
    if (this.seen.includes(item.ackKey)) return false;
    this.seen = [...this.seen, item.ackKey];
    this.saveSeen();
    const key = item.ackKey;
    if (cx) this.flash(cx, "Marked as seen", { label: "Undo", run: () => {
      this.seen = this.seen.filter((candidate) => candidate !== key);
      this.saveSeen();
    } }, UNDO_MS);
    return true;
  }

  acknowledge(item, cx) {
    if (!item) return;
    let left = false;
    if (item.group === "done") left = this.markSeen(item, cx);
    else if (item.group === "attention" && item.bucket === "stall") left = this.snooze(item);
    if (left && item.sessionId === this.sel) this.handoff = true;
  }

  // Space: the session that has waited longest for a reply, cycling on repeat; stalls are skipped.
  // Shift+Space: every Done card from the right end (the oldest) leftward, cycling on repeat, viewed or
  // not. Dimming only marks a card as opened; ⌫ is what takes one out of the cycle.
  jump(kind, data, cx) {
    let target = null;
    if (kind === "reply") {
      const candidates = data.model.attention.filter((item) => item.bucket !== "stall");
      if (candidates.length) {
        const at = candidates.findIndex((item) => item.sessionId === this.replyCursor);
        target = at < 0 ? candidates[0] : candidates[(at + 1) % candidates.length];
        this.replyCursor = target.sessionId;
      }
    } else {
      const candidates = [...data.model.done].reverse();
      if (candidates.length) {
        const at = candidates.findIndex((item) => item.sessionId === this.doneCursor);
        target = at < 0 ? candidates[0] : candidates[(at + 1) % candidates.length];
        this.doneCursor = target.sessionId;
      }
    }
    if (!target) {
      this.flash(cx, kind === "reply" ? "No session is waiting for a reply — check back later" : "No finished session — finish a turn first");
      return;
    }
    this.goTo(target, cx);
    if (kind === "done") this.showAllDone = true;
    this.sel = target.sessionId;
    this.reveal(target.sessionId, data);
  }

  snooze(item) {
    if (!item || item.bucket !== "stall") return false;
    this.snoozed[item.sessionId] = Date.now() + SNOOZE_MS;
    return true;
  }

  // Where goTo would put the keyboard: the agent's pane, else the terminal's pane, else the
  // terminal itself. tmux, Orca and unfound sessions answer null.
  focusOf(item) {
    if (!item) return null;
    if (item.agent?.pane) return { pane: item.agent.pane };
    const where = item.where ?? {};
    if (where.kind === "claude-bg") return attachedFocus(where);
    const terminal = terminalOf(item.raw ?? item, liveTerminals());
    if (!terminal) return null;
    const pane = panes().find((candidate) => candidate.terminal === terminal.address);
    return pane ? { pane: pane.pane } : { terminal: terminal.address };
  }

  goTo(item, cx) {
    if (!item) return;
    if (item.group === "done") this.markViewed(item);
    if (item.agent) {
      run("pane.focus", { pane: item.agent.pane });
      return;
    }
    const terminal = terminalOf(item.raw ?? item, liveTerminals());
    if (terminal) {
      const pane = panes().find((candidate) => candidate.terminal === terminal.address);
      run("pane.focus", pane ? { pane: pane.pane } : { terminal: terminal.address });
      return;
    }
    const where = item.where ?? {};
    if (where.kind === "claude-bg") {
      const focus = attachedFocus(where);
      if (focus) {
        run("pane.focus", focus);
        return;
      }
      // The scan that would report the new attach pane runs seconds later; a second click meanwhile must not open another.
      const opened = this.attachOpened?.[where.attachId];
      if (opened && Date.now() - opened < ATTACH_GRACE_MS) return;
      this.attachOpened = { ...this.attachOpened, [where.attachId]: Date.now() };
      run("pane.split", { direction: "right", argv: ["claude", "attach", where.attachId] });
      return;
    }
    if (where.kind === "tmux" && where.paneId) {
      const base = where.socket ? ["-S", where.socket] : [];
      const calls = [
        ["switch-client", "-t", where.paneId],
        ["select-window", "-t", where.paneId],
        ["select-pane", "-t", where.paneId],
      ];
      cx.spawn(async () => {
        for (const call of calls) {
          try {
            await exec("tmux", [...base, ...call]);
          } catch {}
        }
      });
      return;
    }
    if (where.handle) {
      cx.spawn(async (later) => {
        try {
          const result = await exec("/Applications/Orca.app/Contents/Resources/bin/orca",
            ["terminal", "switch", "--terminal", where.handle, "--json"]);
          if (result.code !== 0) this.flash(later, "Not in Herdr, tmux or Orca — open the session's terminal first");
          else await exec("open", ["-a", "Orca"]);
        } catch {
          this.flash(later, "Not in Herdr, tmux or Orca — open the session's terminal first");
        }
      });
      return;
    }
    this.flash(cx, "Not in Herdr, tmux or Orca — open the session's terminal first");
  }

  pageGroup(item) {
    return item?.pages?.[0] ?? null;
  }

  dropPage(page) {
    const same = (candidate) => candidate
      && candidate.pageId === page.pageId
      && candidate.worktree === page.worktree
      && candidate.url === page.url;
    if (this.meta?.pages) this.meta.pages = this.meta.pages.filter((candidate) => !same(candidate));
    for (const session of this.sessions) {
      if (Array.isArray(session.pages)) session.pages = session.pages.filter((candidate) => !same(candidate));
    }
  }

  openPage(page, cx) {
    if (!page) {
      this.flash(cx, "No page to open — try again after the scan");
      return;
    }
    if (!page.openable) {
      this.flash(cx, "Couldn't open this page — check the file still exists");
      return;
    }
    cx.spawn(async (later) => {
      if (!(await openPageFiles(page))) {
        this.flash(later, "Couldn't open this page — check the file still exists");
        return;
      }
      this.dropPage(page);
      later.notify();
      this.poll(later);
    });
  }

  openOldestPage(cx) {
    const pages = this.meta?.pages ?? [];
    if (!pages.length) {
      this.flash(cx, "No page to open — try again after the scan");
      return;
    }
    this.openPage(pages[0], cx);
  }

  key(event, cx) {
    const modifiers = event.modifiers ?? {};
    const alt = Boolean(modifiers.alt);
    const shift = Boolean(modifiers.shift);
    const command = Boolean(modifiers.platform);
    const control = Boolean(modifiers.control);
    const key = event.key;
    const data = this.viewData();
    const items = data.groups.flatMap((group) => group.items);
    const selected = this.selectedItem(data);
    if (selected && this.sel !== selected.sessionId) this.sel = selected.sessionId;
    const index = items.findIndex((item) => item.sessionId === selected?.sessionId);

    const choose = (next) => {
      if (!items.length) return;
      const target = items[Math.max(0, Math.min(items.length - 1, next))];
      this.sel = target.sessionId;
      this.reveal(target.sessionId, data);
    };

    const plain = !command && !control && !alt;
    const searching = Boolean(this.query);
    let handled = true;
    if (key === "p" && control && alt && !command) {
      // ctrl-alt-p while the strip has the keyboard: the keys.json binding alone does not hand it back,
      // so the strip does it itself, like Esc's last step.
      run("pane.go", { direction: "down" });
    } else if (key === "escape") {
      const chipFilter = shared("arcade-filter");
      if (searching) this.query = "";
      else if (Array.isArray(chipFilter) && chipFilter.length) setShared("arcade-filter", []);
      else if (this.sel !== NONE && selected) this.sel = NONE;
      else {
        run("pane.go", { direction: "down" });
        handled = false;
      }
    } else if (key === "backspace" && plain) {
      if (searching) this.query = this.query.slice(0, -1);
      else if (!event.is_held) this.acknowledge(selected, cx);
    } else if (key === "backspace" && searching && command && !control && !alt) {
      this.query = "";
    } else if (key === "backspace" && searching && alt && !command && !control) {
      this.query = this.query.replace(/\S*\s*$/, "");
    } else if (key === "left" && alt) choose(0);
    else if (key === "right" && alt) choose(items.length - 1);
    else if (key === "left") choose(index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length);
    else if (key === "right") {
      if (index === items.length - 1 && data.hiddenDone > 0) {
        this.showAllDone = true;
        const next = this.viewData();
        const target = next.groups.flatMap((group) => group.items)[items.length];
        if (target) {
          this.sel = target.sessionId;
          this.reveal(target.sessionId, next);
        }
      } else choose(index < 0 ? 0 : (index + 1) % items.length);
    } else if (key === "down") {
      if (selected?.steps.length) {
        if (this.expanded.has(selected.sessionId)) this.scrollSteps(selected, 1);
        else {
          this.openSteps(selected);
          this.reveal(selected.sessionId, this.viewData());
        }
      } else handled = false;
    } else if (key === "up") {
      if (selected?.steps.length && this.expanded.has(selected.sessionId)) {
        if ((this.stepTop[selected.sessionId] ?? 0) > 0) this.scrollSteps(selected, -1);
        else {
          this.expanded.delete(selected.sessionId);
          this.reveal(selected.sessionId, this.viewData());
        }
      } else handled = false;
    } else if (key === "enter") {
      if (command && !shift && !control && !alt) {
        // macOS has no context-menu key, so ⌘↩ opens the menu a right-click on the card opens.
        if (selected) this.openLinks(`card-${selected.sessionId}`, cx, this.cardMenuAt(selected.sessionId));
      } else if (shift) {
        const page = selected && selected.group !== "done" ? this.progressTarget(selected) : this.pageGroup(selected);
        if (page) this.openPage(page, cx);
        else this.flash(cx, "This row has no page — pick a card that has one");
      } else this.goTo(selected, cx);
    } else if (key === "space" && plain && !searching) {
      this.jump(shift ? "done" : "reply", data, cx);
    } else if ((key === "?" || (key === "/" && shift)) && !searching) {
      this.showKeys = !this.showKeys;
    } else if (key === "tab" && plain && !shift) {
      if (searching) handled = false;
      else this.openOldestPage(cx);
    } else if (key === "z" && command && !shift && !control && !alt) {
      // The Undo button lives in the tab bar, out of the strip's keyboard reach, so ⌘Z stands in for it.
      if (this.noticeAction) this.undoNotice();
      else handled = false;
    } else if (event.key_char && event.key_char.length === 1 && plain) {
      if (searching || event.key_char.trim()) this.query += event.key_char;
      else handled = false;
    } else {
      handled = false;
    }

    if (handled) {
      cx.stop_propagation();
      cx.notify();
    }
  }

  // What the head copy draws: published only when it changes, since setShared redraws every mod.
  publish(data, focused) {
    const selShown = (data.groups ?? []).some((group) => group.items.some((item) => item.sessionId === this.sel));
    const value = {
      query: this.query,
      focused,
      pages: this.meta?.pages ?? [],
      unreadable: this.meta?.unreadablePages?.length ?? 0,
      places: this.places ?? {},
      cast: castOf(data.allGroups ?? data.groups, selShown ? this.sel : NONE, (item) => this.focusOf(item)),
    };
    const text = JSON.stringify(value);
    if (text === this.published) return;
    this.published = text;
    setShared(SHARED_KEY, value);
  }

  // The tab bar draws the notice as a pill in the head row, so the strip hands it over the same way.
  publishNotice() {
    const value = this.err
      ? { tone: "err", text: this.err, action: "Retry" }
      : this.notice
        ? { tone: "note", text: this.notice, action: this.noticeAction?.label ?? null }
        : null;
    const text = JSON.stringify(value);
    if (text === this.publishedNotice) return;
    this.publishedNotice = text;
    setShared(NOTICE_KEY, value);
  }

  // ---- card ----

  tone(item) {
    if (item.group === "done") return TONE.done;
    if (item.group === "working") return TONE.working;
    return item.bucket === "stall" ? TONE.stall : TONE.needs;
  }

  timeText(item, now) {
    if (item.group === "done") return item.sortDate != null ? agoText(now - item.sortDate) : "";
    if (item.group === "working") return item.eta ?? (item.since != null ? shortDuration(now - item.since) : "");
    if (item.bucket === "stall") return `quiet ${shortDuration(now - (item.raw.lastMeaningfulAt ?? item.since ?? now))}`;
    return item.since != null ? shortDuration(now - item.since) : "";
  }

  // The card's head: the player's face with its P number, then the ticket key and the topic over
  // its place. Named apart from the props role's `head()` — two class methods of one name would
  // silently leave only the later definition, and the card would show the space name instead.
  cardHead(item, tone, player) {
    const g = this.geo ?? geometry(1);
    const tag = this.keyTagOf(item);
    const who = charFor(item.charKey);
    const topic = wrapLines(item.topic ?? item.title, g.TEXT.topic, g.COL_W, 1);
    return h_flex().h(g.HEAD_H).flex_none().gap(g.FACE_PAD).items_center()
      .child(div().relative().size(g.FACE).flex_none().border(2).border_color(tone.ink).bg(INK.bg).overflow_hidden()
        .when(item.bucket === "stall", (element) => element.opacity(0.55))
        .child(image(`mods/arcade-rail/faces/${who}.png`).size(g.FACE))
        .child(div().absolute().left(0).top(0).px(g.CHIP_PAD).bg(INK.bg).border_r(2).border_b(2).border_color(tone.ink)
          .text_size(g.TEXT.badge).font_family(DISPLAY).text_color(tone.ink).child(`P${player}`)))
      .child(v_flex().flex_1().min_w(0)
        .when(Boolean(tag), (el) => el.child(h_flex().h(g.TOPIC_LINE).min_w(0).gap(g.TAG_GAP).items_center()
          .child(div().flex_none().text_size(g.TEXT.key).font_family(DISPLAY).text_color(tone.ink).child(tag.head))
          .when(Boolean(tag.sub), (row) => row.child(div().min_w(0).truncate().text_size(g.TEXT.tagSub)
            .font_family(FONT).text_color(INK.t3).child(tag.sub)))))
        .when(Boolean(topic.length), (el) => el.child(div().h(g.TOPIC_LINE).min_w(0).truncate().text_size(g.TEXT.topic)
          .font_family(FONT).text_color(INK.t2).child(topic[0])))
        .child(div().h(g.TOPIC_LINE).min_w(0).truncate().text_size(g.TEXT.foot).font_family(FONT)
          .text_color(INK.t3).child(footerOf(item))));
  }

  // The tray's chips. A PR the band tag already shows stays out; a Slack thread band shows only its lane.
  trayChips(item) {
    const background = item.group !== "attention" ? backgroundLabel(item.background) : null;
    const loosePR = this.keyTagOf(item) && !item.spot?.slack ? null : item.prTag;
    return [background, loosePR, ...item.extraPRs.slice(0, 1).map((pr) => `+${item.extraPRs.length} ${pr}`)].filter(Boolean);
  }

  keyTagOf(item) {
    const head = item.spot?.key ?? (item.spot?.slack ? "Slack" : null);
    if (!head) return null;
    const sub = item.spot.slack
      ? (item.lane ? `${item.lane} lane` : null)
      : [item.round ? `Round ${item.round}` : null, item.prTag].filter(Boolean).join(" · ") || null;
    return { head, sub };
  }

  metaText(item) {
    return [item.spot?.key, item.spot?.label ?? item.place, item.prTag].filter(Boolean).join("  ·  ");
  }

  progressRow(item) {
    const g = this.geo ?? geometry(1);
    const total = item.progress?.total ?? 0;
    const counts = item.counts ?? { done: 0, now: 0, blocked: 0 };
    const states = [];
    if (Array.isArray(item.stepStates) && item.stepStates.length === total) {
      states.push(...item.stepStates);
    } else {
      for (let i = 0; i < Math.max(0, counts.done); i++) states.push("done");
      for (let i = 0; i < Math.max(0, counts.now); i++) states.push("now");
      for (let i = 0; i < Math.max(0, counts.blocked); i++) states.push("blocked");
      while (states.length < total) states.push("left");
      if (states.length > total) states.splice(total);
    }
    return h_flex().h(g.PROGRESS_H).flex_none().gap(g.PROGRESS_GAP).items_center()
      .when(item.progressStale, (element) => element.opacity(0.45))
      .child(h_flex().flex_1().min_w(0).gap(g.BAR_GAP).h(g.BAR_H)
        .children(states.map((state) => div().flex_1().h(g.BAR_H).rounded(g.BAR_RADIUS).bg(SEG[state] ?? SEG.left))))
      .child(div().flex_none().text_size(g.TEXT.progress).font_family(FONT).font_bold().text_color(INK.t3)
        .child(`${item.progress.done}/${total}`));
  }

  progressTarget(item) {
    const path = item.raw.deadhd?.pagePath;
    if (path) return { url: path, openable: true, files: [] };
    return this.pageGroup(item);
  }

  pageTag(item) {
    const g = this.geo ?? geometry(1);
    const page = item.pages[0];
    const extra = item.pages.length - 1;
    const label = extra > 0 ? `${page.label} +${extra}` : page.label;
    return h_flex().id(`tag-${item.sessionId}`).h(g.TAG_H).flex_none().max_w(g.TAG_MAX_W).px(g.TAG_PAD).rounded(g.TAG_RADIUS).gap(g.TAG_CHIP_GAP).items_center()
      .bg(INK.chipBg)
      .tooltip(page.url)
      .child(pageIcon(g.TAG_ICON, INK.t2))
      .child(div().min_w(0).truncate().text_size(g.TEXT.page).font_family(FONT).font_bold().text_color(INK.t2).child(label));
  }

  stepRow(step) {
    const g = this.geo ?? geometry(1);
    const color = step.state === "done" ? INK.t3 : step.state === "left" ? INK.t2 : INK.t1;
    const glyph = step.state === "done"
      ? div().text_size(g.TEXT.stepGlyph).font_family(FONT).font_bold().text_color(SEG.done).child("✓")
      : step.state === "blocked"
        ? div().text_size(g.TEXT.stepGlyph).font_family(FONT).font_bold().text_color(TONE.needs.ink).child("!")
        : step.state === "now" || step.state === "side"
          ? svg("mods/workspace-chrome/spinner.svg").size(g.SPINNER).flex_none().text_color(TONE.working.dot).spin(900)
          : div().text_size(g.TEXT.stepGlyph).font_family(FONT).text_color(INK.line).child("○");
    const trailing = step.state === "blocked" ? step.ask ?? step.sub ?? null : step.sub ?? null;
    return h_flex().h(g.STEP_H).flex_none().gap(g.STEP_GAP).items_center().min_w(0)
      .child(h_flex().w(g.STEP_GLYPH_W).flex_none().items_center().justify_center().child(glyph))
      .child(div().flex_1().min_w(0).truncate().text_size(g.TEXT.stepLabel).font_family(FONT).font_semibold().text_color(color).child(step.label))
      .when(Boolean(trailing), (element) => element.child(
        div().flex_none().max_w(g.STEP_TRAIL_W).truncate().text_size(g.TEXT.stepTrail).font_family(FONT).text_color(INK.t3).tooltip(trailing).child(trailing)));
  }

  // The step list, beside the card's body when ↓ opens it (the card doubles its width).
  stepsColumn(item) {
    const g = this.geo ?? geometry(1);
    const counter = this.stepCounter(item);
    const rows = this.visibleSteps(item).map((step) => this.stepRow(step));
    return v_flex().id(`steps-${item.sessionId}`).w(g.STEPS_W).flex_none().h_full().py(g.STEPS_PAD).pr(g.STEPS_PAD).pl(g.STEPS_PAD).gap(g.STEPS_GAP)
      .border_l(2).border_color(INK.rule).overflow_y_scroll()
      .child(h_flex().h(g.STEPS_HEAD_H).flex_none().gap(g.STEPS_HEAD_GAP).items_center()
        .child(div().flex_1().min_w(0).text_size(g.TEXT.stepsHead).font_family(FONT).font_weight(800).text_color(INK.t3).child("Steps"))
        .when(Boolean(counter), (element) => element.child(
          div().flex_none().text_size(g.TEXT.stepsCount).font_family(FONT).text_color(INK.t3).child(counter))))
      .children(rows);
  }

  // The line under the meta: what a Working session does now, what a waiting one asks, what a Done one said.
  leadOf(item) {
    if (item.group === "working") {
      const waiting = item.raw.status === "shell";
      if (waiting && item.nowLabel) return { text: `▶ ${item.nowLabel}`, waiting: false, spinner: false };
      if (!waiting && !item.nowLine) return null;
      return { text: waiting ? "Waiting on background tasks" : item.nowLine, waiting, spinner: !waiting };
    }
    if (item.group === "attention") return { text: item.answer, waiting: false, spinner: false };
    return item.replyTail ? { text: item.replyTail, waiting: false, spinner: false } : null;
  }

  // Herdr is where nearly every session runs, so only another host earns a badge.
  kindBadge(item) {
    return item.badge && item.badge !== "herdr" ? item.badge : null;
  }

  // The message slot: what the session says now, else its last prompt in the quiet colour.
  messageOf(item) {
    const lead = this.leadOf(item);
    const text = cleanMessage(lead?.text);
    if (text) return { text, quiet: Boolean(lead.waiting), spinner: Boolean(lead.spinner) };
    const prompt = item.raw.lastPrompt;
    if (prompt && !/\.claude\/handoff\//.test(prompt)) {
      const quiet = cleanMessage(prompt.replace(/\[Image #\d+\]/g, " ").replace(/(?:~|\/)[\w.-]*(?:\/[\w.-]+){2,}/g, " "));
      if (quiet) return { text: `↳ ${quiet}`, quiet: true, spinner: false };
    }
    const topic = clip(item.topic, 120);
    return topic ? { text: topic, quiet: true, spinner: false } : null;
  }

  card(item, selected, now, focused = false, player = 1) {
    const g = this.geo ?? geometry(1);
    const tone = this.tone(item);
    const timeText = this.timeText(item, now);
    const message = this.messageOf(item);
    const showProgress = Boolean(item.progress && (item.group !== "done" || item.progress.done < item.progress.total));
    const chips = this.trayChips(item);
    const tray = chips.length > 0 || item.pages.length > 0 || Boolean(this.kindBadge(item));
    const who = charFor(item.charKey);
    const spin = Boolean(message?.spinner);
    const persona = personaLine(who, toneKey(tone));
    const screenH = screenHeight({ showProgress, tray }, g);
    const say = wrapLines(message?.text ?? persona, message ? g.TEXT.message : g.TEXT.persona, g.MSG_W,
      screenLines(screenH, g), spin ? 15 * g.k : 0);

    const accent = selected ? selectedTone(focused) : null;
    const needs = tone === TONE.needs;
    const borderColor = accent?.border ?? (needs ? INK.accent : tone === TONE.stall ? INK.t3 : INK.rule);
    const body = [this.cardHead(item, tone, player)];
    body.push(v_flex().h(screenH).flex_none().mt(g.MSG_MT).px(g.CHIP_PAD).justify_center().min_w(0).overflow_hidden()
      .bg(INK.bg).border_l(2).border_color(tone.ink)
      .children(say.map((text, index) => h_flex().h(g.MSG_LINE).flex_none().min_w(0).items_center()
        .when(index === 0 && spin, (row) => row.child(svg("mods/workspace-chrome/spinner.svg").size(g.SPINNER).flex_none().mr(g.MSG_SPINNER_MR)
          .text_color(TONE.working.dot).spin(900)))
        .child(div().min_w(0).truncate().text_size(message ? g.TEXT.message : g.TEXT.persona).font_family(BODY_FONT)
          .line_height(`${g.MSG_LINE}px`)
          .text_color(message?.quiet && !needs ? INK.t3 : tone.ink).child(text)))));
    body.push(div().flex_1().min_h(0));
    if (showProgress) body.push(this.progressRow(item).mb(g.PROGRESS_MB));
    if (tray) {
      body.push(h_flex().h(g.TRAY_H).flex_none().mb(g.TRAY_MB).gap(g.TRAY_GAP).items_center().min_w(0).overflow_hidden()
        .children(chips.map((label) => h_flex().h(g.CHIP_H).flex_none().px(g.CHIP_PAD).rounded(g.CHIP_RADIUS).items_center().bg(INK.chipBg)
          .child(div().text_size(g.TEXT.chip).font_family(FONT).font_bold().text_color(INK.t2).child(label))))
        .when(item.pages.length > 0, (element) => element.child(this.pageTag(item)))
        .when(Boolean(this.kindBadge(item)), (element) => element.child(
          h_flex().h(g.CHIP_H).flex_none().px(g.CHIP_PAD).rounded(g.CHIP_RADIUS).items_center().bg(INK.chipBg)
            .child(div().text_size(g.TEXT.badge).font_family(FONT).font_bold().text_color(INK.t2).child(item.badge)))));
    }
    body.push(h_flex().h(g.STATE_H).flex_none().gap(g.FOOT_GAP).items_center().min_w(0)
      .child(div().flex_1().min_w(0).text_size(g.TEXT.foot).font_family(DISPLAY).text_color(tone.ink)
        .when(needs, (el) => el.loop("opacity", { from: 1, to: 0.2, period: 1000, easing: "ease-in-out" }))
        .child(tone.word))
      .child(div().flex_none().text_size(g.TEXT.foot).font_family(FONT).text_color(INK.t3).child(timeText)));

    const open = this.expanded.has(item.sessionId) && item.steps.length > 0;
    return h_flex().id(`card-${item.sessionId}`).w(g.CARD_W + (open ? g.STEPS_W : 0)).h(g.CARD_H).flex_none()
      .rounded(g.CARD_RADIUS).bg(INK.surface).overflow_hidden().cursor_pointer()
      .border(2).border_color(borderColor)
      .when(item.bucket === "stall", (el) => el.border_dashed())
      .when(!selected, (element) => element.hover((style) => style.border_color(INK.t2)))
      .when(item.group === "done" && item.viewed && !selected, (element) => element.opacity(0.55))
      .tooltip(cardTooltip(item.topic, item.title, [this.metaText(item), WHO[who], tone.label]))
      .child(v_flex().w(g.CARD_W - 4).flex_none().h_full()
        .child(v_flex().flex_1().min_h(0).pt(g.BODY_PT).px(g.BODY_PAD).pb(g.BODY_PB).children(body)))
      .when(open, (element) => element.child(this.stepsColumn(item)));
  }

  // A group's stage plate: the big title over its count, like an arcade stage card.
  laneColumn(group) {
    const g = this.geo ?? geometry(1);
    const lane = laneParts(group);
    return v_flex().w(g.LANE_W).flex_none().pt(half(8 * g.k)).pr(g.CARD_GAP).gap(half(2 * g.k)).tooltip(lane.tip)
      .child(div().text_size(g.TEXT.groupTitle).font_family(DISPLAY).text_color(lane.color).child(lane.title))
      .child(div().text_size(g.TEXT.groupSub).font_family(FONT).text_color(INK.t3).child(lane.sub));
  }

  moreTile(count) {
    const g = this.geo ?? geometry(1);
    return v_flex().id("cc-more").w(g.MORE_W).h(g.CARD_H).flex_none().rounded(g.CARD_RADIUS).items_center().justify_center().gap(g.MORE_GAP)
      .border(2).border_color(INK.line).bg(INK.chrome).cursor_pointer()
      .hover((style) => style.bg(INK.rule))
      .child(div().text_size(g.TEXT.moreCount).font_family(DISPLAY).text_color(INK.focus).child(`+${count}`))
      .child(div().text_size(g.TEXT.moreLabel).font_family(FONT).text_color(INK.t2).child("more done"));
  }

  stripView(data) {
    const g = this.geo ?? geometry(1);
    const strip = this.buildStrip(data);
    const chipFilter = shared("arcade-filter");
    const filtering = Array.isArray(chipFilter) && chipFilter.length > 0;
    if (!strip.length) {
      return h_flex().h(g.STRIP_H).flex_none().w_full().items_center().justify_center()
        .child(div().text_size(g.TEXT.empty).font_family(FONT).font_bold().text_color(INK.t3)
          .child(emptyText(this.query, filtering)));
    }
    const now = data.now;
    const focused = Boolean(this.handle?.is_focused?.());
    // A head entry's lead already counts the lane column, which is drawn inside it.
    const draw = (entry) => h_flex().h_full().flex_none().w(entry.w).pl(entry.head ? entry.lead - g.LANE_W : entry.lead).items_start()
      .when(entry.head, (el) => el.child(this.laneColumn(entry.group)))
      .child(entry.kind === "more" ? this.moreTile(entry.count) : this.card(entry.item, entry.item.sessionId === this.sel, now, focused, entry.player));
    return div().relative().w_full().h(g.STRIP_H).flex_none()
      .child(h_virtual_list(STRIP_ID, strip.length, strip.map((entry) => entry.w),
        (index) => strip[index]?.key ?? String(index),
        (range) => strip.slice(range.start, range.end).map(draw))
        .on_item_click((key, cx) => this.clickStrip(key, cx))
        .on_item_secondary_click((key, _event, cx) => this.openLinks(key, cx))
        .track_scroll(this.scroll).size_full())
      .on_scroll_wheel((event, cx) => this.wheelRow(strip.map((entry) => entry.w), event, cx))
      .on_mouse_move((event) => this.trackStrip(event))
      .child(edgeFade("left", g.PAD_X))
      .child(edgeFade("right", g.PAD_X));
  }

  // The list only scrolls by item, so both wheel kinds still move whole cards, and the offset
  // estimate is what keeps a wheel step aligned with a native sideways swipe. The bounds are
  // on-screen px carrying the app's zoom, while the entry widths are written at zoom 1.
  wheelRow(widths, event, cx) {
    const viewportW = event.bounds?.width > 0 ? event.bounds.width / zoomOf() : null;
    if (viewportW != null) this.wheel.viewportW = viewportW;
    const next = wheelStepFor(this.wheel, event, Date.now(), widths, viewportW);
    this.wheel = next.state;
    if (next.target == null) return;
    this.scroll.scroll_to_item(next.target, "top");
    cx.notify();
  }

  // GPUI gives a list no item bounds, so the strip's window box comes from the last pointer move over it.
  trackStrip(event) {
    const box = event.bounds;
    if (!box || !(box.width > 0) || !event.local_position) return;
    this.stripBox = { x: event.position.x - event.local_position.x, y: event.position.y - event.local_position.y,
      width: box.width, height: box.height };
    if (this.wheel) this.wheel.viewportW = box.width / zoomOf();
  }

  // Where ⌘↩ opens a card's menu: under the card, inside the strip. Unknown until the pointer has crossed the
  // strip once, and then the popup falls back to the pointer.
  cardMenuAt(sessionId) {
    const box = this.stripBox;
    if (!box) return undefined;
    const strip = this.buildStrip(this.viewData());
    const index = strip.findIndex((entry) => entry.kind === "card" && entry.item.sessionId === sessionId);
    if (index < 0) return undefined;
    const zoom = zoomOf();
    const left = (stripStarts(strip.map((entry) => entry.w))[index] + strip[index].lead - (this.wheel?.off ?? 0)) * zoom;
    const x = Math.max(0, Math.min(left, box.width - LINKS_W * zoom));
    return { x: Math.round(box.x + x), y: Math.round(box.y + box.height - 8 * zoom) };
  }

  // A right-click on a card: the card's links in a menu at the pointer (or at `at`), and the card selected.
  openLinks(key, cx, at) {
    const item = this.viewData().groups.flatMap((group) => group.items).find((entry) => `card-${entry.sessionId}` === key);
    if (!item) return;
    this.sel = item.sessionId;
    cx.notify();
    const links = linksOf(item, { jiraBase: this.jiraBase, slackBase: this.slackBase });
    // A Claude Code session in a live terminal with no checklist yet can be asked to show one.
    const showChecklist = Boolean(item.terminal) && item.raw?.t === "s" && !item.hasChecklist;
    openOverlay({ mod: "arcade-cards", kind: "popup", ...(at ? { at } : {}), width: LINKS_W, height: linksMenuHeight(links.length, showChecklist),
      props: { role: "links", head: item.jiraKey ?? (item.spot?.slack ? "Slack" : item.spot?.label ?? "Session"),
        topic: item.topic ?? item.title ?? null, links, showChecklist, terminal: item.terminal ?? null,
        working: item.raw?.status === "busy" } });
  }

  // props().role "links": the popup openLinks() opens. C asks for the checklist, J, P, S and G open the
  // first link of each kind.
  linksMenu() {
    const { head, topic, links = [], showChecklist = false } = props() ?? {};
    const open = (link, cx) => this.openLink(link, cx);
    const copy = (cx) => this.copyLinks(links, cx);
    const rows = showChecklist ? [{ checklist: true }, ...links] : links;
    const icons = { jira: "mods/arcade-cards/icons/ticket.svg", pr: "mods/arcade-cards/icons/pull.svg",
      slack: "mods/arcade-cards/icons/thread.svg", page: "mods/workspace-chrome/file-text.svg" };
    const row = (id, icon, label, meta, hot, active, action) => h_flex().id(id).h(30).flex_none().px(8).gap(8).rounded(0)
      .items_center().cursor_pointer()
      .when(active, (el) => el.bg(INK.chipBg))
      .hover((h) => h.bg(INK.chipBg))
      .on_click((_event, cx) => action(cx))
      .child(svg(icon).size(14).flex_none().text_color(INK.t2))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(FONT).font_semibold().text_color(INK.t1).child(label))
      .when(Boolean(meta), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(11).font_family(FONT)
        .font_semibold().text_color(INK.t2).child(meta)))
      .when(Boolean(hot), (el) => el.child(keycap(String(hot).toUpperCase())));
    const checklistRow = h_flex().id("link-checklist").h(30).flex_none().px(8).gap(8).rounded(0)
      .items_center().cursor_pointer()
      .when(this.active === 0, (el) => el.bg(INK.chipBg))
      .hover((h) => h.bg(INK.chipBg))
      .on_click((_event, cx) => this.enableChecklist(cx))
      .child(svg("mods/workspace-chrome/file-text.svg").size(14).flex_none().text_color(INK.t2))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(FONT).font_semibold().text_color(INK.t1)
        .child("Show checklist"))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(11)
        .font_family(FONT).font_semibold().text_color(TONE.needs.ink).child(this.error)))
      .child(keycap("C"));
    const offset = showChecklist ? 1 : 0;
    return v_flex().id("card-links").size_full().p(6).track_focus(this.handle)
      .on_key_down((event, cx) => this.linksKey(event.key, rows, cx))
      .child(v_flex().h(45).flex_none().px(8).pt(6)
        .child(div().text_size(12).font_family(FONT).font_bold().text_color(INK.t1).child(head ?? ""))
        .when(Boolean(topic), (el) => el.child(div().truncate().text_size(11).font_family(BODY_FONT).text_color(INK.t3).child(topic))))
      .child(div().h(1).mx(6).mb(4).flex_none().bg(INK.rule))
      .when(showChecklist, (el) => el.child(checklistRow))
      .when(showChecklist && links.length > 0, (el) => el.child(div().h(1).mx(6).my(4).flex_none().bg(INK.rule)))
      .when(links.length === 0, (el) => el.child(h_flex().h(30).px(8).items_center()
        .child(div().text_size(12).font_family(FONT).font_semibold().text_color(INK.t3).child("No links on this card"))))
      .children(links.map((link, index) => row(`link-${index}`, icons[link.kind], link.label, link.meta, link.hot,
        index + offset === this.active, (cx) => open(link, cx))))
      .when(links.length > 0, (el) => el
        .child(div().h(1).mx(6).my(4).flex_none().bg(INK.rule))
        .child(row("link-copy", "mods/arcade-cards/icons/copy.svg", "Copy all links", null, null, false, copy)));
  }

  // The links popup's keys: a row's letter runs it, ↑↓ move, ↩ runs the highlighted row, Esc closes.
  linksKey(key, rows, cx) {
    const hot = rows.find((row) => (row.checklist ? key === "c" : row.hot === key));
    if (hot?.checklist) this.enableChecklist(cx);
    else if (hot) this.openLink(hot, cx);
    else if (key === "down" && rows.length) this.active = (this.active + 1) % rows.length;
    else if (key === "up" && rows.length) this.active = (this.active - 1 + rows.length) % rows.length;
    else if (key === "enter" && rows[this.active]) {
      if (rows[this.active].checklist) this.enableChecklist(cx);
      else this.openLink(rows[this.active], cx);
    } else if (key === "escape") closeOverlay(props().overlay);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // Asks the session to show its checklist through Herdr's CLI. The terminal and prompt are positional
  // args, so neither is parsed by the shell. Claude Code queues input typed during a turn.
  enableChecklist(cx) {
    const { terminal, working, overlay } = props() ?? {};
    if (!terminal) return;
    const prompt = working ? CHECKLIST_QUEUED_PROMPT : CHECKLIST_PROMPT;
    this.error = null;
    cx.spawn(async (cx) => {
      let result = null;
      try { result = await exec("sh", ["-lc", 'hc send "$1" "$2"', "x", terminal, prompt]); } catch {}
      if (!result || result.code !== 0) {
        this.error = (((result?.stderr || result?.stdout) ?? "").trim().replace(/\.$/, ""))
          || "Could not reach the terminal — focus it in Herdr and retry";
        cx.notify();
        return;
      }
      closeOverlay(overlay);
    });
  }

  // http(s) goes to the system's URL handler; a local page file (scan.sh vouched it openable) to `open`.
  openLink(link, cx) {
    if (/^https?:\/\//.test(link.url)) cx.open_url(link.url);
    else exec("open", [link.url]);
    closeOverlay(props().overlay);
  }

  copyLinks(links, cx) {
    cx.write_to_clipboard(links.map((link) => link.url).join("\n"));
    closeOverlay(props().overlay);
  }

  // Clicks on the strip arrive here by row key: Herdr refuses handlers inside a virtual list's rows.
  clickStrip(key, cx) {
    if (key === "more-done") {
      this.showAllDone = true;
    } else {
      const item = this.viewData().groups.flatMap((group) => group.items)
        .find((entry) => `card-${entry.sessionId}` === key);
      if (!item) return;
      this.sel = item.sessionId;
      this.goTo(item, cx);
    }
    this.handle.focus();
    cx.notify();
  }

  legend() {
    const g = this.geo ?? geometry(1);
    const item = (keys, label) => h_flex().flex_none().gap(g.LEGEND_ITEM_GAP).items_center()
      .child(keycap(keys, g.k))
      .child(div().text_size(g.TEXT.legend).font_family(FONT).font_semibold().text_color(INK.t3).child(label));
    return h_flex().absolute().left(0).right(0).bottom(0).h(g.LEGEND_H).px(g.LEGEND_PAD).gap(g.LEGEND_GAP).items_center()
      .bg(INK.surface).border_t(2).border_color(INK.focus).rounded_bl(0).rounded_br(0).overflow_hidden()
      .child(div().flex_none().text_size(g.TEXT.legendTitle).font_family(DISPLAY).text_color(INK.focus).child("HOW TO PLAY"))
      .child(item("←→", "Select"))
      .child(item("↩", "Go to"))
      .child(item("↑↓", "Steps"))
      .child(item("⌫", "Dismiss"))
      .child(item("⌘Z", "Undo"))
      .child(item("Space", "Go to waiting"))
      .child(item("⇧Space", "Go to done"))
      .child(item("Tab", "Next to read"))
      .child(item("⌘↩", "Links"))
      .child(item("Esc", "Back"))
      .child(item("?", "Keys"));
  }

  // ---- head and tools (props role "head" and "tools") ----

  head() {
    const cur = spaces().find((s) => s.active);
    return h_flex().size_full().items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(14).font_family(DISPLAY).text_color(INK.focus)
        .child(cur?.name ?? "Herdr"));
  }

  // The tools copy has no legend, so a chip with nothing to open hands its notice to the strip.
  openChipPage(pages, cx) {
    const page = Array.isArray(pages) ? pages[0] : null;
    if (!page?.openable) {
      setShared(FLASH_KEY, { token: `${Date.now()}-${Math.random()}`, message: NO_PAGE_FLASH });
      return;
    }
    cx.spawn(async () => { await openPageFiles(page); });
  }

  tools() {
    const state = shared(SHARED_KEY) ?? {};
    const pages = Array.isArray(state.pages) ? state.pages : [];
    const branch = panes().find((p) => p.focused)?.branch ?? "";
    const parts = toolsParts(state, branch);
    return h_flex().size_full().justify_end().gap(8)
      .when(parts.branch, (el) => el.child(div().flex_none().max_w(120).truncate().text_size(12).font_family(FONT)
        .text_color(INK.t3).child(`⎇ ${branch}`)))
      .child(h_flex().id("cc-pages").h(28).flex_none().px(10).rounded(0).gap(6).items_center()
        .bg(INK.surface).border(2).border_color(INK.line).cursor_pointer()
        .when(Boolean(this.handle), (el) => el.track_focus(this.handle).tab_index(0))
        .when(Boolean(this.handle?.is_focused?.()), (el) => el.border(2).border_color(INK.focus))
        .role("button").accessibility_label(`Open the oldest page (${parts.pageCount})`)
        .hover((style) => style.bg(INK.chrome))
        .tooltip(`Open the oldest page (${parts.pageCount})`)
        .on_key_down((event, cx) => {
          if (event.key !== "enter" && event.key !== "space") return;
          cx.stop_propagation();
          this.openChipPage(pages, cx);
          cx.notify();
        })
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .on_click((_event, cx) => this.openChipPage(pages, cx))
        .child(pageIcon(12))
        .child(div().text_size(12).font_family(DISPLAY).text_color(INK.focus).child(`${parts.pageCount} to read`)))
      .child(h_flex().id("cc-search").flex_1().min_w(140).max_w(280).h(28).px(8).rounded(0).gap(6).items_center()
        .bg(INK.bg).border(2).border_color(state.focused ? INK.focus : INK.line).cursor_text()
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .on_click(() => run("arcade-cards.focus"))
        .child(svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(INK.t3))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(FONT).font_semibold()
          .text_color(state.query ? INK.t1 : INK.t2).child(state.query || "ticket, topic, line")));
  }

  // The joystick and the session buttons on the left, and the selected session's info on the
  // right. Hovering a button shows the card itself above it.
  panelView(data, selected, focused) {
    const g = this.geo ?? geometry(1);
    const groups = this.panelGroups(data.groups);
    const filter = shared("arcade-filter");
    const filtering = Array.isArray(filter) && filter.length > 0;
    const info = infoItemOf(data.groups, selected);
    const stick = div().size(34).flex_none().rounded(17).bg(INK.accent).border(2).border_color(INK.rule)
      .flex().items_center().justify_center()
      .child(div().size(10).rounded(5).bg(INK.accentInk));
    const button = (entry) => {
      const item = entry.item;
      const tone = this.tone(item);
      const isSelected = selected?.sessionId === item.sessionId;
      const who = charFor(item.charKey);
      const led = div().absolute().right(-2).top(-2).size(12).rounded(6).bg(tone.dot)
        .when(item.group === "attention" && item.bucket !== "stall", (el) => el.loop("opacity", { from: 1, to: 0.2, period: 1000, easing: "ease-in-out" }))
        .when(item.group === "done" && item.viewed, (el) => el.opacity(0.35));
      const trigger = v_flex().relative().items_center().gap(2).cursor_pointer()
        .role("button").accessibility_label(`P${entry.player} ${item.topic ?? item.title ?? ""}`)
        .on_hover((hovered, cx) => {
          if (hovered) this.panelHover = item.sessionId;
          else if (this.panelHover === item.sessionId) this.panelHover = null;
          cx.notify();
        })
        .on_click((_event, cx) => this.clickStrip(`card-${item.sessionId}`, cx))
        .child(div().relative().size(52).rounded(26).border(3)
          .border_color(isSelected ? INK.focus : INK.rule).bg(INK.surface)
          .flex().items_center().justify_center()
          .child(image(`mods/arcade-rail/faces/${who}.png`).size(32))
          .child(led))
        .child(div().text_size(10).font_family(DISPLAY).text_color(isSelected ? INK.focus : INK.t2).child(`P${entry.player}`));
      return Popup.new(`panel-hover-${item.sessionId}`, trigger).anchor("bottom_left")
        .when(this.panelHover === item.sessionId, (el) => el.content(this.card(item, false, data.now, false, entry.player)));
    };
    const plate = (group, index) => v_flex().flex_none().items_center().gap(2)
      .when(index > 0, (el) => el.pl(12).border_l(2).border_dashed().border_color(INK.rule))
      .child(div().text_size(10).font_family(DISPLAY).text_color(group.color).child(group.title))
      .child(h_flex().gap(10).items_center().children(group.items.map((entry) => button(entry))));
    return h_flex().id("arcade-panel").relative().size_full().items_center().gap(16).px(12).py(6)
      .bg(INK.bg).border(3).border_color(INK.cabEdge).text_color(INK.t1)
      .track_focus(this.handle)
      .on_key_down((event, cx) => this.key(event, cx))
      .child(stick)
      .when(!groups.length, (el) => el.child(h_flex().flex_1().justify_center()
        .child(div().text_size(12).font_family(FONT).text_color(INK.t3).child(emptyText(this.query, filtering)))))
      .when(Boolean(groups.length), (el) => el
        .child(h_flex().flex_none().min_w(0).items_center().gap(12).overflow_x_scroll()
          .children(groups.map((group, index) => plate(group, index))))
        .child(this.infoView(info, data.now, g)))
      .when(this.showKeys, (el) => el.child(this.legend()))
      .when(focused, (el) => el.child(this.focusRing()));
  }

  // The info area beside the buttons: the session's small face, ticket key in its mood colour,
  // topic, two lines of what it says and its state and time, against a 2 px mood edge.
  infoView(item, now, g) {
    if (!item) return div().flex_1().min_w(0);
    const tone = this.tone(item);
    const who = charFor(item.charKey);
    const tag = this.keyTagOf(item);
    const message = this.messageOf(item);
    // The area measures itself; before its first layout the text wraps to one card's width.
    const room = this.infoWidth > 0 ? this.infoWidth : g.TEXT_W;
    const width = Math.max(40, room - g.INFO_PAD * 2 - 2 - g.INFO_FACE - g.INFO_GAP);
    const topic = wrapLines(item.topic ?? item.title, g.TEXT.topic, width, 1);
    const say = wrapLines(message?.text ?? personaLine(who, toneKey(tone), now),
      message ? g.TEXT.message : g.TEXT.persona, width, 2);
    const ink = message?.quiet && tone !== TONE.needs ? INK.t3 : tone.ink;
    return h_flex().id("panel-info").flex_1().min_w(0).h_full().items_center().gap(g.INFO_GAP)
      .pl(g.INFO_PAD).pr(g.INFO_PAD).bg(INK.bg).border_l(2).border_color(tone.ink)
      .on_size_change((size, cx) => this.infoSized(size, cx))
      .child(div().size(g.INFO_FACE).flex_none().rounded(half(g.INFO_FACE / 2)).overflow_hidden()
        .border(2).border_color(tone.ink).bg(INK.surface)
        .child(image(`mods/arcade-rail/faces/${who}.png`).size(g.INFO_FACE)))
      .child(v_flex().flex_1().min_w(0).justify_center().gap(g.INFO_GAP_Y)
        .child(h_flex().min_w(0).gap(g.INFO_TAG_GAP).items_center()
          .when(Boolean(tag), (row) => row.child(div().flex_none().text_size(g.TEXT.key).font_family(DISPLAY)
            .text_color(tone.ink).child(tag.head)))
          .when(Boolean(topic.length), (row) => row.child(div().flex_1().min_w(0).truncate()
            .text_size(g.TEXT.topic).font_family(FONT).text_color(INK.t2).child(topic[0]))))
        .children(say.map((text) => div().h(g.INFO_LINE).flex_none().min_w(0).truncate()
          .text_size(message ? g.TEXT.message : g.TEXT.persona).font_family(BODY_FONT)
          .line_height(`${g.INFO_LINE}px`).text_color(ink).child(text)))
        .child(h_flex().h(g.STATE_H).flex_none().gap(g.FOOT_GAP).items_center()
          .child(div().text_size(g.TEXT.foot).font_family(DISPLAY).text_color(tone.ink).child(tone.word))
          .child(div().flex_none().text_size(g.TEXT.foot).font_family(FONT).text_color(INK.t3)
            .child(this.timeText(item, now)))));
  }

  // The info area's wrap width is its measured box, less the face, padding and mood edge.
  infoSized(size, cx) {
    const width = Math.round(size.width / zoomOf());
    if (!(width > 0) || width === this.infoWidth) return;
    this.infoWidth = width;
    cx.notify();
  }

  render(cx) {
    if (this.role === "head") return this.head();
    if (this.role === "tools") {
      this.drawnFocus = this.handle?.is_focused?.() ? "1" : "0";
      return this.tools();
    }
    if (this.role === "links") return this.linksMenu();
    this.geo = geometry(this.k ?? 1);
    const g = this.geo;
    const data = this.viewData();
    this.drawnFocus = this.focusKey();
    this.followFocus(data);
    const selected = this.selectedItem(data);
    if (selected) {
      this.sel = selected.sessionId;
      this.selIndex = Math.max(0, data.groups.flatMap((group) => group.items).indexOf(selected));
      this.handoff = false;
    }
    const focused = this.handle.is_focused();
    this.publish(data, focused);
    this.publishNotice();
    if (this.role === "panel") return this.panelView(data, selected, focused);
    return v_flex().id("arcade-cards").relative().size_full().min_h(0).rounded(0).bg(INK.surface).text_color(INK.t1)
      .font_family(FONT).text_size(g.TEXT.base)
      .track_focus(this.handle)
      .on_key_down((event, cx) => this.key(event, cx))
      .on_size_change((size, cx) => this.sizeChanged(size, cx))
      .child(v_flex().flex_1().min_h(0).pt(g.STRIP_TOP_PAD).justify_start().child(this.stripView(data)))
      .when(this.showKeys, (el) => el.child(this.legend()))
      .when(focused, (el) => el.child(this.focusRing()));
  }

  // While the strip has the keyboard, a 2 px accent ring lies along the panel's 12 px edge,
  // the way a focused work pane's frame turns amber. Drawn last so it paints over the cards.
  focusRing() {
    return div().id("cards-focus-ring").absolute().left(0).top(0).right(0).bottom(0)
      .rounded(0).border(2).border_color(INK.focus);
  }
}
