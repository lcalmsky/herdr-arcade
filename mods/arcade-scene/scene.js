// Placement, cabinet assignment, screens, bubbles, scrolling and walk paths for the arcade.
// Everything here is pure and in design pixels: the background is 1536 × 1024, and main.js scales
// the stage.

export const DESIGN = { width: 1536, height: 1024 };
// The stage keeps the focus box in view. These are its across edges, design x 80..1536. topY is
// the cabinets' marquee top, which the focus box starts above, and topFraction is the share of the
// block left above the focus box when it leaves vertical room.
export const VIEW = { x0: 80, x1: 1536, topY: 330, topFraction: 0.12 };
export const FRAME_BG = "#191035";

export const WALK_Y = 760;
// A session joining after the settling window walks in from this far inside the stage's right edge.
export const WALK_IN_MARGIN = 80;

// The marquee frame starts at the cabinets' upper edge: the design is fitted across x 80..1536,
// so no side band shows, and MARQUEE.y is the design y that lands on the block's top.
// MARQUEE.x0 starts the view at the art's left edge so the cabinet row sits nearer the middle.
// The marquee shows the design band from y to y + height: cabinet tops down to the players' shoulders.
export const MARQUEE = { x0: 0, y: 332, height: 295, topFraction: 0 };

// One cabinet per session, left to right: the first stands at CAB_X0, then one every CAB_STEP,
// and the art cycles through the six cabinets in this order.
export const CAB_X0 = 220;
export const CAB_STEP = 175;
export const CAB_ART = ["cab_magenta", "cab_cyan", "cab_purple", "cab_orange", "cab_yellow", "cab_green"];
// Room after the last cabinet's centre, so its sprite clears the stage's right edge.
export const STAGE_MARGIN = 120;
export const CAB_BASE_Y = 640;

export function cabinetAt(index) {
  return { art: CAB_ART[index % CAB_ART.length], x: CAB_X0 + index * CAB_STEP };
}

// The stage grows with the cabinet row and never shrinks below the background's own width.
export function stageWidthFor(count) {
  const cabinets = Math.max(0, Math.floor(count) || 0);
  const right = cabinets ? CAB_X0 + (cabinets - 1) * CAB_STEP + STAGE_MARGIN : 0;
  return Math.max(DESIGN.width, right);
}

// How many 1536 px background tiles the stage needs.
export function tilesFor(stageWidth) {
  return Math.max(1, Math.ceil(stageWidth / DESIGN.width));
}
// The screen inset inside a cabinet sprite, as fractions of its box.
export const SCREEN = { x0: 0.196, x1: 0.804, y0: 0.283, y1: 0.541 };

// Where each mood stands in front of its cabinet, and the pose it wears there.
export const FOOT_Y = { working: 700, stall: 700, needs: 720, done: 720, viewed: 700 };
export const POSE = { working: "back", stall: "back", needs: "alert", done: "cheer", viewed: "sleep" };

// The group each mood sits in, left to right: needs you, stalls, done and unread, working, read.
export const ORDER = { needs: 0, stall: 1, done: 2, working: 3, viewed: 4 };

