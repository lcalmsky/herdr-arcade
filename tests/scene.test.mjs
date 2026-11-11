// Scene tests for the arcade-scene mod: machine assignment, the mood screens, placement, bubble
// cuts, walk paths, the walk and drag timers, and the stage scale. Run:
// node --import ./tests/stubs/register.mjs --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import ArcadeScene, { RETURN_MS, SETTLE_MS, charOrderOf, charKey, chipKey } from "../mods/arcade-scene/main.js";
import { MOOD_MOTION, dragLayers, motionLayers, walkLayers } from "../mods/arcade-scene/motion.js";
import {
  ART, BENCH_SPOTS, BUBBLE, BUBBLE_LIMIT, CABINETS, CAB_BASE_Y, CHIP, CHIP_GROUPS, CHIP_TONES, DESIGN,
  DROP_AREA, ENTRY, FLOOR_SPOTS, FOOT_Y, FOCUS, FRAME_BG, LIFT, MARQUEE, POSE, SCREEN, SPECTATOR_SPOTS, VIEW, VIEWED_SPOTS,
  WALK_Y,
  assignSpots, bubbleHeight, bubbleLayers, bubbleLeft, bubbleText, bubbleVisible, bubbleWidth, characterOpacity, chipCounts,
  coverScale,
  COUNTDOWN, countdownDigit, countdownsOf, machineSessions,
  machineMoods, moodGroup, overlapping, readFilter, screenBox, screenFor, shownByFilter, spriteBox, staggerTops,
  toggleFilter, walkPosition, waypoints, legMs, whoOf,
  DRAG_SLOP, dragPoint, dropPoint, isDrag,
} from "../mods/arcade-scene/scene.js";

const cast = (pairs) => pairs.map(([id, mood]) => ({ id, mood }));
const feet = ([x, y]) => ({ x, y });

// A view with timers that queue instead of firing, and a clock the queue advances, so a test
// runs the walk by hand.
function scene() {
  const queue = [];
  let clock = 0;
  const cx = {
    notifies: 0,
    every: [],
    timer: {
      after(ms, fn) {
        const task = { ms, at: clock + ms, fn, cancelled: false, cancel() { task.cancelled = true; } };
        queue.push(task);
        return task;
      },
      every(ms, fn) { cx.every.push({ ms, fn }); return { cancel() {} }; },
    },
    notify() { cx.notifies += 1; },
    stop_propagation() {},
    focus_handle() { return { focus() {}, is_focused: () => false, release() { return true; } }; },
  };
  const view = new ArcadeScene();
  view.now = () => clock;
  view.init(null, cx);
  const advance = (ms) => { clock += ms; };
  // Settling also carries the clock past the launch window, where moves are jumps, not walks.
  const settle = () => {
    clock = Math.max(clock, SETTLE_MS);
    for (let guard = 0; guard < 1000; guard += 1) {
      if (!queue.length) return;
      queue.sort((a, b) => a.at - b.at);
      const task = queue.shift();
      clock = Math.max(clock, task.at);
      if (!task.cancelled) task.fn(cx);
    }
    throw new Error("the walk timers never settled");
  };
  return { view, cx, queue, settle, advance };
}

test("the sessions already there when the scene loads stand in their places, without walking in", () => {
  const { view, cx } = scene();
  view.sync(cast([["a", "working"], ["v", "viewed"]]), cx);
  assert.equal(view.walks.size, 0, "the first cast starts no walk");
  assert.deepEqual(view.drawn.a, feet([CABINETS[0].x, FOOT_Y.working]));
  assert.deepEqual(view.drawn.v, feet(BENCH_SPOTS[0]));
});

test("a session that joins while the scene is still coming up stands in its place without walking", () => {
  const { view, cx, advance } = scene();
  view.sync(cast([["a", "working"]]), cx);
  advance(SETTLE_MS - 1000);
  view.sync(cast([["a", "working"], ["b", "needs"]]), cx);
  assert.equal(view.walks.size, 0, "a late arrival inside the settle window starts no walk");
  assert.deepEqual(view.drawn.b, feet([CABINETS[1].x, FOOT_Y.needs]), "it stands at its machine");
});

test("a session that appears once the scene has settled walks in from the doorway to its machine", () => {
  const { view, cx, advance, settle } = scene();
  view.sync(cast([["a", "working"]]), cx);
  advance(SETTLE_MS);
  view.sync(cast([["a", "working"], ["b", "needs"]]), cx);
  const walk = view.walks.get("b");
  assert.ok(walk, "the new session walks");
  assert.deepEqual(walk.path[0], ENTRY, "it starts at the doorway");
  assert.deepEqual(walk.path.at(-1), feet([CABINETS[1].x, FOOT_Y.needs]), "and ends at the second machine");
  assert.deepEqual(view.drawn.b, walk.legs[0].to, "it is drawn on the first leg");
  settle();
  assert.deepEqual(view.drawn.b, feet([CABINETS[1].x, FOOT_Y.needs]), "the walk ends in front of the machine");
});

test("a session walks in solid and its machine shows its play screen", () => {
  const { view, cx, advance, settle } = scene();
  view.sync(cast([["a", "working"]]), cx);
  advance(SETTLE_MS);
  view.sync(cast([["a", "working"], ["b", "working"]]), cx);
  assert.deepEqual(view.drawn.b, { x: ENTRY.x, y: WALK_Y }, "the first frame shows it on the walk");
  assert.equal(characterOpacity(true, false), 1, "a shown character never waits on a fade");
  settle();
  assert.deepEqual(view.drawn.b, feet([CABINETS[1].x, FOOT_Y.working]), "the walk ends at its machine");
  assert.equal(view.walks.has("b"), false);
  const moods = machineMoods(cast([["a", "working"], ["b", "working"]]), view.spots);
  assert.deepEqual(moods, ["working", "working", null, null, null, null]);
  assert.equal(screenFor(moods[0]).art, "scr_play");
  assert.equal(characterOpacity(false, false), 0.15, "a filtered-out character is dimmed");
  assert.equal(characterOpacity(false, true), 1, "a carried one is solid");
});

test("a mood that moves the character walks it to its new place", () => {
  const { view, cx, settle } = scene();
  view.sync(cast([["a", "working"]]), cx);
  settle();
  view.sync(cast([["a", "needs"]]), cx);
  const walk = view.walks.get("a");
  assert.ok(walk, "the mood change starts a walk");
  assert.deepEqual(walk.path.at(-1), feet([CABINETS[0].x, FOOT_Y.needs]));
  assert.equal(view.spots.a.cab, 0, "and it keeps the same machine");
});

test("a session keeps its machine while its mood changes", () => {
  const first = assignSpots(cast([["a", "needs"], ["b", "stall"]]), {});
  assert.deepEqual([first.a.cab, first.b.cab], [0, 1]);
  const changed = assignSpots(cast([["a", "done"], ["b", "needs"]]), first);
  assert.equal(changed.a.cab, 0, "the machine stays even though b's new mood outranks it");
  assert.equal(changed.b.cab, 1);
  assert.deepEqual([changed.a.x, changed.a.y], [CABINETS[0].x, FOOT_Y.done]);
  assert.deepEqual([changed.b.x, changed.b.y], [CABINETS[1].x, FOOT_Y.needs]);
  assert.equal(changed.a.pose, "cheer");
  assert.equal(changed.b.pose, "alert");
});

