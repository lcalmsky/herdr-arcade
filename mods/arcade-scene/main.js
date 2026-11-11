// Arcade scene: the cards' sessions as characters in an arcade. The cards mod publishes the
// cast through shared("arcade-cards"); this mod only draws it and, on a click, focuses the pane
// the card itself would focus.

import { View, div, image } from "gpui-kit";
import { focused, shared, run, settings, setShared, props } from "herdr";
import { dragLayers, motionLayers, walkLayers } from "./motion.js";
import {
  ART, BUBBLE, BUBBLE_LIMIT, CAB_BASE_Y, CHIP, CHIP_GROUPS, CHIP_TONES, COUNTDOWN, DESIGN, DROP_AREA, FRAME_BG, LIFT,
  assignSpots, bubbleHeight, bubbleLayers, bubbleLeft, bubbleText, bubbleVisible, bubbleWidth, cabinetAt, cabinetCount,
  characterOpacity, chipCounts, clampScroll, countdownsOf, coverScale, dragPoint, dropPoint, isDrag, machineMoods, readFilter,
  revealOffset, screenBox, screenFor, scrollOffset, shownByFilter, spriteBox, staggerTops, stageWidthFor, tilesFor,
  toggleFilter, WALK_IN_MARGIN, WALK_Y, walkAt, walkLegs, waypoints, whoOf,
} from "./scene.js";

const LANDING_MS = 220;
export const RETURN_MS = 8000;
// The scene seats every session it is given while it is still coming up, so an app start shows the
// room already settled; only a session that joins once the scene has settled walks in.
export const SETTLE_MS = 5000;
const FOCUS_WATCH_MS = 100;
const COUNTDOWN_MS = 1000;
const FONT = "Galmuri11";
const INK = "#f1f0ff";
const FOCUS = "#f9d544";
const BUBBLE_INK = "#191035";
const BUBBLE_MAGENTA = "#ff41b4";
const BUBBLE_FILL = "#f1f0ff";

// The characters the keyboard can reach: a session with no focus target is not one of them.
export function charOrderOf(cast) {
  return (Array.isArray(cast) ? cast : []).filter((entry) => entry?.focus).map((entry) => entry.id);
}

// The cast entry behind the pane or terminal Herdr has focused, when the cards have no selection.
function focusedCast(cast) {
  const at = focused();
  if (!at) return null;
  return cast.find((entry) => entry.focus
    && ((at.pane && entry.focus.pane === at.pane) || (at.terminal && entry.focus.terminal === at.terminal))) ?? null;
}

// A chip key: ←→ move the highlight and wrap; ↩ and Space toggle the chip shown.
export function chipKey(key, at, count) {
  if (!(count > 0)) return null;
  if (key === "left") return { at: (at - 1 + count) % count, toggle: false };
  if (key === "right") return { at: (at + 1) % count, toggle: false };
  if (key === "enter" || key === "space") return { at: Math.min(at, count - 1), toggle: true };
  return null;
}

// A character key: ←→ move the highlight and wrap; ↩ and Space open the character shown.
export function charKey(key, at, ids) {
  const count = Array.isArray(ids) ? ids.length : 0;
  if (!(count > 0)) return null;
  if (key === "left") return { at: (at - 1 + count) % count, open: null };
  if (key === "right") return { at: (at + 1) % count, open: null };
  if (key === "enter" || key === "space") return { at: Math.min(at, count - 1), open: ids[Math.min(at, count - 1)] };
  return null;
}

function statusChips(cast, filter, chipAt, chipFocused, onPress) {
  const active = readFilter(filter);
  return chipCounts(cast).map(([label, n], i) => {
    const group = CHIP_GROUPS[i];
    const tone = CHIP_TONES[group];
    const on = active.includes(group);
    return div().id(`arcade-chip-${group}`).h(22).px(8).gap(6).flex().items_center().rounded(0)
      .bg(CHIP.bg).border(1).border_color(on ? CHIP.border : CHIP.line)
      .when(!on, (el) => el.hover((style) => style.border_color(CHIP.border)))
      .when(chipFocused && i === chipAt, (el) => el.border(2).border_color(FOCUS))
      .role("button").aria_selected(on).accessibility_label(`${label} ${n}`)
      .cursor_pointer().text_size(11).text_color(INK).font_family(FONT)
      .on_mouse_down("left", (_event, cx) => { onPress(); cx.stop_propagation(); })
      .on_click((_event, cx) => {
        cx.stop_propagation();
        setShared("arcade-filter", toggleFilter(filter, group));
      })
      .child(div().size(7).bg(tone.dot))
      .child(div().whitespace_nowrap().child(`${label} ${n}`));
  });
}