// Sizes and anchors in design px: art/manifest.json's logical sizes at density 2.
export const ART = {
  cab_magenta: { size: [194, 307], anchor: [97, 307] },
  cab_cyan: { size: [195, 307], anchor: [97.6, 307] },
  cab_purple: { size: [195, 307], anchor: [97.6, 307] },
  cab_orange: { size: [194, 308], anchor: [97, 308] },
  cab_yellow: { size: [195, 308], anchor: [97.6, 308] },
  cab_green: { size: [195, 308], anchor: [97.6, 308] },
  scr_play: { size: [119, 88], anchor: [59.6, 44] },
  scr_continue: { size: [117, 88], anchor: [58.4, 44] },
  scr_pause: { size: [118, 88], anchor: [59, 44] },
  scr_highscore: { size: [119, 87], anchor: [59.6, 43.6] },
  scr_demo: { size: [117, 87], anchor: [58.4, 43.6] },
  kid_back: { size: [117, 192], anchor: [58.4, 192] },
  kid_alert: { size: [165, 192], anchor: [82.4, 192] },
  kid_cheer: { size: [174, 192], anchor: [87, 192] },
  kid_sleep: { size: [96, 112], anchor: [48, 112] },
  robot_back: { size: [119, 192], anchor: [59.6, 192] },
  robot_alert: { size: [158, 192], anchor: [79, 192] },
  robot_cheer: { size: [165, 192], anchor: [82.4, 192] },
  robot_sleep: { size: [91, 112], anchor: [45.6, 112] },
  cat_back: { size: [113, 192], anchor: [56.4, 192] },
  cat_alert: { size: [159, 192], anchor: [79.6, 192] },
  cat_cheer: { size: [170, 192], anchor: [85, 192] },
  cat_sleep: { size: [90, 112], anchor: [45, 112] },
  oldman_back: { size: [133, 192], anchor: [66.4, 192] },
  oldman_alert: { size: [174, 192], anchor: [87, 192] },
  oldman_cheer: { size: [168, 192], anchor: [84, 192] },
  oldman_sleep: { size: [103, 112], anchor: [51.6, 112] },
  frog_back: { size: [132, 192], anchor: [66, 192] },
  frog_alert: { size: [175, 192], anchor: [87.6, 192] },
  frog_cheer: { size: [175, 192], anchor: [87.6, 192] },
  frog_sleep: { size: [106, 112], anchor: [53, 112] },
  punk_back: { size: [117, 192], anchor: [58.4, 192] },
  punk_alert: { size: [150, 192], anchor: [75, 192] },
  punk_cheer: { size: [171, 192], anchor: [85.6, 192] },
  punk_sleep: { size: [101, 112], anchor: [50.4, 112] },
  exclaim: { size: [65, 64], anchor: [32.4, 32] },
  zzz: { size: [62, 56], anchor: [31, 28] },
  dots: { size: [64, 56], anchor: [32, 28] },
  sparkle: { size: [51, 52], anchor: [25.6, 26] },
  shadow: { size: [176, 48], anchor: [88, 24] },
  glow: { size: [176, 48], anchor: [88, 24] },
};

// The box an un-cropped frame must always show: its top leaves room above the cabinet tops, and
// its bottom leaves room under the lowest foot (a Needs you character steps out to y 800).
export const FOCUS = { x0: VIEW.x0, x1: VIEW.x1, top: 218, bottom: 872 };

const WHO = ["kid", "robot", "cat", "oldman", "frog", "punk"];

export function whoOf(name) {
  return WHO.includes(name) ? name : "kid";
}

// Where a sprite's box starts, from its bottom-centre anchor point.
export function spriteBox(name, x, y, scale) {
  const { size, anchor } = ART[name];
  return {
    left: (x - anchor[0]) * scale,
    top: (y - anchor[1]) * scale,
    width: size[0] * scale,
    height: size[1] * scale,
  };
}

export function screenBox(cabinet, scale) {
  const { size, anchor } = ART[cabinet.art];
  const left = cabinet.x - anchor[0];
  const top = CAB_BASE_Y - anchor[1];
  return {
    left: (left + size[0] * SCREEN.x0) * scale,
    top: (top + size[1] * SCREEN.y0) * scale,
    width: size[0] * (SCREEN.x1 - SCREEN.x0) * scale,
    height: size[1] * (SCREEN.y1 - SCREEN.y0) * scale,
  };
}

// The scr_continue art draws its own 9 at x 0.41–0.58, y 0.43–0.74 of the screen; the countdown
// uses that same box, so its digit covers the drawn one instead of standing beside it.
export const COUNTDOWN = { x0: 0.37, x1: 0.63, y0: 0.42, y1: 0.76 };