test("a viewed session gives up its machine, and the next session takes the leftmost free one", () => {
  const three = assignSpots(cast([["a", "working"], ["b", "working"], ["c", "working"]]), {});
  assert.deepEqual([three.a.cab, three.b.cab, three.c.cab], [0, 1, 2]);

  const read = assignSpots(cast([["a", "working"], ["b", "viewed"], ["c", "working"]]), three);
  assert.equal(read.b.kind, "viewed", "the read one leaves the machines");
  assert.deepEqual([read.b.x, read.b.y], BENCH_SPOTS[0]);
  assert.equal(read.a.cab, 0);
  assert.equal(read.c.cab, 2, "the machines it left behind are free");

  const next = assignSpots(cast([["a", "working"], ["b", "viewed"], ["c", "working"], ["d", "needs"]]), read);
  assert.equal(next.d.cab, 1, "a new session takes the leftmost empty machine");
  assert.deepEqual([next.d.x, next.d.y], [CABINETS[1].x, FOOT_Y.needs]);
});

test("the seventh session past the machines watches from the aisle", () => {
  const many = Array.from({ length: 7 }, (_, i) => [`s${i}`, "working"]);
  const spots = assignSpots(cast(many), {});
  for (let i = 0; i < CABINETS.length; i += 1) {
    assert.equal(spots[`s${i}`].kind, "cab");
    assert.equal(spots[`s${i}`].cab, i);
  }
  const seventh = spots.s6;
  assert.equal(seventh.kind, "spectator", "past the sixth machine there is no machine left");
  assert.deepEqual([seventh.x, seventh.y], SPECTATOR_SPOTS[0]);
  assert.equal(seventh.pose, "back");

  const more = assignSpots(cast([...many, ["s7", "done"]]), spots);
  assert.equal(more.s7.kind, "spectator");
  assert.deepEqual([more.s7.x, more.s7.y], SPECTATOR_SPOTS[1], "watchers queue up in order");
});

test("watchers fill the empty right floor, then the right-hand gaps, in rows towards the viewer", () => {
  const many = Array.from({ length: 15 }, (_, i) => [`s${i}`, "working"]);
  const spots = assignSpots(cast(many), {});
  const watchers = many.slice(6).map(([id]) => spots[id]);
  assert.deepEqual(watchers.slice(0, 5).map((spot) => [spot.x, spot.y]),
    [[1250, 810], [1400, 810], [1007, 810], [832, 810], [657, 810]], "the right floor first, then the gaps");
  assert.deepEqual(watchers.slice(5, 10).map((spot) => [spot.x, spot.y]),
    [[1250, 860], [1400, 860], [1007, 860], [832, 860]], "the overflow takes the row closer to the viewer");
  for (const spot of watchers) {
    assert.equal(spot.kind, "spectator");
    assert.ok(spot.y >= 810 && spot.y <= 860, "watchers stay in the front aisle");
    assert.ok(!CABINETS.some((cabinet) => cabinet.x === spot.x), "no watcher stands on a machine's x, where needs stands");
    assert.ok(![FOOT_Y.working, FOOT_Y.needs, FOOT_Y.done, FOOT_Y.stall].includes(spot.y),
      "no watcher shares a player's line");
  }
  assert.equal(new Set(watchers.map((spot) => `${spot.x},${spot.y}`)).size, watchers.length,
    "every watcher gets a place of their own");
});

test("machines go to needs, then done, then stall, then working", () => {
  const moods = ["working", "stall", "done", "needs", "working", "stall", "working", "working"];
  const spots = assignSpots(cast(moods.map((mood, i) => [`p${i}`, mood])), {});
  assert.deepEqual([spots.p3.cab, spots.p2.cab], [0, 1], "needs and done take the first two machines");
  assert.deepEqual([spots.p1.cab, spots.p5.cab], [2, 3], "then the stalls, in cast order");
  assert.deepEqual([spots.p0.cab, spots.p4.cab], [4, 5], "working sessions take what is left");
  assert.equal(spots.p6.kind, "spectator", "the lowest-priority working session watches");
  assert.equal(spots.p7.kind, "spectator");
});

test("a session that already has a machine keeps it when a needier one arrives", () => {
  const first = assignSpots(cast([["w", "working"]]), {});
  const next = assignSpots(cast([["w", "working"], ["n", "needs"]]), first);
  assert.equal(next.w.cab, 0, "the working session keeps machine 0");
  assert.equal(next.n.cab, 1, "the new Needs you takes the free machine");
});

test("read sessions sleep on the bench, then on the floor in front of it", () => {
  const four = assignSpots(cast([["a", "viewed"], ["b", "viewed"], ["c", "viewed"], ["d", "viewed"]]), {});
  assert.deepEqual([four.a.x, four.a.y], BENCH_SPOTS[0]);
  assert.deepEqual([four.b.x, four.b.y], BENCH_SPOTS[1]);
  assert.deepEqual([four.c.x, four.c.y], BENCH_SPOTS[2]);
  assert.deepEqual([four.d.x, four.d.y], FLOOR_SPOTS[0]);
  for (const id of ["a", "b", "c", "d"]) {
    assert.equal(four[id].kind, "viewed");
    assert.equal(four[id].pose, "sleep");
  }
  assert.deepEqual([...BENCH_SPOTS, ...FLOOR_SPOTS], VIEWED_SPOTS);
});

test("a sleeping session keeps its bench spot while its mood is unchanged", () => {
  const first = assignSpots(cast([["a", "viewed"], ["b", "viewed"]]), {});
  const reordered = assignSpots(cast([["b", "viewed"], ["a", "viewed"]]), first);
  assert.deepEqual(reordered.a, first.a);
  assert.deepEqual(reordered.b, first.b);
});

test("no two sessions are given the same place", () => {
  const moods = ["working", "needs", "stall", "done", "viewed"];
  const people = Array.from({ length: 11 }, (_, i) => [`p${i}`, moods[i % moods.length]]);
  const spots = assignSpots(cast(people), {});
  const places = Object.values(spots).map((spot) => `${spot.kind}:${spot.x},${spot.y}`);
  assert.equal(new Set(places).size, places.length);
});

test("the machines show each mood's screen and a still demo when empty or read", () => {
  assert.deepEqual(screenFor("working"), { art: "scr_play", opacity: 1, blink: { from: 0.85, to: 1, period: 900 } });
  assert.deepEqual(screenFor("needs"), { art: "scr_continue", opacity: 1, blink: { from: 0.35, to: 1, period: 600 } });
  assert.deepEqual(screenFor("stall"), { art: "scr_pause", opacity: 1 });
  assert.deepEqual(screenFor("done"), { art: "scr_highscore", opacity: 1 });
  assert.deepEqual(screenFor(null), { art: "scr_demo", opacity: 0.7 });
  assert.deepEqual(screenFor("viewed"), { art: "scr_demo", opacity: 0.7 });
});

test("a machine's screen follows the session standing at it", () => {
  const people = cast([["a", "working"], ["b", "viewed"], ["c", "needs"]]);
  const moods = machineMoods(people, assignSpots(people, {}));
  assert.deepEqual(moods, ["needs", "working", null, null, null, null]);
  assert.deepEqual(screenFor(moods[0]).art, "scr_continue");
  assert.deepEqual(screenFor(moods[1]).art, "scr_play");
  assert.deepEqual(screenFor(moods[2]).art, "scr_demo");
});

test("a needs machine counts down 9 to 0 on the second, then back to 9", () => {
  const since = 1_800_000_000_000;
  assert.equal(countdownDigit(since, since), "9");
  assert.equal(countdownDigit(since, since + 999), "9", "the first second is still 9");
  assert.equal(countdownDigit(since, since + 1000), "8");
  assert.equal(countdownDigit(since, since + 9_000), "0");
  assert.equal(countdownDigit(since, since + 10_000), "9", "after 0 it starts over at 9");
  assert.equal(countdownDigit(since, since - 5_000), "9", "a clock behind the start still reads 9");
  assert.equal(countdownDigit(null, since), null);
  assert.equal(countdownDigit(since, Number.NaN), null);
});