function motionStack(layers, base, content) {
  let node = content;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const sized = layer.prop === "width" || layer.prop === "height";
    const anchor = sized ? 0 : layer.prop === "left" ? base.left : base.top;
    const box = sized
      ? div().absolute().left(0).bottom(0).w(base.width).h(base.height).flex().flex_row().items_end().justify_center()
      : div().absolute().left(0).top(0).w(base.width).h(base.height);
    node = box.loop(layer.prop, {
      from: layer.from - anchor, to: layer.to - anchor, period: layer.period, easing: layer.easing,
    }).child(node);
  }
  return node;
}

function art(name) {
  return image(`mods/arcade-scene/art/${name}.webp`);
}

// A pixel tail under the bubble: two stepped blocks with the bubble's own outline.
function bubbleTail(scale, color) {
  const hair = Math.max(1, BUBBLE.border * scale);
  return div().ml(18 * scale).flex().flex_col()
    .child(div().w(13 * scale).h(7 * scale).bg(BUBBLE_FILL)
      .border_l(hair).border_r(hair).border_b(hair).border_color(color))
    .child(div().ml(3 * scale).w(7 * scale).h(5 * scale).bg(BUBBLE_FILL)
      .border_l(hair).border_r(hair).border_b(hair).border_color(color));
}

export default class ArcadeScene extends View {
  init(_props, cx) {
    this.chipHandle = cx.focus_handle();
    this.charHandle = cx.focus_handle();
    this.chipAt = 0;
    this.charAt = 0;
    this.chipKeys = false;
    this.charKeys = false;
    this.spots = {};
    this.drawn = {};
    this.walks = new Map();
    // The first cast after load is already seated; only sessions appearing once the scene has
    // settled walk in.
    this.loaded = false;
    this.startedAt = this.now();
    this.hovered = null;
    this.drag = null;
    this.pinned = new Map();
    this.droppedAt = new Map();
    this.landing = null;
    this.justDragged = false;
    this.scale = 1;
    this.stage = null;
    this.stageWidth = DESIGN.width;
    this.viewportWidth = 0;
    this.offset = 0;
    this.scrolledTo = null;
    this.frame = props()?.frame ?? null;
    // A ring comes from is_focused(), and the shell redraws only on notify or reload.
    cx.timer.every(FOCUS_WATCH_MS, (later) => this.watchFocus(later));
    // The countdown moves on the second; the digit itself is read off the clock, so a timer
    // that never fires still leaves the right number on the next render.
    cx.timer.every(COUNTDOWN_MS, (later) => {
      if (this.needsOn) later.notify();
    });
  }

  focusKey() {
    return `${this.chipKeys ? 1 : 0}${this.charKeys ? 1 : 0}|${this.chipHandle?.is_focused?.() ? 1 : 0}${this.charHandle?.is_focused?.() ? 1 : 0}`;
  }

  // Only the keyboard draws a ring: a click on the stage or a chip focuses it too.
  watchFocus(cx) {
    const key = this.focusKey();
    if (key === this.drawnFocus) return;
    this.drawnFocus = key;
    cx.notify();
  }

  // The root fills the block's inner box, so its measured size is the stage.
  sizeChanged(size, cx) {
    if (!(size.width > 0 && size.height > 0)) return;
    // On-screen px carry the app's zoom; the stage is at zoom 1.
    const zoom = Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1;
    const W = Math.round(size.width / zoom);
    const H = Math.round(size.height / zoom);
    if (W === this.stage?.W && H === this.stage?.H) return;
    this.stage = { W, H };
    cx.notify();
  }

  // Indirected so a test can advance the walk clock by hand.
  now() { return Date.now(); }