// The CONTINUE countdown: 9 → 0, one second each, then back to 9. Read off the clock at every
// render, so a timer that never fires still leaves the right digit.
export function countdownDigit(since, now) {
  if (since == null || now == null) return null;
  const start = Number(since);
  const clock = Number(now);
  if (!Number.isFinite(start) || !Number.isFinite(clock)) return null;
  const step = Math.max(0, Math.floor((clock - start) / 1000));
  return String(9 - (step % 10));
}

// The cabinets in the row, in order, each with the session standing at it; every session has one.
export function cabinetCount(cast, spots) {
  let count = 0;
  for (const entry of cast) {
    const spot = spots?.[entry.id];
    if (spot?.kind === "cab") count = Math.max(count, spot.cab + 1);
  }
  return count;
}

export function machineSessions(cast, spots) {
  const rows = Array.from({ length: cabinetCount(cast, spots) }, () => null);
  for (const entry of cast) {
    const spot = spots?.[entry.id];
    if (spot?.kind === "cab") rows[spot.cab] = entry;
  }
  return rows;
}

// The cabinets showing a countdown now, with the digit each has reached.
export function countdownsOf(cast, spots, now) {
  const rows = [];
  machineSessions(cast, spots).forEach((entry, cab) => {
    if (entry?.mood !== "needs" || entry.since == null) return;
    const digit = countdownDigit(entry.since, now);
    if (digit != null) rows.push({ cab, digit });
  });
  return rows;
}

// The screen for a machine: a blink frame where the state calls for one, else a steady still.
export function screenFor(mood) {
  if (mood === "working") return { art: "scr_play", opacity: 1, blink: { from: 0.85, to: 1, period: 900 } };
  if (mood === "needs") return { art: "scr_continue", opacity: 1, blink: { from: 0.35, to: 1, period: 600 } };
  if (mood === "stall") return { art: "scr_pause", opacity: 1 };
  if (mood === "done") return { art: "scr_highscore", opacity: 1 };
  return { art: "scr_demo", opacity: 0.7 };
}

// One cabinet per cast entry, numbered left to right in ORDER. A session keeps its slot while its
// mood is unchanged, even when the scan hands the cast back in another order; a mood change sorts
// it into its new group, and it walks to that cabinet. Within a group the previous slot decides,
// so sessions that do not move never reshuffle. A new session appends to its group.
export function assignSpots(cast, previous = {}) {
  const entries = cast.map((entry, index) => ({ entry, index, before: previous?.[entry.id]?.cab ?? null }));
  entries.sort((a, b) => {
    const rank = (ORDER[a.entry.mood] ?? ORDER.working) - (ORDER[b.entry.mood] ?? ORDER.working);
    if (rank) return rank;
    const pa = a.before ?? Infinity;
    const pb = b.before ?? Infinity;
    if (pa !== pb) return pa - pb;
    return a.index - b.index;
  });
  const assigned = {};
  entries.forEach(({ entry }, cab) => {
    const cabinet = cabinetAt(cab);
    assigned[entry.id] = {
      kind: "cab", cab, x: cabinet.x, y: FOOT_Y[entry.mood] ?? FOOT_Y.working,
      pose: POSE[entry.mood] ?? "back", mood: entry.mood,
    };
  });
  return assigned;
}

// The mood each cabinet shows on its screen; every cabinet holds one session.
export function machineMoods(cast, spots) {
  return machineSessions(cast, spots).map((entry) => entry?.mood ?? null);
}

// One line of a speech bubble: at most `limit` characters, cut at the last space in that
// window so a Korean word is never split when there is a space to break on.
export function bubbleText(text, limit = 16) {
  const line = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!line || line.length <= limit) return line;
  const head = line.slice(0, limit);
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

// How long each character's bubble may run: Needs you gets the most, the rest a short line.
export const BUBBLE_LIMIT = { needs: 16, stall: 12, working: 10, done: 10 };

export const BUBBLE = { font: 22, pad: 12, lead: 30, gap: 8, border: 2 };