test("only a needs machine with a start time shows a countdown", () => {
  const people = [
    { id: "n", mood: "needs", since: 1_000 },
    { id: "w", mood: "working", since: 2_000 },
    { id: "n2", mood: "needs" },
    { id: "s", mood: "stall", since: 3_000 },
  ];
  const spots = assignSpots(people, {});
  const seated = machineSessions(people, spots);
  assert.equal(seated[spots.n.cab].id, "n");
  assert.equal(seated[spots.s.cab].id, "s");
  assert.deepEqual(countdownsOf(people, spots, 2_000), [{ cab: spots.n.cab, digit: "8" }]);
  assert.deepEqual(countdownsOf(people, spots, 1_000), [{ cab: spots.n.cab, digit: "9" }]);
});

test("the countdown sits over the digit the continue art draws", () => {
  assert.ok(COUNTDOWN.x0 < 0.41 && COUNTDOWN.x1 > 0.58, "the box spans the art's 9 across");
  assert.ok(COUNTDOWN.y0 < 0.43 && COUNTDOWN.y1 > 0.74, "and down its height");
});

test("the screen inset is cut from the cabinet sprite's own box", () => {
  const box = spriteBox(CABINETS[0].art, CABINETS[0].x, CAB_BASE_Y, 1);
  const slot = screenBox(CABINETS[0], 1);
  assert.equal(box.left, CABINETS[0].x - ART[CABINETS[0].art].anchor[0]);
  assert.equal(box.top, CAB_BASE_Y - ART[CABINETS[0].art].anchor[1]);
  assert.ok(Math.abs(slot.left - (box.left + box.width * SCREEN.x0)) < 1e-9);
  assert.ok(Math.abs(slot.top - (box.top + box.height * SCREEN.y0)) < 1e-9);
  assert.ok(Math.abs(slot.width - box.width * (SCREEN.x1 - SCREEN.x0)) < 1e-9);
  assert.ok(Math.abs(slot.height - box.height * (SCREEN.y1 - SCREEN.y0)) < 1e-9);
  assert.ok(slot.left >= box.left && slot.left + slot.width <= box.left + box.width);
});

test("sprites anchor at their bottom centre, in design px times the scale", () => {
  assert.deepEqual(ART.shadow, { size: [176, 48], anchor: [88, 24] });
  assert.deepEqual(spriteBox("kid_back", 220, 700, 1), { left: 220 - 58.4, top: 700 - 192, width: 117, height: 192 });
  assert.deepEqual(spriteBox("cab_magenta", 220, 640, 0.5),
    { left: (220 - 97) * 0.5, top: (640 - 307) * 0.5, width: 97, height: 153.5 });
  assert.equal(whoOf("cat"), "cat");
  assert.equal(whoOf("nobody"), "kid", "an unknown character falls back to the first");
});