  sync(cast, cx) {
    const previous = this.spots;
    const settling = !this.loaded || this.now() - this.startedAt < SETTLE_MS;
    const spots = assignSpots(cast, previous);
    this.spots = spots;
    const live = new Set(cast.map((entry) => entry.id));
    for (const id of Object.keys(this.drawn)) {
      if (live.has(id)) continue;
      delete this.drawn[id];
      this.walks.delete(id);
      this.pinned.delete(id);
      this.droppedAt.delete(id);
      if (this.drag?.id === id) this.drag = null;
      if (this.hovered === id) this.hovered = null;
    }
    for (const entry of cast) {
      const spot = spots[entry.id];
      if (!spot) continue;
      if (!this.drawn[entry.id]) {
        // The sessions already on their way when the scene comes up are seated where they play.
        if (settling) {
          this.drawn[entry.id] = { x: spot.x, y: spot.y };
          continue;
        }
        // A session that joins once the scene has settled walks in from the stage's right edge.
        const spawn = { x: stageWidthFor(cast.length) - WALK_IN_MARGIN, y: WALK_Y };
        this.drawn[entry.id] = { ...spawn };
        this.startWalk(entry.id, waypoints(spawn, spot), cx);
        continue;
      }
      const moodChanged = previous[entry.id] && previous[entry.id].mood !== spot.mood;
      // A carried character is the pointer's to move. A dropped one stays put for RETURN_MS and
      // then walks back; either stage is read off the clock, so a timer that never fires cannot
      // leave it where it landed.
      if (this.drag?.id === entry.id) continue;
      let due = null;
      if (this.pinned.has(entry.id)) {
        const at = (this.droppedAt.get(entry.id) ?? this.now()) + RETURN_MS;
        if (!moodChanged && this.now() < at) continue;
        this.pinned.delete(entry.id);
        this.droppedAt.delete(entry.id);
        due = moodChanged ? null : at;
      }
      // A launch hands the scene a stale cast before the live scan; while settling, the move to the
      // live spot is a jump, so the room is already seated when the first live frame is drawn.
      if (settling) {
        this.walks.delete(entry.id);
        this.drawn[entry.id] = { x: spot.x, y: spot.y };
        continue;
      }
      const advanced = this.advanceWalk(entry.id, cx);
      const goal = advanced ? advanced.walk.path[advanced.walk.path.length - 1] : this.drawn[entry.id];
      if (goal.x === spot.x && goal.y === spot.y) continue;
      const start = advanced ? advanced.position : this.drawn[entry.id];
      this.startWalk(entry.id, waypoints(start, spot), cx, due ?? undefined);
    }
    if (cast.length) this.loaded = true;
  }

  startWalk(id, path, cx, started = this.now()) {
    const { legs, total } = walkLegs(path);
    if (!legs.length) {
      this.walks.delete(id);
      if (path[0]) this.drawn[id] = { ...path[0] };
      return;
    }
    this.walks.set(id, { id, path, legs, total, started, armed: -1, ms: legs[0].ms });
    this.advanceWalk(id, cx);
  }

  // The drawn point of a walk is read off the clock at every render, so the next redraw request
  // is the timer's only job: one that never fires still leaves the walk where time says.
  advanceWalk(id, cx) {
    const walk = this.walks.get(id);
    if (!walk) return null;
    const at = walkAt(walk, this.now());
    if (at.done) {
      this.walks.delete(id);
      this.drawn[id] = { ...walk.path[walk.path.length - 1] };
      return null;
    }
    this.drawn[id] = { ...at.to };
    walk.ms = at.remaining;
    if (walk.armed !== at.leg) {
      walk.armed = at.leg;
      cx.timer.after(at.remaining, (later) => {
        if (this.walks.get(id) !== walk) return;
        this.advanceWalk(id, later);
        later.notify();
      });
    }
    return { walk, position: at.position };
  }

  dragStart(id, windowPos, cx) {
    // A walking character's drawn point is the leg's destination, so pick it up where it is
    // drawn now rather than where the leg ends.
    const walk = this.walks.get(id);
    const position = walk ? walkAt(walk, this.now()).position : this.drawn[id];
    if (!position) return;
    this.justDragged = false;
    this.drag = { id, fromWin: { ...windowPos }, start: { ...position }, carried: null, mood: this.spots[id]?.mood };
    cx.notify();
  }