// Which bubbles overlap another one: those are drawn see-through so the scene and the other
// bubble show, and the one the pointer is on comes back to full strength on top. Boxes are
// {left, top, width, height} in screen px.
function hits(a, b) {
  return a.left < b.left + b.width && b.left < a.left + a.width
    && a.top < b.top + b.height && b.top < a.top + a.height;
}

export function overlapping(boxes) {
  return boxes.map((box, i) => boxes.some((other, j) => j !== i && hits(box, other)));
}

// Only a Needs you bubble speaks unbidden; every other mood speaks while the pointer is on it.
export function bubbleVisible(mood, id, hoveredId) {
  return mood === "needs" || (hoveredId != null && hoveredId === id);
}

// Needs you bubbles all show at once, so one that would land on a box already placed steps up a
// row, then down one, until it clears: the heads stay apart instead of stacking on each other.
// Specs carry their box; the result is the top for each, in the order given.
export function staggerTops(specs, gap = BUBBLE.gap) {
  const placed = [];
  return specs.map((spec) => {
    const row = spec.height + gap;
    const candidates = [spec.top];
    for (let step = 1; step <= 3; step += 1) candidates.push(spec.top - step * row, spec.top + step * row);
    const box = (top) => ({ left: spec.left, top, width: spec.width, height: spec.height });
    const top = candidates.map((value) => Math.max(0, value)).find((value) => !placed.some((other) => hits(box(value), other)))
      ?? Math.max(0, spec.top);
    placed.push(box(top));
    return top;
  });
}

// Draw order and opacity for the bubbles: plain ones first, then Needs you's, then the one
// under the pointer. A bubble that overlaps another fades to 0.55, unless it is Needs you's or
// hovered. Specs carry {id, flagged} plus their box; the result lists {index, opacity}.
export function bubbleLayers(specs, hoveredId) {
  const crowded = overlapping(specs);
  const rank = (spec) => (spec.id === hoveredId ? 2 : spec.flagged ? 1 : 0);
  return specs.map((spec, index) => ({
    index, rank: rank(spec),
    opacity: crowded[index] && spec.id !== hoveredId && !spec.flagged ? 0.55 : 1,
  })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ index, opacity }) => ({ index, opacity }));
}

// The bubble's width: padding, the "!" lead a Needs you bubble carries, and an em per character.
export function bubbleWidth(text, scale, flagged = false) {
  const lead = flagged ? BUBBLE.lead + BUBBLE.gap : 0;
  return (BUBBLE.pad * 2 + lead + String(text).length * BUBBLE.font) * scale + 2;
}

export function bubbleHeight(scale) {
  return (BUBBLE.font + BUBBLE.pad * 2) * scale + 2;
}

// Where a speech bubble starts: to the character's right, pulled left when its width would run
// past the visible right edge. The width is a full em per character, an upper bound for Hangul.
export function bubbleLeft(centreX, text, scale, visibleRight, flagged = false) {
  const wanted = (centreX + 44) * scale;
  const width = bubbleWidth(text, scale, flagged);
  return Math.max(0, Math.min(wanted, visibleRight - width - 4));
}

// The walk from one spot to another: down to the walking line, across, then on to the target.
// Consecutive equal points collapse so a leg is never zero length.
export function waypoints(from, to) {
  const path = [
    { x: from.x, y: from.y },
    { x: from.x, y: WALK_Y },
    { x: to.x, y: WALK_Y },
    { x: to.x, y: to.y },
  ];
  return path.filter((point, index) => index === 0 || point.x !== path[index - 1].x || point.y !== path[index - 1].y);
}

export function legMs(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(250, Math.min(900, distance * 4));
}

// A walk's legs laid out in time from its start: `start` is the leg's first ms and `total` is
// the whole walk's length.
export function walkLegs(path) {
  const legs = [];
  let at = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const ms = legMs(from, to);
    legs.push({ from, to, ms, start: at });
    at += ms;
  }
  return { legs, total: at };
}