test("the art table carries every manifest size and anchor at density 2", () => {
  const manifest = JSON.parse(readFileSync(new URL("../mods/arcade-scene/art/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.density, 2);
  assert.deepEqual(manifest.background.size.map((n) => n * manifest.density), [DESIGN.width, DESIGN.height]);
  for (const [name, spec] of Object.entries(manifest.assets)) {
    assert.ok(ART[name], `${name} is missing from scene.js`);
    assert.deepEqual(ART[name].size, spec.size.map((n) => n * manifest.density), `${name} size`);
    assert.deepEqual(ART[name].anchor, spec.anchor.map((n) => n * manifest.density), `${name} anchor`);
    const file = new URL(`../mods/arcade-scene/art/${spec.file}`, import.meta.url);
    assert.ok(existsSync(file), `${spec.file} ships`);
  }
  assert.deepEqual(manifest.assets.glow.size, manifest.assets.shadow.size, "the glow fills the shadow's box");
  assert.deepEqual(manifest.assets.glow.anchor, manifest.assets.shadow.anchor);
});

test("the stage fits the focus box, filling the width or centring the design with FRAME_BG at its sides", () => {
  assert.deepEqual(DESIGN, { width: 1536, height: 1024 });
  assert.deepEqual(VIEW, { x0: 80, x1: 1536, topY: 330, topFraction: 0.12 });
  assert.deepEqual(FOCUS, { x0: 80, x1: 1536, top: 218, bottom: 872 });
  assert.equal(FOCUS.x1 - FOCUS.x0, 1456);
  assert.equal(FOCUS.bottom - FOCUS.top, 654);

  // A block flatter than the focus box is fit to the focus box's height: the design is centred
  // across it and the leftover block width on each side shows FRAME_BG, outside the design.
  const flat = coverScale(1000, 300);
  assert.equal(flat.scale, 300 / 654, "a flat block fits the focus box's height");
  assert.equal(flat.left, (1000 - DESIGN.width * flat.scale) / 2, "the design is centred across the block");
  assert.ok(flat.left > 0, "the leftover sides sit outside the design");
  assert.equal(flat.top, -FOCUS.top * flat.scale, "the focus box's top ends at the block's top");
  assert.equal(flat.width, DESIGN.width * flat.scale);
  assert.equal(flat.height, DESIGN.height * flat.scale);

  // A block taller than the focus box is fit to its width: the focus box fills the block across,
  // design x 80 lands on the left edge, and the vertical surplus sits above and below it.
  const narrow = coverScale(560, 336);
  assert.equal(narrow.scale, 560 / 1456, "a narrow block fits the focus box's width");
  assert.ok(Math.abs(narrow.left + FOCUS.x0 * narrow.scale) < 1e-9,
    "design x 80 lands on the block's left edge");
  assert.ok(Math.abs(narrow.top + FOCUS.top * narrow.scale - 0.12 * 336) < 1e-9,
    "the focus box's top sits 12% down while the surplus is larger than that");
  assert.ok(narrow.top + DESIGN.height * narrow.scale >= 336, "the background reaches the block's bottom");

  const taller = coverScale(560, 276);
  assert.equal(taller.scale, 560 / 1456, "a block with less surplus still keeps the focus box's width");
  assert.ok(Math.abs(taller.left + VIEW.x0 * taller.scale) < 1e-9);
  const surplus = (276 - 654 * taller.scale) / 2;
  assert.ok(Math.abs(taller.top + FOCUS.top * taller.scale - surplus) < 1e-9,
    "when the 12% top is more than the surplus allows, the focus box is centred in it");

  const huge = coverScale(3000, 276);
  assert.equal(huge.scale, 276 / 654, "a wide flat block still fits the focus box's height");
  assert.ok(huge.left > 0, "its design is narrow enough to leave FRAME_BG on both sides");
});

test("the marquee frame fills the block's width and starts at the cabinet tops", () => {
  assert.deepEqual(MARQUEE, { x0: 0, y: 332, topFraction: 0 });
  for (const ratio of [4, 5.5, 7]) {
    const H = 300;
    const W = H * ratio;
    const cover = coverScale(W, H, "marquee");
    assert.equal(cover.scale, W / (FOCUS.x1 - FOCUS.x0), `${ratio}:1 fits the design across`);
    assert.ok(Math.abs(cover.left + MARQUEE.x0 * cover.scale) < 1e-9, "the art's left edge lands on the block's left edge");
    assert.ok(cover.left <= 1e-9 && cover.left + cover.width >= W - 1e-9, `${ratio}:1 has no side band`);
    assert.ok(Math.abs(cover.top + MARQUEE.y * cover.scale - MARQUEE.topFraction * H) < 1e-9,
      "the cabinet tops sit on the block's top edge");
  }
  assert.deepEqual(coverScale(560, 336, "run"), coverScale(560, 336), "any other frame keeps the focus-box fit");
  assert.deepEqual(coverScale(560, 336), coverScale(560, 336, null));
});

test("the 340 px marquee reaches the screens' lower edge and the waiting characters' heads", () => {
  const cabinetTop = Math.min(...CABINETS.map((cabinet) => CAB_BASE_Y - ART[cabinet.art].anchor[1]));
  const screenBottom = Math.max(...CABINETS.map((cabinet) =>
    CAB_BASE_Y - ART[cabinet.art].anchor[1] + ART[cabinet.art].size[1] * SCREEN.y1));
  const alertTop = Math.max(...Object.keys(ART).filter((name) => name.endsWith("_alert"))
    .map((name) => FOOT_Y.needs - ART[name].size[1]));
  for (const [W, H] of [[1680, 340], [1646, 334]]) {
    const cover = coverScale(W, H, "marquee");
    const screen = (y) => cover.top + y * cover.scale;
    assert.ok(Math.abs(screen(cabinetTop)) < 1e-9, `${W}×${H}: the cabinet tops sit on the top edge`);
    assert.ok(screen(screenBottom) < H, `${W}×${H}: the screens' lower edge is in view`);
    assert.ok(screen(alertTop) <= H - 12, `${W}×${H}: at least 12 px of a waiting head is in view`);
  }
});

test("every character spot and the marquee stay inside the stage across block shapes", () => {
  const artsByPose = {};
  for (const name of Object.keys(ART)) {
    const pose = name.slice(name.lastIndexOf("_") + 1);
    (artsByPose[pose] ??= []).push(name);
  }
  const spots = [];
  for (const cabinet of CABINETS) {
    for (const [mood, y] of Object.entries(FOOT_Y)) {
      spots.push({ label: `${mood} at ${cabinet.x}`, x: cabinet.x, y, arts: artsByPose[POSE[mood]] });
    }
  }
  for (const [x, y] of SPECTATOR_SPOTS) spots.push({ label: `spectator ${x},${y}`, x, y, arts: artsByPose.back });
  for (const [x, y] of VIEWED_SPOTS) spots.push({ label: `viewed ${x},${y}`, x, y, arts: artsByPose.sleep });

  const marqueeTop = CAB_BASE_Y - Math.max(...CABINETS.map((cabinet) => ART[cabinet.art].anchor[1]));
  const EPS = 1e-6;
  for (const ratio of [1.6, 2.0, 2.5, 3.0, 3.4]) {
    const H = 300;
    const W = Math.round(H * ratio);
    const cover = coverScale(W, H);
    const s = cover.scale;
    const view = {
      left: -cover.left / s, right: (W - cover.left) / s,
      top: -cover.top / s, bottom: (H - cover.top) / s,
    };
    assert.ok(marqueeTop >= view.top - EPS, `${ratio}:1 keeps the marquee top in view`);
    for (const spot of spots) {
      for (const art of spot.arts) {
        const box = spriteBox(art, spot.x, spot.y, 1);
        assert.ok(box.left >= view.left - EPS && box.left + box.width <= view.right + EPS
          && box.top >= view.top - EPS && box.top + box.height <= view.bottom + EPS,
          `${ratio}:1 shows ${spot.label} (${art})`);
      }
    }
  }
});

test("the frame colour is the arcade's dark purple", () => {
  assert.equal(FRAME_BG, "#191035");
  assert.deepEqual(CHIP, { bg: "#251b47", ink: "#f1f0ff", border: "#ff41b4", line: "#31265a" });
  assert.deepEqual(CHIP_TONES, { attention: { dot: "#ff41b4" }, working: { dot: "#3adaf2" }, done: { dot: "#f9d544" } });
});

test("a bubble cuts at the last space inside the limit, else hard", () => {
  assert.equal(bubbleText("short"), "short");
  assert.equal(bubbleText("가".repeat(16)), "가".repeat(16), "an exact fit keeps its last character");
  assert.equal(bubbleText("가나다라마바사아자차카타파하거너더"), "가나다라마바사아자차카타파하거너…", "no space, a hard cut");
  assert.equal(bubbleText("fix the login bug now", 16), "fix the login…");
  assert.equal(bubbleText("한국어 문장을 자르지 않고 말줄임표로 끝내기", 16), "한국어 문장을 자르지 않고…",
    "a Korean word is never split when there is a space");
  assert.equal(bubbleText("  two   spaces  "), "two spaces");
  assert.equal(bubbleText(""), "");
  assert.equal(bubbleText(null), "");
});

test("every mood but a sleeper and a watcher may speak", () => {
  assert.deepEqual(BUBBLE_LIMIT, { needs: 16, stall: 12, working: 10, done: 10 });
});

test("bubbles that overlap another are flagged, apart ones are not", () => {
  const box = (left, top) => ({ left, top, width: 100, height: 20 });
  assert.deepEqual(overlapping([box(0, 100), box(50, 110), box(300, 100)]), [true, true, false]);
  assert.deepEqual(overlapping([box(0, 100), box(100, 100)]), [false, false], "touching edges do not overlap");
  assert.deepEqual(overlapping([]), []);
});

test("overlapping bubbles fade, except Needs you's and the hovered one, which draw last", () => {
  const box = (id, left, flagged = false) => ({ id, flagged, left, top: 0, width: 50, height: 20 });
  const specs = [box("a", 0), box("b", 30, true), box("c", 60), box("d", 200), box("e", 10)];
  const layers = bubbleLayers(specs, "c");
  assert.deepEqual(layers.map((l) => specs[l.index].id), ["a", "d", "e", "b", "c"], "plain, then urgent, then hovered");
  const opacity = Object.fromEntries(layers.map((l) => [specs[l.index].id, l.opacity]));
  assert.deepEqual(opacity, { a: 0.55, b: 1, c: 1, d: 1, e: 0.55 });
  assert.deepEqual(bubbleLayers([box("x", 0)], null), [{ index: 0, opacity: 1 }], "a lone bubble stays solid");
});

test("only Needs you bubbles show on their own; every other mood speaks while the pointer is on it", () => {
  assert.equal(bubbleVisible("needs", "a", null), true, "Needs you always speaks");
  assert.equal(bubbleVisible("working", "a", null), false);
  assert.equal(bubbleVisible("stall", "a", null), false);
  assert.equal(bubbleVisible("done", "a", null), false);
  assert.equal(bubbleVisible("working", "a", "a"), true, "the hovered character speaks");
  assert.equal(bubbleVisible("working", "a", "b"), false, "another character's hover does not");
});

test("Needs you bubbles that would overlap take turns above and below", () => {
  const spec = (id, left, top) => ({ id, left, top, width: 200, height: 46 });
  assert.deepEqual(staggerTops([spec("a", 0, 100), spec("b", 100, 100)]), [100, 46],
    "the second lifts one row clear instead of covering the first");
  assert.deepEqual(staggerTops([spec("a", 0, 100), spec("b", 400, 100)]), [100, 100],
    "bubbles that are already apart keep their top");
  assert.deepEqual(staggerTops([spec("a", 0, 100), spec("b", 50, 100), spec("c", 100, 100)], 8), [100, 46, 154],
    "a third bubble drops below when the row above is taken");
});

test("a bubble's width counts its text and padding, wider for Needs you's lead", () => {
  assert.equal(bubbleWidth("ab", 1), BUBBLE.pad * 2 + 2 * BUBBLE.font + 2);
  assert.equal(bubbleWidth("ab", 1, true), BUBBLE.pad * 2 + BUBBLE.lead + BUBBLE.gap + 2 * BUBBLE.font + 2);
  assert.equal(bubbleHeight(1), BUBBLE.font + BUBBLE.pad * 2 + 2);
  assert.equal(bubbleLeft(850, "ab", 1, 900, true), 900 - bubbleWidth("ab", 1, true) - 4,
    "the wider bubble is pulled further left");
  assert.equal(bubbleLeft(100, "ab", 0.5, 502), (100 + 44) * 0.5);
  assert.equal(bubbleLeft(0, "가".repeat(16), 0.5, 20), 0, "never left of the stage");
});

test("a walk goes down to the aisle, across, then on to the target, with short legs no shorter than 250 ms", () => {
  const from = { x: 430, y: 300 };
  const to = { x: 575, y: 700 };
  assert.deepEqual(waypoints(from, to), [
    { x: 430, y: 300 }, { x: 430, y: WALK_Y }, { x: 575, y: WALK_Y }, { x: 575, y: 700 },
  ]);
  assert.deepEqual(waypoints({ x: 430, y: WALK_Y }, { x: 575, y: WALK_Y }),
    [{ x: 430, y: WALK_Y }, { x: 575, y: WALK_Y }], "equal consecutive points collapse");
  assert.deepEqual(waypoints({ x: 430, y: WALK_Y }, { x: 430, y: WALK_Y }), [{ x: 430, y: WALK_Y }]);

  assert.equal(legMs({ x: 0, y: 0 }, { x: 60, y: 0 }), 250);
  assert.equal(legMs({ x: 0, y: 0 }, { x: 100, y: 0 }), 400);
  assert.equal(legMs({ x: 0, y: 0 }, { x: 400, y: 0 }), 900);
});

test("walkPosition interpolates a leg linearly and holds at its ends", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 50 };
  assert.deepEqual(walkPosition(from, to, 1000, 0), { x: 0, y: 0 });
  assert.deepEqual(walkPosition(from, to, 1000, 500), { x: 50, y: 25 });
  assert.deepEqual(walkPosition(from, to, 1000, 1000), { x: 100, y: 50 });
  assert.deepEqual(walkPosition(from, to, 1000, -20), { x: 0, y: 0 }, "before the leg holds the start");
  assert.deepEqual(walkPosition(from, to, 1000, 1500), { x: 100, y: 50 }, "past the leg holds the end");
});

test("a walk reaches its place on the clock alone, even when no timer ever fires", () => {
  const { view, cx, advance, queue } = scene();
  view.sync(cast([["a", "working"]]), cx);
  advance(SETTLE_MS);
  view.sync(cast([["a", "working"], ["b", "needs"]]), cx);
  const walk = view.walks.get("b");
  queue.splice(0);
  advance(walk.total);
  globalThis.herdrState = { shared: { "arcade-cards": { cast: cast([["a", "working"], ["b", "needs"]]) } } };
  try {
    view.render(cx);
  } finally {
    globalThis.herdrState = undefined;
  }
  assert.equal(view.walks.has("b"), false, "the finished walk is gone");
  assert.deepEqual(view.drawn.b, feet([CABINETS[1].x, FOOT_Y.needs]), "the render puts b at its place");
  assert.deepEqual(view.drawn.a, feet([CABINETS[0].x, FOOT_Y.working]), "a stays at its place");
});

test("a render between timers draws the leg the clock has reached", () => {
  const { view, cx, advance, queue } = scene();
  view.sync(cast([["a", "working"]]), cx);
  advance(SETTLE_MS);
  view.sync(cast([["a", "working"], ["b", "working"]]), cx);
  const walk = view.walks.get("b");
  queue.splice(0);
  advance(walk.legs[0].ms + Math.floor(walk.legs[1].ms / 2));
  globalThis.herdrState = { shared: { "arcade-cards": { cast: cast([["a", "working"], ["b", "working"]]) } } };
  try {
    view.render(cx);
  } finally {
    globalThis.herdrState = undefined;
  }
  assert.deepEqual(view.drawn.b, walk.legs[1].to, "the second leg's destination, not the first");
  assert.equal(view.walks.has("b"), true, "the walk is still running");
});

test("the drop's squash ends on the clock even when its timer never fires", () => {
  const { view, cx, settle, advance, queue } = scene();
  view.sync(cast([["a", "needs"]]), cx);
  settle();
  view.scale = 1;
  view.dragStart("a", { x: 0, y: 0 }, cx);
  view.dragMove({ x: 40, y: 10 }, cx);
  view.dragEnd(cx);
  assert.equal(view.squashing("a"), true, "the drop squashes");
  queue.splice(0);
  advance(220);
  assert.equal(view.squashing("a"), false, "the squash ends after LANDING_MS");
  assert.equal(view.landing, null);
});

test("the chips count the cards' groups, stalls with Needs you and viewed with Done", () => {
  assert.deepEqual(chipCounts(cast([["a", "needs"], ["b", "stall"], ["c", "working"], ["d", "viewed"], ["e", "done"]])),
    [["needs you", 2], ["working", 1], ["done", 2]]);
  assert.deepEqual(chipCounts([]), [["needs you", 0], ["working", 0], ["done", 0]]);
});

test("a mood maps to the chip group it is counted under", () => {
  assert.deepEqual(CHIP_GROUPS, ["attention", "working", "done"]);
  assert.equal(moodGroup("needs"), "attention");
  assert.equal(moodGroup("stall"), "attention");
  assert.equal(moodGroup("working"), "working");
  assert.equal(moodGroup("done"), "done");
  assert.equal(moodGroup("viewed"), "done");
  assert.equal(moodGroup("elsewhere"), "working");
});

test("a stored filter is cleaned to known groups, without duplicates, in chip order", () => {
  assert.deepEqual(readFilter(null), []);
  assert.deepEqual(readFilter("working"), []);
  assert.deepEqual(readFilter({ 0: "done" }), []);
  assert.deepEqual(readFilter(["done", "bogus", "attention", "done"]), ["attention", "done"]);
  assert.deepEqual(readFilter(["working", "attention"]), ["attention", "working"]);
  assert.deepEqual(readFilter([]), []);
});

test("toggling a group adds it or takes it out, in chip order", () => {
  assert.deepEqual(toggleFilter([], "working"), ["working"]);
  assert.deepEqual(toggleFilter(["working"], "working"), []);
  assert.deepEqual(toggleFilter(["done"], "attention"), ["attention", "done"]);
  assert.deepEqual(toggleFilter(["attention", "working"], "done"), ["attention", "working", "done"]);
  assert.deepEqual(toggleFilter(null, "done"), ["done"]);
  assert.deepEqual(toggleFilter(["attention", "working", "done"], "working"), ["attention", "done"]);
});

test("an empty filter shows every mood, a non-empty one only its groups", () => {
  assert.equal(shownByFilter([], "needs"), true);
  assert.equal(shownByFilter(null, "done"), true);
  assert.equal(shownByFilter(["working"], "working"), true);
  assert.equal(shownByFilter(["working"], "stall"), false);
  assert.equal(shownByFilter(["attention", "done"], "viewed"), true);
  assert.equal(shownByFilter(["attention"], "done"), false);
  assert.equal(shownByFilter(["bogus"], "needs"), true, "a filter of unknown ids cleans to empty");
});

test("each mood's body motion shakes, bounces or jumps, and a stall or sleeper holds still", () => {
  const base = { left: 136, top: 18, width: 117, height: 192 };
  assert.deepEqual(motionLayers("working", base, 1).map((l) => [l.prop, l.from, l.to, l.period]), [
    ["left", base.left - 2, base.left + 2, 260],
    ["top", base.top, base.top - 2, 520],
  ]);
  assert.deepEqual(motionLayers("needs", base, 2).map((l) => [l.prop, l.from, l.to, l.period]),
    [["top", base.top, base.top - 8, 450]], "the amplitudes scale with the stage");
  assert.deepEqual(motionLayers("done", base, 1).map((l) => [l.prop, l.from, l.to, l.period]),
    [["top", base.top, base.top - 10, 700]]);
  assert.deepEqual(motionLayers("stall", base, 1), []);
  assert.deepEqual(motionLayers("viewed", base, 1), []);
  assert.deepEqual(MOOD_MOTION.working[0], { prop: "left", from: -2, to: 2, period: 260 });

  const walk = walkLayers(base, 0.5);
  assert.deepEqual(walk.map((l) => [l.prop, l.from, l.to]), [
    ["top", base.top, base.top - 4], ["height", base.height, base.height * 0.94], ["width", base.width, base.width * 1.04],
  ]);
  const drag = dragLayers(base, 1);
  assert.deepEqual(drag.map((l) => [l.prop, l.from, l.to]), [
    ["left", base.left - 4, base.left + 4], ["height", base.height, base.height * 1.06],
  ]);
});

test("a press becomes a drag only once the pointer travels 4 px", () => {
  assert.equal(DRAG_SLOP, 4);
  assert.equal(isDrag({ x: 10, y: 10 }, { x: 13, y: 10 }), false, "under the slop it is a press");
  assert.equal(isDrag({ x: 10, y: 10 }, { x: 14, y: 10 }), true, "at the slop it is a drag");
  assert.equal(isDrag({ x: 10, y: 10 }, { x: 13, y: 13 }), true, "diagonal travel counts");
  assert.equal(isDrag(null, { x: 10, y: 10 }), false);
});

test("the carried foot point moves by the pointer's travel over the stage scale, inside the design", () => {
  assert.deepEqual(dragPoint({ x: 100, y: 100 }, { x: 10, y: 10 }, { x: 30, y: 20 }, 2), { x: 110, y: 105 },
    "a 20 x 10 pointer move at scale 2 is 10 x 5 design px");
  assert.deepEqual(dragPoint({ x: 100, y: 100 }, { x: 10, y: 10 }, { x: -10, y: 10 }, 2), { x: 90, y: 100 });
  assert.deepEqual(dragPoint({ x: 1520, y: 1010 }, { x: 0, y: 0 }, { x: 40, y: 40 }, 1), { x: 1536, y: 1024 },
    "the design is the limit");
  assert.deepEqual(dragPoint({ x: 10, y: 10 }, { x: 0, y: 0 }, { x: -40, y: -40 }, 1), { x: 0, y: 0 });
});

test("a dropped character lands inside the floor's drop area", () => {
  assert.deepEqual(DROP_AREA, { left: 40, right: 1490, top: 420, bottom: 860 });
  assert.equal(LIFT, 28);
  assert.deepEqual(dropPoint({ x: 500, y: 600 }), { x: 500, y: 600 });
  assert.deepEqual(dropPoint({ x: 0, y: 0 }), { x: 40, y: 420 });
  assert.deepEqual(dropPoint({ x: 2000, y: 2000 }), { x: 1490, y: 860 });
});

test("an empty cast renders without errors", () => {
  const { view, cx } = scene();
  assert.doesNotThrow(() => view.render(cx));
  assert.equal(view.walks.size, 0);
  assert.deepEqual(view.drawn, {});
});

test("the keyboard skips a session with no focus target", () => {
  const list = [{ id: "a", mood: "done", focus: { pane: "p1" } }, { id: "b", mood: "done" },
    { id: "c", mood: "done", focus: { terminal: "t1" } }];
  assert.deepEqual(charOrderOf(list), ["a", "c"]);
  assert.deepEqual(charOrderOf(null), []);
});

test("the character keys move the stage highlight and wrap, and ↩ or Space open the shown one", () => {
  const ids = ["a", "c"];
  assert.deepEqual(charKey("right", 0, ids), { at: 1, open: null });
  assert.deepEqual(charKey("right", 1, ids), { at: 0, open: null }, "→ wraps to the first character");
  assert.deepEqual(charKey("left", 0, ids), { at: 1, open: null }, "← wraps to the last character");
  assert.deepEqual(charKey("enter", 0, ids), { at: 0, open: "a" });
  assert.deepEqual(charKey("space", 1, ids), { at: 1, open: "c" });
  assert.equal(charKey("right", 0, []), null);
  assert.equal(charKey("up", 0, ids), null);
});

test("the chip keys move the filter highlight and wrap, and ↩ or Space toggle it", () => {
  assert.deepEqual(chipKey("left", 0, 3), { at: 2, toggle: false }, "← wraps to the last chip");
  assert.deepEqual(chipKey("right", 2, 3), { at: 0, toggle: false }, "→ wraps to the first chip");
  assert.deepEqual(chipKey("enter", 1, 3), { at: 1, toggle: true });
  assert.deepEqual(chipKey("space", 1, 3), { at: 1, toggle: true });
  assert.equal(chipKey("down", 1, 3), null);
  assert.equal(chipKey("left", 0, 0), null);
});

test("a mid-walk re-route walks on from the new path and the old leg's timer does nothing", () => {
  const { view, cx, queue, settle } = scene();
  view.sync(cast([["a", "working"]]), cx);
  settle();
  assert.deepEqual(view.drawn.a, feet([CABINETS[0].x, FOOT_Y.working]));

  view.sync(cast([["a", "needs"]]), cx);
  const oldWalk = view.walks.get("a");
  const oldTimer = queue.at(-1);
  view.sync(cast([["a", "viewed"]]), cx);
  const newWalk = view.walks.get("a");
  assert.notEqual(newWalk, oldWalk, "the re-route installs a new walk");
  const where = { ...view.drawn.a };

  oldTimer.fn(cx);
  assert.equal(view.walks.get("a"), newWalk, "the old leg's timer does not bring the old walk back");
  assert.deepEqual(view.drawn.a, where, "and the character does not jump back to the old path");

  settle();
  assert.deepEqual(view.drawn.a, feet(BENCH_SPOTS[0]), "the re-routed walk ends on the bench");
  assert.equal(view.walks.has("a"), false, "the finished walk is gone");
});

test("a session dropped from the cast leaves no walk state and its timers do nothing", () => {
  const { view, cx, queue } = scene();
  view.sync(cast([["a", "working"], ["b", "needs"]]), cx);
  const timers = queue.splice(0);

  view.sync(cast([["b", "needs"]]), cx);
  assert.equal("a" in view.drawn, false);
  assert.equal(view.walks.has("a"), false);
  assert.equal(view.spots.a, undefined);

  for (const timer of timers) timer.fn(cx);
  assert.equal("a" in view.drawn, false, "the dropped session's timers draw nothing");
  assert.equal(view.walks.has("a"), false);
  assert.ok(view.drawn.b, "the session still in the cast keeps its position");
});

test("a mixed cast renders, bubbles and all", () => {
  const { view, cx, queue } = scene();
  const people = [["n", "needs"], ["n2", "needs"], ["w", "working"], ["s", "stall"], ["d", "done"], ["v", "viewed"]]
    .map(([id, mood]) => ({ id, mood, who: "kid", topic: `${id} topic that runs long enough to cut` }));
  globalThis.herdrState = { shared: { "arcade-cards": { cast: people } } };
  try {
    assert.doesNotThrow(() => view.render(cx));
    for (const task of queue.splice(0)) if (!task.cancelled) task.fn(cx);
    assert.doesNotThrow(() => view.render(cx));
    assert.deepEqual(Object.keys(view.drawn).sort(), ["d", "n", "n2", "s", "v", "w"]);
    assert.equal(view.spots.v.kind, "viewed");
    assert.equal(view.spots.n.cab, 0);
  } finally {
    globalThis.herdrState = undefined;
  }
});

test("the marquee frame draws no speech bubbles while the full scene still does", () => {
  const { view, cx } = scene();
  const people = [{ id: "n", mood: "needs", who: "kid", topic: "a needs topic long enough" }];
  globalThis.herdrState = { shared: { "arcade-cards": { cast: people } } };
  try {
    const drawn = [];
    const bubbleView = view.bubbleView.bind(view);
    view.bubbleView = (spec, opacity, s) => { drawn.push(spec.entry.id); return bubbleView(spec, opacity, s); };
    view.frame = "marquee";
    view.render(cx);
    assert.deepEqual(drawn, [], "the cropped marquee leaves its characters' words to the panel");
    view.frame = "run";
    view.render(cx);
    assert.deepEqual(drawn, ["n"], "a Needs you character speaks in the other frames");
  } finally {
    globalThis.herdrState = undefined;
  }
});

test("seventeen sessions still render with every machine and every bench taken", () => {
  const { view, cx, queue } = scene();
  const moods = ["needs", "working", "stall", "done", "viewed"];
  const people = Array.from({ length: 17 }, (_, i) => ({ id: `p${i}`, mood: moods[i % moods.length], who: "cat", topic: `topic ${i}` }));
  globalThis.herdrState = { shared: { "arcade-cards": { cast: people } } };
  try {
    assert.doesNotThrow(() => view.render(cx));
    for (const task of queue.splice(0)) if (!task.cancelled) task.fn(cx);
    assert.doesNotThrow(() => view.render(cx));
    const kinds = Object.values(view.spots).map((spot) => spot.kind);
    assert.equal(kinds.filter((kind) => kind === "cab").length, 6);
    assert.ok(kinds.includes("viewed"));
    assert.ok(kinds.includes("spectator"));
  } finally {
    globalThis.herdrState = undefined;
  }
});

test("the chip filter hands a hidden character a dimmed flag and a shown one a solid flag", () => {
  const { view, cx } = scene();
  const people = [
    { id: "w", mood: "working", who: "kid", topic: "a working topic" },
    { id: "n", mood: "needs", who: "cat", topic: "a needs topic" },
  ];
  globalThis.herdrState = { shared: { "arcade-cards": { cast: people }, "arcade-filter": ["working"] } };
  try {
    // The ui stub keeps no element tree, so this records the flag render() hands character().
    const shown = {};
    const character = view.character.bind(view);
    view.character = (entry, spot, position, walking, s, flag) => {
      shown[entry.id] = flag;
      return character(entry, spot, position, walking, s, flag);
    };
    assert.doesNotThrow(() => view.render(cx));
    assert.deepEqual(shown, { w: true, n: false }, "only the Working character is drawn solid");
  } finally {
    globalThis.herdrState = undefined;
  }
});

test("the hover mark starts empty and goes with a character that leaves the cast", () => {
  const { view, cx } = scene();
  assert.equal(view.hovered, null);
  view.sync(cast([["a", "needs"], ["b", "working"]]), cx);
  view.hovered = "b";
  view.sync(cast([["a", "needs"], ["b", "working"]]), cx);
  assert.equal(view.hovered, "b", "a character that stays keeps the hover");
  view.sync(cast([["a", "needs"]]), cx);
  assert.equal(view.hovered, null);
});

test("the block's size, divided by the zoom, is the stage, and no block resizing happens", () => {
  globalThis.herdrRuns = [];
  try {
    const { view, cx } = scene();
    const before = cx.notifies;
    view.sizeChanged({ width: 560, height: 276 }, cx);
    assert.deepEqual(globalThis.herdrRuns, [], "the mod no longer resizes its block");
    assert.deepEqual(view.stage, { W: 560, H: 276 });
    assert.equal(cx.notifies, before + 1, "a new stage redraws the scene");

    view.sizeChanged({ width: 560, height: 276 }, cx);
    assert.equal(cx.notifies, before + 1, "an unchanged stage does not redraw");

    // On-screen px carry the zoom: 700 × 345 at zoom 1.25 is the 560 × 276 stage.
    globalThis.herdrState = { settings: { zoom: 1.25 } };
    view.sizeChanged({ width: 700, height: 345 }, cx);
    assert.deepEqual(view.stage, { W: 560, H: 276 });
    assert.equal(cx.notifies, before + 1, "the same stage at another zoom does not redraw");
    view.sizeChanged({ width: 1290, height: 430 }, cx);
    assert.deepEqual(view.stage, { W: 1032, H: 344 });
    assert.equal(cx.notifies, before + 2, "a new stage at zoom redraws");
    globalThis.herdrState = undefined;

    view.sizeChanged({ width: 0, height: 0 }, cx);
    assert.deepEqual(view.stage, { W: 1032, H: 344 }, "a size before layout measures nothing");
    assert.equal(cx.notifies, before + 2);
  } finally {
    globalThis.herdrRuns = undefined;
    globalThis.herdrState = undefined;
  }
});

test("a press and release without the slop is a click that moves nothing", () => {
  const { view, cx, settle } = scene();
  view.sync(cast([["a", "needs"]]), cx);
  settle();
  view.scale = 0.5;
  const start = { ...view.drawn.a };
  view.dragStart("a", { x: 100, y: 100 }, cx);
  view.dragMove({ x: 103, y: 102 }, cx);
  assert.deepEqual(view.drawn.a, start, "a move under the slop carries nothing");
  view.dragEnd(cx);
  assert.equal(view.pinned.size, 0);
  assert.deepEqual(view.drawn.a, start);
  assert.equal(view.justDragged, false);
});

test("a drag past the slop follows the pointer and drops at the clamped floor point", () => {
  const { view, cx, settle } = scene();
  view.sync(cast([["a", "needs"]]), cx);
  settle();
  const spot = feet([CABINETS[0].x, FOOT_Y.needs]);
  view.scale = 0.5;
  view.dragStart("a", { x: 100, y: 100 }, cx);
  view.dragMove({ x: 120, y: 116 }, cx);
  assert.deepEqual(view.drawn.a, { x: spot.x + 40, y: spot.y + 32 },
    "the foot point carries the pointer delta over the scale");

  view.dragEnd(cx);
  assert.deepEqual(view.drawn.a, { x: spot.x + 40, y: spot.y + 32 }, "the drop stays on the floor");
  assert.deepEqual(view.pinned.get("a"), { x: spot.x + 40, y: spot.y + 32 });
  assert.equal(view.justDragged, true);
  assert.ok(view.landing, "the landing squash starts");
  assert.equal(view.drag, null);
  settle();
  assert.equal(view.landing, null, "the squash ends after its timer");
});

test("a dropped character stays where it landed while its mood is unchanged", () => {
  const { view, cx, settle } = scene();
  view.sync(cast([["a", "needs"]]), cx);
  settle();
  view.scale = 1;
  view.dragStart("a", { x: 100, y: 100 }, cx);
  view.dragMove({ x: 140, y: 110 }, cx);
  view.dragEnd(cx);
  const dropped = { ...view.drawn.a };
  view.sync(cast([["a", "needs"]]), cx);
  assert.deepEqual(view.drawn.a, dropped);
  assert.equal(view.walks.has("a"), false, "no walk back to the assigned place");
});

test("a mood change unpins the character and walks it to its new place", () => {
  const { view, cx, settle } = scene();
  view.sync(cast([["a", "needs"]]), cx);
  settle();
  view.scale = 1;
  view.dragStart("a", { x: 100, y: 100 }, cx);
  view.dragMove({ x: 140, y: 110 }, cx);
  view.dragEnd(cx);
  view.sync(cast([["a", "working"]]), cx);
  assert.equal(view.pinned.has("a"), false);
  const walk = view.walks.get("a");
  assert.ok(walk, "the character walks to its new place");
  assert.deepEqual(walk.path.at(-1), feet([CABINETS[0].x, FOOT_Y.working]));
});

test("a dropped character stays for RETURN_MS and then walks back to its own place on the clock", () => {
  const { view, cx, advance, queue } = scene();
  const show = (pairs) => {
    globalThis.herdrState = { shared: { "arcade-cards": { cast: cast(pairs) } } };
    try {
      view.render(cx);
    } finally {
      globalThis.herdrState = undefined;
    }
  };
  view.sync(cast([["a", "needs"]]), cx);
  view.scale = 1;
  view.dragStart("a", { x: 0, y: 0 }, cx);
  view.dragMove({ x: 100, y: 40 }, cx);
  view.dragEnd(cx);
  const dropped = { ...view.drawn.a };
  const droppedAt = view.now();
  queue.splice(0);

  advance(RETURN_MS - 1);
  show([["a", "needs"]]);
  assert.deepEqual(view.drawn.a, dropped, "it holds the dropped place for RETURN_MS");
  assert.equal(view.walks.has("a"), false, "and starts no walk yet");

  advance(1);
  show([["a", "needs"]]);
  const walk = view.walks.get("a");
  assert.ok(walk, "past RETURN_MS the return walk starts");
  assert.equal(walk.started, droppedAt + RETURN_MS, "it starts on the clock, not the render");
  assert.deepEqual(walk.path.at(-1), feet([CABINETS[0].x, FOOT_Y.needs]), "it heads for the assigned place");
  assert.equal(view.pinned.has("a"), false, "the drop no longer pins it");

  advance(walk.total);
  show([["a", "needs"]]);
  assert.deepEqual(view.drawn.a, feet([CABINETS[0].x, FOOT_Y.needs]), "the walk ends on its own place");
  assert.equal(view.walks.has("a"), false, "the finished walk is gone");
});

test("a sync during a drag starts no walk for the carried character", () => {
  const { view, cx, settle } = scene();
  view.sync(cast([["a", "needs"]]), cx);
  settle();
  view.sync(cast([["a", "working"]]), cx);
  assert.ok(view.walks.has("a"), "a is walking to its new place");
  view.scale = 1;
  view.dragStart("a", { x: 0, y: 0 }, cx);
  view.dragMove({ x: 40, y: 10 }, cx);
  assert.equal(view.walks.has("a"), false, "picking it up cancels the walk");
  view.sync(cast([["a", "working"]]), cx);
  assert.equal(view.walks.has("a"), false, "and the sync starts no other walk");
});

test("a click on a character whose drag is still open ends the drag and does not focus", () => {
  globalThis.herdrRuns = [];
  try {
    const { view, cx, settle } = scene();
    const entry = { id: "a", mood: "needs", focus: { pane: "p1" } };
    view.sync([entry], cx);
    settle();
    const spot = feet([CABINETS[0].x, FOOT_Y.needs]);
    view.scale = 1;
    view.dragStart("a", { x: 100, y: 100 }, cx);
    view.dragMove({ x: 140, y: 110 }, cx);
    assert.ok(view.drag, "the drag is still open when the click runs");

    view.clickCharacter(entry, cx);
    assert.equal(view.drag, null, "the click ends the drag itself");
    assert.deepEqual(view.pinned.get("a"), { x: spot.x + 40, y: spot.y + 10 }, "the character pins at the drop");
    assert.equal(view.justDragged, false, "the drag's own click is consumed");
    assert.deepEqual(globalThis.herdrRuns, [], "the pane is not focused");
  } finally {
    globalThis.herdrRuns = undefined;
  }
});

test("a click on a character pressed without the slop ends the press and focuses the pane", () => {
  globalThis.herdrRuns = [];
  try {
    const { view, cx, settle } = scene();
    const entry = { id: "a", mood: "needs", focus: { pane: "p1" } };
    view.sync([entry], cx);
    settle();
    view.scale = 1;
    view.dragStart("a", { x: 100, y: 100 }, cx);
    view.dragMove({ x: 101, y: 101 }, cx);
    assert.ok(view.drag, "a press under the slop still holds the drag");

    view.clickCharacter(entry, cx);
    assert.equal(view.drag, null);
    assert.equal(view.pinned.size, 0, "nothing was carried, so nothing pins");
    assert.deepEqual(globalThis.herdrRuns, [["pane.focus", { pane: "p1" }]]);
  } finally {
    globalThis.herdrRuns = undefined;
  }
});

test("a hover-out with only a press ends the drag without pinning", () => {
  const { view, cx, settle } = scene();
  view.sync(cast([["a", "needs"]]), cx);
  settle();
  view.dragStart("a", { x: 100, y: 100 }, cx);
  view.dragMove({ x: 101, y: 101 }, cx);
  view.dragEnd(cx);
  assert.equal(view.drag, null);
  assert.equal(view.pinned.size, 0);
  assert.deepEqual(view.drawn.a, feet([CABINETS[0].x, FOOT_Y.needs]), "the character stays on its place");
});

test("removing a session clears its pin and the drag carrying it", () => {
  const { view, cx, settle } = scene();
  view.sync(cast([["a", "needs"], ["b", "needs"]]), cx);
  settle();
  view.scale = 1;
  view.dragStart("a", { x: 0, y: 0 }, cx);
  view.dragMove({ x: 40, y: 10 }, cx);
  view.dragEnd(cx);
  assert.ok(view.pinned.has("a"), "a is pinned after its drop");

  view.dragStart("b", { x: 0, y: 0 }, cx);
  view.dragMove({ x: 40, y: 10 }, cx);
  assert.equal(view.drag.id, "b", "b is being carried");

  view.sync(cast([["b", "needs"]]), cx);
  assert.equal(view.pinned.has("a"), false, "the removed session's pin is gone");
  assert.equal("a" in view.drawn, false);
  assert.equal(view.drag.id, "b", "a drag of a session still in the cast survives");

  view.sync(cast([]), cx);
  assert.equal(view.drag, null, "the removed session's drag is gone");
});

test("a mood change while carried walks the drop to the new mood's place", () => {
  const { view, cx, settle } = scene();
  view.sync(cast([["a", "needs"]]), cx);
  settle();
  const spot = feet([CABINETS[0].x, FOOT_Y.needs]);
  view.scale = 1;
  view.dragStart("a", { x: 100, y: 100 }, cx);
  view.dragMove({ x: 140, y: 110 }, cx);
  view.sync(cast([["a", "working"]]), cx);

  view.dragEnd(cx);
  assert.equal(view.pinned.has("a"), false, "the new mood keeps the drop from pinning");
  const walk = view.walks.get("a");
  assert.ok(walk, "the drop starts a walk");
  assert.deepEqual(walk.path.at(-1), feet([CABINETS[0].x, FOOT_Y.working]), "it ends at the working place");
  assert.deepEqual(walk.path[0], { x: spot.x + 40, y: spot.y + 10 }, "it starts at the drop point");
});

test("a drag started mid-walk picks the character up where it is drawn", () => {
  const { view, cx, settle, advance } = scene();
  view.sync(cast([["a", "needs"]]), cx);
  settle();
  view.sync(cast([["a", "viewed"]]), cx);
  const walk = view.walks.get("a");
  const from = feet([CABINETS[0].x, FOOT_Y.needs]);
  assert.deepEqual(walk.legs[0].from, from);
  assert.deepEqual(walk.legs[0].to, { x: from.x, y: WALK_Y });
  assert.deepEqual(view.drawn.a, { x: from.x, y: WALK_Y }, "drawn holds the leg's destination");

  advance(walk.legs[0].ms / 2);
  view.scale = 1;
  view.dragStart("a", { x: 0, y: 0 }, cx);
  assert.deepEqual(view.drag.start, { x: from.x, y: (from.y + WALK_Y) / 2 }, "half-way down the leg, not at its end");
});

test("the reading position is on the bench at the right of the room", () => {
  for (const [x, y] of BENCH_SPOTS) assert.ok(x >= 1200 && x <= 1515 && y <= 355, `bench spot ${x},${y}`);
  for (const [x, y] of FLOOR_SPOTS) assert.ok(y > 355, "the floor overflow is on the floor");
  assert.deepEqual(SPECTATOR_SPOTS[0], [1250, 810]);
});

test("a stale cast at launch followed by the live one seats everyone at the live spots without walking", () => {
  const { view, cx, advance } = scene();
  view.sync(cast([["a", "working"], ["b", "working"]]), cx);
  advance(2000);
  view.sync(cast([["a", "needs"], ["b", "done"]]), cx);
  assert.equal(view.walks.size, 0, "no one walks while the scene is settling");
  assert.deepEqual(view.drawn.a, { x: view.spots.a.x, y: view.spots.a.y });
  assert.deepEqual(view.drawn.b, { x: view.spots.b.x, y: view.spots.b.y });
});