  dragMove(windowPos, cx) {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.carried) {
      if (!isDrag(drag.fromWin, windowPos)) return;
      drag.carried = { ...drag.start };
      this.walks.delete(drag.id);
      this.pinned.delete(drag.id);
      this.droppedAt.delete(drag.id);
    }
    drag.carried = dragPoint(drag.start, drag.fromWin, windowPos, this.scale, this.dropMaxX());
    this.drawn[drag.id] = { ...drag.carried };
    cx.notify();
  }

  dragEnd(cx) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (!drag.carried) return;
    const foot = dropPoint(drag.carried, this.dropMaxX());
    this.drawn[drag.id] = foot;
    const spot = this.spots[drag.id];
    if (spot && spot.mood !== drag.mood) {
      // The mood changed while it was carried, so the drop goes to the new mood's place
      // instead of pinning the character where it happened to land.
      this.startWalk(drag.id, waypoints(foot, spot), cx);
    } else {
      this.pinned.set(drag.id, foot);
      this.droppedAt.set(drag.id, this.now());
      cx.timer.after(RETURN_MS, (later) => {
        if (this.pinned.has(drag.id)) later.notify();
      });
    }
    this.justDragged = true;
    this.landing = { id: drag.id, until: this.now() + LANDING_MS };
    cx.timer.after(LANDING_MS, (later) => {
      if (this.landing?.id === drag.id && this.now() >= this.landing.until) this.landing = null;
      later.notify();
    });
    cx.notify();
  }

  // The right end a dropped character may reach: the stage's right edge keeps the same inset.
  dropMaxX() {
    return this.stageWidth - (DESIGN.width - DROP_AREA.right);
  }

  // The wheel and the trackpad move the marquee sideways; the offset is clamped to the row.
  wheel(event, cx) {
    const { W, H } = this.stage ?? { W: 560, H: 276 };
    const cover = coverScale(W, H, this.frame, this.stageWidth);
    const viewport = W / cover.scale;
    const next = scrollOffset(this.offset, event, this.stageWidth, viewport, cover.scale);
    if (next === this.offset) return;
    this.offset = next;
    cx.notify();
  }

  // The cards' selection, else the pane Herdr has focused, brings its cabinet into view once.
  revealFocus(cast) {
    const target = cast.find((entry) => entry.selected) ?? focusedCast(cast);
    const id = target?.id ?? null;
    if (id === this.scrolledTo) return;
    this.scrolledTo = id;
    const spot = id ? this.spots[id] : null;
    if (spot) this.offset = revealOffset(this.offset, spot.x, this.stageWidth, this.viewportWidth);
  }

  // The squash after a drop ends on the clock, so a timer that never fires cannot leave the
  // character flattened.
  squashing(id) {
    const landing = this.landing;
    if (!landing || landing.id !== id) return false;
    if (this.now() < landing.until) return true;
    this.landing = null;
    return false;
  }

  clickCharacter(entry, cx) {
    cx.stop_propagation();
    // The release that ends a drag may land on the character itself, and the click may run
    // before that release's handler, so end the drag here first either way.
    if (this.drag) this.dragEnd(cx);
    if (this.justDragged) {
      this.justDragged = false;
      return;
    }
    if (entry.focus) run("pane.focus", entry.focus);
  }

  character(entry, spot, position, walking, s, shown, keyboardFocused = false) {
    const pose = walking ? "alert" : spot.pose;
    const name = `${whoOf(entry.who)}_${pose}`;
    const box = spriteBox(name, position.x, position.y, s);
    const base = { left: box.left, top: box.top, width: box.width, height: box.height };
    const dragging = this.drag?.id === entry.id && Boolean(this.drag.carried);
    const squash = !dragging && this.squashing(entry.id);
    const width = squash ? base.width * 1.14 : base.width;
    const height = squash ? base.height * 0.86 : base.height;
    const layers = dragging
      ? dragLayers(base, s)
      : squash
        ? []
        : walking
          ? walkLayers(base, s)
          : motionLayers(spot.mood, base, s);
    const face = art(name);
    const squashed = (el) => el.absolute().left((base.width - width) / 2).top(base.height - height).w(width).h(height);
    const content = squash ? squashed(face) : face.w(base.width).h(base.height);
    return div().id(`arcade-char-${entry.id}`).absolute().left(base.left).top(base.top).w(base.width).h(base.height)
      .opacity(characterOpacity(shown, dragging))
      .transition("opacity", { duration: 400 })
      // A carried character tracks the pointer, so its position must not ease behind it.
      .transition("left", { duration: dragging ? 0 : walking ? walking.ms : 400, easing: "ease-in-out" })
      .transition("top", { duration: dragging ? 0 : walking ? walking.ms : 400, easing: "ease-in-out" })
      .when(Boolean(entry.focus), (el) => el.cursor_pointer().role("button")
        .accessibility_label(entry.topic ?? entry.who ?? "Session"))
      .when(keyboardFocused, (el) => el.border(2).border_color(FOCUS).rounded(0))
      .on_mouse_down("left", (event, cx) => this.dragStart(entry.id, event.position, cx))
      .on_mouse_up("left", (_event, cx) => this.dragEnd(cx))
      .on_hover((hovered, cx) => {
        if (hovered) this.hovered = entry.id;
        else if (this.hovered === entry.id) this.hovered = null;
        cx.notify();
      })
      .when(Boolean(entry.focus), (el) => el.on_click((_event, clickCx) => this.clickCharacter(entry, clickCx)))
      .child(motionStack(layers, base, content));
  }

  // One speech bubble: the fill and outline by mood, a tail under it, and the text in the dark
  // ink. Needs you's "!" leads the line.
  bubbleView(spec, opacity, s) {
    const { entry, text, flagged, walking, left, top, height } = spec;
    const line = flagged ? BUBBLE_MAGENTA : BUBBLE_INK;
    const hair = Math.max(1, BUBBLE.border * s);
    return div().id(`arcade-bubble-${entry.id}`).absolute().left(left).top(top).flex().flex_col()
      .opacity(opacity)
      .transition("left", { duration: walking ? walking.ms : 400, easing: "ease-in-out" })
      .transition("top", { duration: walking ? walking.ms : 400, easing: "ease-in-out" })
      .child(div().h(height).pl(BUBBLE.pad * s).pr(BUBBLE.pad * s).flex().items_center().rounded(0)
        .bg(BUBBLE_FILL).border(hair).border_color(line)
        .when(flagged, (el) => el.child(art("exclaim").flex_none().w(26 * s).h(26 * s).mr(BUBBLE.gap * s)))
        .child(div().whitespace_nowrap().text_size(BUBBLE.font * s).font_family(FONT)
          .text_color(BUBBLE_INK).child(text)))
      .child(bubbleTail(s, line));
  }

  render(cx) {
    const cast = shared("arcade-cards")?.cast ?? [];
    const filter = readFilter(shared("arcade-filter"));
    this.drawnFocus = this.focusKey();
    const chipFocused = this.chipKeys && Boolean(this.chipHandle?.is_focused?.());
    const charFocused = this.charKeys && Boolean(this.charHandle?.is_focused?.());
    this.chipAt = Math.min(Math.max(this.chipAt ?? 0, 0), CHIP_GROUPS.length - 1);
    const charOrder = charOrderOf(cast);
    this.charAt = Math.min(Math.max(this.charAt ?? 0, 0), Math.max(0, charOrder.length - 1));
    this.sync(cast, cx);
    const { W, H } = this.stage ?? { W: 560, H: 276 };
    const stageWidth = stageWidthFor(cast.length);
    const cover = coverScale(W, H, this.frame, stageWidth);
    const s = cover.scale;
    this.scale = s;
    this.stageWidth = stageWidth;
    this.viewportWidth = W / s;
    this.offset = clampScroll(this.offset, stageWidth, this.viewportWidth);
    this.revealFocus(cast);

    const scenery = [];
    const machines = machineMoods(cast, this.spots);
    const cabinetTotal = cabinetCount(cast, this.spots);
    this.needsOn = machines.includes("needs");
    for (let index = 0; index < cabinetTotal; index += 1) {
      const cabinet = cabinetAt(index);
      const box = spriteBox(cabinet.art, cabinet.x, CAB_BASE_Y, s);
      scenery.push({ depth: CAB_BASE_Y, order: 0,
        element: art(cabinet.art).absolute().left(box.left).top(box.top).w(box.width).h(box.height) });
      const screen = screenFor(machines[index]);
      const slot = screenBox(cabinet, s);
      let element = art(screen.art).absolute().left(slot.left).top(slot.top).w(slot.width).h(slot.height)
        .opacity(screen.opacity);
      if (screen.blink) {
        element = element.loop("opacity", {
          from: screen.blink.from, to: screen.blink.to, period: screen.blink.period, easing: "ease-in-out",
        });
      }
      scenery.push({ depth: CAB_BASE_Y, order: 1, element });
    }

    // A needs machine counts down over its screen, in the yellow the layout uses for focus.
    for (const { cab, digit } of countdownsOf(cast, this.spots, this.now())) {
      const slot = screenBox(cabinetAt(cab), s);
      const box = {
        left: slot.left + slot.width * COUNTDOWN.x0,
        top: slot.top + slot.height * COUNTDOWN.y0,
        width: slot.width * (COUNTDOWN.x1 - COUNTDOWN.x0),
        height: slot.height * (COUNTDOWN.y1 - COUNTDOWN.y0),
      };
      scenery.push({ depth: CAB_BASE_Y, order: 2,
        element: div().id(`arcade-countdown-${cab}`).absolute().left(box.left).top(box.top).w(box.width).h(box.height)
          .flex().items_center().justify_center()
          .child(div().whitespace_nowrap().text_size(Math.max(1, Math.round(box.height * 1.45))).font_family(FONT).font_bold()
            .text_color(FOCUS).child(digit)) });
    }

    const bubbles = [];
    const bubbleSpecs = [];
    for (const entry of cast) {
      const spot = this.spots[entry.id];
      if (!spot) continue;
      const position = this.drawn[entry.id] ?? { x: spot.x, y: spot.y };
      const walking = this.walks.get(entry.id);
      const dragging = this.drag?.id === entry.id && Boolean(this.drag.carried);
      const shown = shownByFilter(filter, entry.mood);
      const anchor = dragging ? { x: position.x, y: position.y - LIFT } : position;
      const shadowBox = spriteBox(entry.selected ? "glow" : "shadow", position.x, position.y, s);
      // The selected card's character stands in a yellow glow cut from the shadow's own mask.
      const shadow = art(entry.selected ? "glow" : "shadow")
        .absolute().left(shadowBox.left).top(shadowBox.top).w(shadowBox.width).h(shadowBox.height)
        .id(`arcade-shadow-${entry.id}`)
        .opacity(dragging ? 0.5 : shown ? 1 : 0.15)
        .transition("left", { duration: dragging ? 0 : walking ? walking.ms : 400, easing: "ease-in-out" })
        .transition("top", { duration: dragging ? 0 : walking ? walking.ms : 400, easing: "ease-in-out" });
      scenery.push({ depth: position.y - 0.1, order: 1, element: shadow });
      scenery.push({ depth: position.y, order: 1,
        element: this.character(entry, spot, anchor, walking, s, shown, charFocused && charOrder[this.charAt] === entry.id) });

      const pose = walking ? "alert" : spot.pose;
      const name = `${whoOf(entry.who)}_${pose}`;
      const head = { x: position.x, y: position.y - ART[name].size[1] };
      if (shown && !dragging) {
        if (entry.mood === "stall") {
          const box = spriteBox("dots", head.x + 20, head.y - 10, s);
          scenery.push({ depth: position.y + 0.01, order: 2,
            element: art("dots").absolute().left(box.left).top(box.top).w(box.width).h(box.height) });
        } else if (entry.mood === "needs") {
          const box = spriteBox("exclaim", head.x + 26, head.y - 8, s);
          scenery.push({ depth: position.y + 0.01, order: 2,
            element: art("exclaim").absolute().left(box.left).top(box.top).w(box.width).h(box.height)
              .loop("opacity", { from: 0.2, to: 1, period: 700, easing: "ease-in-out" }) });
        } else if (entry.mood === "done") {
          const box = spriteBox("sparkle", head.x + ART[name].size[0] / 2 - 4, head.y + ART[name].size[1] * 0.3, s);
          scenery.push({ depth: position.y + 0.01, order: 2,
            element: art("sparkle").absolute().left(box.left).top(box.top).w(box.width).h(box.height)
              .loop("opacity", { from: 0.2, to: 1, period: 800, easing: "ease-in-out" }) });
        } else if (entry.mood === "viewed") {
          const box = spriteBox("zzz", head.x + 16, head.y - 6, s);
          scenery.push({ depth: position.y + 0.01, order: 2,
            element: art("zzz").absolute().left(box.left).top(box.top).w(box.width).h(box.height)
              .loop("top", { from: box.top, to: box.top - 8 * s, period: 2600, easing: "ease-in-out" }) });
        }
      }

      // The marquee crops at the chest, so a bubble there would float over a body no longer in
      // view; the control panel's info area carries the line instead.
      const limit = this.frame === "marquee" ? 0 : BUBBLE_LIMIT[entry.mood];
      const text = limit ? bubbleText(entry.topic ?? "", limit) : "";
      if (text && !dragging && shown && bubbleVisible(entry.mood, entry.id, this.hovered)) {
        const flagged = entry.mood === "needs";
        const height = bubbleHeight(s);
        bubbleSpecs.push({
          entry, text, flagged, walking, id: entry.id,
          left: bubbleLeft(position.x, text, s, W - cover.left, flagged),
          top: head.y * s - height - 10 * s,
          width: bubbleWidth(text, s, flagged), height,
        });
      }
    }

    // The always-on Needs you bubbles take turns vertically where they would overlap.
    const urgent = bubbleSpecs.filter((spec) => spec.flagged);
    staggerTops(urgent, BUBBLE.gap * s).forEach((top, index) => { urgent[index].top = top; });

    for (const { index, opacity } of bubbleLayers(bubbleSpecs, this.hovered)) {
      bubbles.push(this.bubbleView(bubbleSpecs[index], opacity, s));
    }

    const sorted = scenery.slice().sort((a, b) => a.depth - b.depth || a.order - b.order).map((item) => item.element);
    // Every other tile is the mirrored art, so the seam where a tile ends matches the one it meets.
    const tiles = [];
    // The art also fills a block wider than the row, so a short row never ends in a bare edge.
    for (let index = 0; index < tilesFor(Math.max(stageWidth, this.offset + this.viewportWidth)); index += 1) {
      const source = index % 2 ? "background_mirror" : "background";
      tiles.push(art(source).absolute().left(index * DESIGN.width * s).top(0)
        .w(DESIGN.width * s).h(DESIGN.height * s));
    }
    return div().id("arcade-scene").size_full()
      .on_size_change((size, cx) => this.sizeChanged(size, cx))
      .child(div().id("arcade-frame").w(W).h(H).relative().overflow_hidden().rounded(0).bg(FRAME_BG)
        .on_mouse_move((event, cx) => this.dragMove(event.position, cx))
        .on_mouse_up("left", (_event, cx) => this.dragEnd(cx))
        .on_scroll_wheel((event, cx) => this.wheel(event, cx))
        .on_hover((hovered, cx) => {
          if (!hovered) this.dragEnd(cx);
        })
        .child(div().id("arcade-stage").absolute().left(cover.left - this.offset * s).top(cover.top)
          .w(cover.width).h(cover.height)
          .track_focus(this.charHandle).tab_index(0)
          .on_mouse_down("left", () => { this.charKeys = false; })
          .on_key_down((event, cx) => {
            const next = charKey(event.key, this.charAt, charOrder);
            if (!next) return;
            this.charKeys = true;
            this.charAt = next.at;
            if (next.open) {
              const entry = cast.find((candidate) => candidate.id === next.open);
              if (entry) this.clickCharacter(entry, cx);
            }
            cx.stop_propagation();
            cx.notify();
          })
          .children(tiles)
          .children(sorted)
          .children(bubbles))
        .child(div().id("arcade-chips").absolute().top(8).right(8).flex().gap(6)
          .track_focus(this.chipHandle).tab_index(0)
          .on_key_down((event, cx) => {
            const next = chipKey(event.key, this.chipAt, CHIP_GROUPS.length);
            if (!next) return;
            this.chipKeys = true;
            this.chipAt = next.at;
            if (next.toggle) setShared("arcade-filter", toggleFilter(filter, CHIP_GROUPS[this.chipAt]));
            cx.stop_propagation();
            cx.notify();
          })
          .children(statusChips(cast, filter, this.chipAt, chipFocused, () => { this.chipKeys = false; }))));
  }
}