// Where a walk is after its clock has run to `now`: the leg it is on, the point between that
// leg's ends, and the time the leg has left. Past the whole walk it is done at its last point.
export function walkAt(walk, now) {
  const elapsed = now - walk.started;
  if (elapsed >= walk.total || !walk.legs.length) {
    return { done: true, position: { ...walk.path[walk.path.length - 1] } };
  }
  const index = walk.legs.findIndex((leg) => elapsed < leg.start + leg.ms);
  const leg = walk.legs[index < 0 ? walk.legs.length - 1 : index];
  return {
    done: false, leg: index, from: leg.from, to: leg.to,
    position: walkPosition(leg.from, leg.to, leg.ms, elapsed - leg.start),
    remaining: leg.start + leg.ms - elapsed, ms: leg.ms,
  };
}

// A character's strength: the mood filter dims a hidden one, and a shown or carried one is solid
// from its first frame, so nobody waits on a fade that needs a later render to finish.
export function characterOpacity(shown, dragging) {
  return shown || dragging ? 1 : 0.15;
}

const clamp = (value, [low, high]) => Math.max(low, Math.min(high, value));

// Where a walk leg has reached after `elapsed` ms: straight from `from` to `to`, held at the
// endpoints outside the leg's time.
export function walkPosition(from, to, ms, elapsed) {
  const t = ms > 0 ? clamp(elapsed, [0, ms]) / ms : 1;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

// The chips over the scene: the cards' three groups and how many characters each has.
export function chipCounts(cast) {
  const count = (moods) => cast.filter((entry) => moods.includes(entry.mood)).length;
  return [["needs you", count(["needs", "stall"])], ["working", count(["working"])], ["done", count(["done", "viewed"])]];
}

export const CHIP_GROUPS = ["attention", "working", "done"];

// The chips: dark cabinet purple with pale ink, and the group's neon for its dot.
export const CHIP_TONES = {
  attention: { dot: "#ff41b4" },
  working: { dot: "#3adaf2" },
  done: { dot: "#f9d544" },
};

export const CHIP = { bg: "#251b47", ink: "#f1f0ff", border: "#ff41b4", line: "#31265a" };

const MOOD_GROUP = { needs: "attention", stall: "attention", working: "working", done: "done", viewed: "done" };

export function moodGroup(mood) { return MOOD_GROUP[mood] ?? "working"; }

export function readFilter(value) {
  if (!Array.isArray(value)) return [];
  return CHIP_GROUPS.filter((group) => value.includes(group));
}

export function toggleFilter(filter, group) {
  const current = readFilter(filter);
  const on = current.includes(group);
  return CHIP_GROUPS.filter((id) => (id === group ? !on : current.includes(id)));
}

export function shownByFilter(filter, mood) {
  const current = readFilter(filter);
  return !current.length || current.includes(moodGroup(mood));
}

// The scale and offset of a W × H stage that keeps the whole focus box in view: the smaller of
// the width and height fits. A height fit leaves the stage narrower than the block, so the stage
// is centred and the leftover sides show FRAME_BG. A width fit leaves vertical room, and the focus
// box sits VIEW.topFraction down from the top, or half the surplus when that is less. `left` and
// `top` are the stage's corners in the block, before any horizontal scroll.
export function coverScale(W, H, frame = null, stageWidth = DESIGN.width) {
  const focusWidth = FOCUS.x1 - FOCUS.x0;
  const focusHeight = FOCUS.bottom - FOCUS.top;
  if (frame === "marquee") {
    // The row grows with the sessions and scrolls, so the marquee fits its height: a wider block
    // shows more cabinets instead of bigger ones that crop the players.
    const scale = Math.max(1e-4, H / MARQUEE.height);
    return {
      scale, width: stageWidth * scale, height: DESIGN.height * scale,
      left: -MARQUEE.x0 * scale,
      top: MARQUEE.topFraction * H - MARQUEE.y * scale,
    };
  }
  const scale = Math.max(1e-4, Math.min(W / focusWidth, H / focusHeight));
  const spare = H - focusHeight * scale;
  const centred = (W - stageWidth * scale) / 2;
  return {
    scale, width: stageWidth * scale, height: DESIGN.height * scale,
    left: Math.min(Math.max(centred, -FOCUS.x0 * scale), W - FOCUS.x1 * scale),
    top: Math.min(VIEW.topFraction * H, spare / 2) - FOCUS.top * scale,
  };
}

// Scrolling the marquee: the stage can be wider than the block, a line report is SCROLL_LINE px,
// and the wheel's on-screen travel is divided by the scale so the row follows the pointer.
export const SCROLL_LINE = 60;
export const SCROLL_PAD = 150;

export function maxScroll(stageWidth, viewportW) {
  return Math.max(0, stageWidth - (viewportW > 0 ? viewportW : 0));
}

export function clampScroll(offset, stageWidth, viewportW) {
  const value = Number.isFinite(offset) ? offset : 0;
  return Math.max(0, Math.min(maxScroll(stageWidth, viewportW), value));
}

// The device px a wheel or trackpad event asks to travel: sideways travel first, else the vertical
// wheel, else the line report.
export function scrollDeltaOf(event) {
  const dx = Number(event?.delta?.x) || 0;
  const dy = Number(event?.delta?.y) || 0;
  const lx = Number(event?.delta_lines?.x) || 0;
  const ly = Number(event?.delta_lines?.y) || 0;
  if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) return dx;
  if (dy !== 0) return dy;
  if (lx !== 0 && Math.abs(lx) >= Math.abs(ly)) return lx * SCROLL_LINE;
  if (ly !== 0) return ly * SCROLL_LINE;
  return 0;
}

// The offset after a scroll event, clamped to the room past the stage's right edge.
export function scrollOffset(offset, event, stageWidth, viewportW, scale = 1) {
  const delta = scrollDeltaOf(event);
  if (!delta) return clampScroll(offset, stageWidth, viewportW);
  return clampScroll(offset - delta / (scale > 0 ? scale : 1), stageWidth, viewportW);
}

// How far to scroll so x is inside the viewport, leaving SCROLL_PAD of the neighbouring cabinets
// visible; an x already inside that band leaves the offset alone.
export function revealOffset(offset, x, stageWidth, viewportW, pad = SCROLL_PAD) {
  const left = offset + pad;
  const right = offset + viewportW - pad;
  if (x < left) return clampScroll(x - pad, stageWidth, viewportW);
  if (x > right) return clampScroll(x - viewportW + pad, stageWidth, viewportW);
  return clampScroll(offset, stageWidth, viewportW);
}

// Dragging a character about the floor: how far the pointer must travel before the press
// becomes a drag, how far the carried character hangs above its foot point, and the box a
// dropped character may land in.
export const DRAG_SLOP = 4;
export const LIFT = 28;
export const DROP_AREA = { left: 40, right: 1490, top: 420, bottom: 860 };

export function isDrag(fromWin, nowWin) {
  return Boolean(fromWin && nowWin) && Math.hypot(nowWin.x - fromWin.x, nowWin.y - fromWin.y) >= DRAG_SLOP;
}

// The carried foot point in design px: the press point plus the pointer's travel divided by the
// stage scale, kept inside the design. The stage scrolls as a whole, so the offset never enters
// this: the pointer's travel is the same however far the row has scrolled.
export function dragPoint(startDesign, fromWin, nowWin, scale, maxX = DESIGN.width) {
  const s = scale || 1;
  return {
    x: clamp(startDesign.x + (nowWin.x - fromWin.x) / s, [0, maxX]),
    y: clamp(startDesign.y + (nowWin.y - fromWin.y) / s, [0, DESIGN.height]),
  };
}

export function dropPoint(p, maxX = DROP_AREA.right) {
  return { x: clamp(p.x, [DROP_AREA.left, maxX]), y: clamp(p.y, [DROP_AREA.top, DROP_AREA.bottom]) };
}
