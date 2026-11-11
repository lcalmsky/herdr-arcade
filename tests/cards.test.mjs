// Model tests for the arcade-cards mod: grouping, sort order, Herdr-only agents and the
// strip geometry. Run: node --import ./tests/stubs/register.mjs --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ArcadeCards, {
  wheelStepFor, leftIndexAt, rightIndexAt, maxOffset, clampOffset, centeredOffset, WHEEL_STEP, STRIP_BLOCK_H, STRIP_H, TEXT_W,
  geometry, cardsScale, BASE_BLOCK_H, BLOCK_H_MIN, BLOCK_H_MAX,
  charFor, personaLine, toneKey, foldHandoffs, terminalOf, placeOf, topicOf, cleanMessage, wrapLines, textWidth,
  screenHeight, screenLines,
  castOf, selectedTone, laneParts, toolsParts, filterGroups, infoItemOf, emptyText,
  zoomOf, nextSettings, TERM_FONT, visitHistory, stepHistory, HISTORY_MAX, NO_PAGE_FLASH,
  footerOf, NOTICE_KEY, NOTICE_ACT_KEY, cardTooltip,
} from "../mods/arcade-cards/main.js";
import { railKey } from "../mods/arcade-rail/main.js";
import { tabsKey } from "../mods/arcade-tabs/main.js";
import { shared, setShared } from "../tests/stubs/herdr.mjs";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

function view(sessions, state = {}) {
  globalThis.herdrState = state;
  const v = new ArcadeCards();
  Object.assign(v, {
    sessions, meta: { roots: 1, pages: [] }, seen: [], viewed: [], snoozed: {}, since: {}, query: "",
    expanded: new Set(), stepTop: {}, showAllDone: false, sel: null,
    history: { list: [], at: -1 }, navTarget: null,
    scroll: { scroll_to_item() {} },
  });
  return v;
}

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

const session = (id, status, minutesAgo, extra = {}) => ({
  t: "s", sessionId: id, pid: 100 + id.length, status, name: id,
  statusUpdatedAt: NOW - minutesAgo * MIN, lastMeaningfulAt: NOW - 30_000,
  background: { shells: 0, agents: 0, monitors: 0, total: 0 }, where: { kind: "herdr-app" }, ...extra,
});

test("groups Pulse sessions and sorts Needs you and Working oldest first, Done newest first", () => {
  const v = view([
    session("w-new", "busy", 2), session("w-old", "busy", 9),
    session("a-new", "waiting", 1), session("a-old", "waiting", 7),
    session("d-old", "idle", 50), session("d-new", "idle", 5),
  ]);
  const model = v.buildModel(NOW);
  assert.deepEqual(model.attention.map((i) => i.sessionId), ["a-old", "a-new"]);
  assert.deepEqual(model.working.map((i) => i.sessionId), ["w-old", "w-new"]);
  assert.deepEqual(model.done.map((i) => i.sessionId), ["d-new", "d-old"]);
});

test("a busy session quiet for 10 minutes without background work is a stall until snoozed", () => {
  const v = view([session("s", "busy", 20, { lastMeaningfulAt: NOW - 11 * MIN })]);
  const [stall] = v.buildModel(NOW).attention;
  assert.equal(stall.bucket, "stall");
  assert.equal(v.tone(stall).label, "Stalled");
  v.snoozed.s = NOW + MIN;
  assert.equal(v.buildModel(NOW).working[0].sessionId, "s");
});

test("a seen Done card stays hidden, and a seen Herdr-only agent card stays hidden across a reload", () => {
  const v = view([session("d", "idle", 3)]);
  const [item] = v.buildModel(NOW).done;
  v.seen = [item.ackKey];
  assert.equal(v.buildModel(NOW).done.length, 0);

  const state = { agents: [{ address: "t8", pane: "p8", status: "idle", app: "codex", seq: 41, title: "job", program: { name: "codex" } }] };
  const first = view([], state);
  const [card] = first.buildModel(NOW).done;
  const reloaded = view([], state);
  reloaded.seen = [card.ackKey];
  assert.equal(reloaded.buildModel(NOW).done.length, 0);
});

test("Herdr agents Pulse doesn't list join the groups; Claude Code and matched terminals don't", () => {
  const agent = (address, status, app = "codex") => ({ address, pane: `p-${address}`, status, app, title: `${address} job`, space_name: "acme", program: { name: app } });
  const v = view([session("claude", "busy", 4, { pid: 42 })], {
    terminals: [{ address: "t1", state: "live", foreground: { pid: 42 } }],
    agents: [agent("t1", "working", "claude-code"), agent("t2", "blocked"), agent("t3", "working"), agent("t4", "idle"), agent("t5", "blocked", "claude-code")],
  });
  const model = v.buildModel(NOW);
  assert.deepEqual(model.attention.map((i) => i.sessionId), ["agent:t2"]);
  assert.deepEqual(model.working.map((i) => i.sessionId).sort(), ["agent:t3", "claude"]);
  assert.deepEqual(model.done.map((i) => i.sessionId), ["agent:t4"]);
  assert.equal(model.working.find((i) => i.sessionId === "claude").charKey, "t1");
});

test("a native agent names its program in the footer, and its Herdr-blocked agent puts it in Needs you", () => {
  const agent = (address, status, seq = 1) => ({ address, pane: `p-${address}`, status, app: "codex", seq, title: `${address} job`, program: { name: "codex" } });
  const codex = session("cx", "busy", 2, { agent: "codex", cwd: "/repo/thing", pid: 77 });
  const v = view([codex], {
    terminals: [{ address: "t7", state: "live", foreground: { pid: 77 } }],
    agents: [agent("t7", "blocked")],
  });
  const model = v.buildModel(NOW);
  assert.deepEqual(model.attention.map((item) => item.sessionId), ["cx"]);
  assert.equal(model.attention[0].bucket, "wait");
  assert.equal(footerOf(model.attention[0]), "Codex · thing");
  assert.equal(footerOf({ raw: { agent: "gemini" }, spot: { label: "alpha" } }), "Gemini · alpha");
  assert.equal(footerOf({ raw: { agent: "claude" }, spot: { label: "alpha" } }), "alpha");
  assert.equal(footerOf({ raw: {}, place: "beta" }), "beta");

  const claude = view([session("cl", "busy", 2, { agent: "claude", pid: 78 })], {
    terminals: [{ address: "t8", state: "live", foreground: { pid: 78 } }],
    agents: [agent("t8", "blocked")],
  });
  assert.deepEqual(claude.buildModel(NOW).working.map((item) => item.sessionId), ["cl"], "Claude sessions keep their own bucket");
});

test("the strip pads the ends by 20, groups by 24, cards by 12, a group label lane by 22, and an open step list doubles a card", () => {
  const steps = [{ state: "done", label: "a" }, { state: "now", label: "b" }];
  const v = view([
    session("a", "waiting", 3),
    session("w1", "busy", 5), session("w2", "busy", 4, { deadhd: { counts: { done: 1, now: 1, blocked: 0 }, total: 2, items: steps } }),
  ]);
  v.expanded.add("w2");
  const strip = v.buildStrip(v.viewData(NOW));
  assert.deepEqual(strip.map((e) => [e.key, e.lead, e.w]), [
    ["card-a", 132, 372], ["card-w1", 136, 376], ["card-w2", 12, 12 + 240 + 240 + 20],
  ]);
  assert.deepEqual(strip.map((e) => e.head), [true, true, false]);
  assert.deepEqual(strip.map((e) => e.player), [1, 2, 3], "cards carry their player number across groups");
  assert.equal(strip[0].lead, geometry(1).PAD_X + geometry(1).LANE_W, "the first card of a group leads with the 112 px stage plate");
  assert.equal(strip[1].lead, geometry(1).GROUP_GAP + geometry(1).LANE_W, "so does the first card of every later group");

  const dv = view([session("d1", "idle", 5), session("d2", "idle", 6)]);
  assert.deepEqual(dv.buildStrip(dv.viewData(NOW)).map((e) => [e.key, e.lead]), [["card-d1", 132], ["card-d2", 12]]);
  const only = view([session("w", "busy", 5)]);
  assert.deepEqual(only.buildStrip(only.viewData(NOW)).map((e) => [e.key, e.lead, e.head]), [["card-w", 132, true]],
    "with no Needs you card, Working starts the strip at the 20 px pad and its stage plate");
});

test("filterGroups keeps every group with no filter or a non-array, and only the named ids otherwise", () => {
  const groups = [{ id: "attention" }, { id: "working" }, { id: "done" }];
  assert.equal(filterGroups(groups, []), groups);
  assert.equal(filterGroups(groups, null), groups);
  assert.equal(filterGroups(groups, "working"), groups);
  assert.deepEqual(filterGroups(groups, ["working"]).map((g) => g.id), ["working"]);
  assert.deepEqual(filterGroups(groups, ["done", "attention"]).map((g) => g.id), ["attention", "done"]);
});

test("the chip filter narrows the strip's groups while the published cast keeps them all", () => {
  const v = view([
    session("a", "waiting", 3), session("w", "busy", 2), session("d", "idle", 10),
  ], { shared: { "arcade-filter": ["working"] } });
  const data = v.viewData(NOW);
  assert.deepEqual(data.groups.map((group) => group.id), ["working"]);
  assert.deepEqual(data.allGroups.map((group) => group.id), ["attention", "working", "done"]);
  assert.equal(data.hiddenDone, 0, "a filtered-out Done group hides its more tile");
});

test("the strip registers no handlers, and a row click goes through the list by key", () => {
  const clock = Date.now();
  const at = (id, status, minutesAgo, extra = {}) => session(id, status, 0, {
    statusUpdatedAt: clock - minutesAgo * MIN,
    lastMeaningfulAt: clock - 30_000,
    ...extra,
  });
  const steps = [{ state: "done", label: "a" }, { state: "now", label: "b" }, { state: "left", label: "c" }];
  const v = view([
    at("a", "waiting", 3, { pages: [{ label: "Progress", url: "https://example.test/page", openable: true }] }),
    at("w1", "busy", 5, { deadhd: { counts: { done: 1, now: 1, blocked: 0 }, total: 3, items: steps, pagePath: "/tmp/progress.html" } }),
    ...Array.from({ length: 6 }, (_, i) => at(`d${i}`, "idle", 10 + i)),
  ]);
  v.sel = "w1";
  v.expanded.add("w1");
  Object.assign(v, { handle: { focus() {}, is_focused: () => false }, scroll: {} });
  const builders = ["laneColumn", "card", "cardHead", "progressRow", "pageTag", "stepsColumn", "stepRow", "moreTile"];
  const hits = {};
  for (const name of builders) {
    const build = v[name].bind(v);
    v[name] = (...args) => { hits[name] = (hits[name] ?? 0) + 1; return build(...args); };
  }
  assert.doesNotThrow(() => v.stripView(v.viewData(clock)));
  for (const name of builders) assert.ok((hits[name] ?? 0) > 0, `${name} ran in the strip`);
  const keys = v.buildStrip(v.viewData(clock)).map((e) => e.key);
  assert.ok(keys.includes("card-w1"));
  assert.ok(keys.includes("card-d0"));
  assert.ok(keys.includes("more-done"), "Done and its tile close the one row");
  let gone = null;
  v.goTo = (item) => { gone = item.sessionId; };
  v.clickStrip("card-w1", { notify() {} });
  assert.equal(v.sel, "w1");
  assert.equal(gone, "w1");
  v.clickStrip("more-done", { notify() {} });
  assert.equal(v.showAllDone, true);
});

const press = (v, key, alt = false, shift = false, control = false, keyChar = null) => {
  const calls = { stop: 0, notify: 0 };
  v.key({ key, modifiers: { alt, shift, platform: false, control }, key_char: keyChar, is_held: false }, {
    stop_propagation() { calls.stop += 1; },
    notify() { calls.notify += 1; },
    spawn() {},
  });
  return calls;
};

test("Esc steps back one layer at a time: search, chip filter, selection, then the pane below", () => {
  const v = view([session("a", "waiting", 3), session("d", "idle", 5)], { shared: { "arcade-filter": ["done"] } });
  Object.assign(v, { scroll: { scroll_to_item() {} }, sel: "d", query: "d" });
  globalThis.herdrRuns = [];
  globalThis.herdrShared = [];
  try {
    press(v, "escape");
    assert.equal(v.query, "", "the first Esc clears the search");
    assert.deepEqual(shared("arcade-filter"), ["done"], "and leaves the filter alone");

    press(v, "escape");
    assert.deepEqual(shared("arcade-filter"), [], "the second Esc clears the filter");
    assert.equal(v.query, "");
    assert.equal(v.sel, "d", "and keeps the selection");

    press(v, "escape");
    assert.equal(v.selectedItem(v.viewData()), null, "the third Esc clears the selection");
    assert.deepEqual(globalThis.herdrRuns, [], "the pane below waits for the fourth");

    press(v, "escape");
    assert.deepEqual(globalThis.herdrRuns, [["pane.go", { direction: "down" }]], "the fourth hands the keyboard down");
  } finally {
    globalThis.herdrRuns = undefined;
    globalThis.herdrShared = undefined;
  }
});

test("an empty strip names the filter that hid the sessions", () => {
  const v = view([session("w", "busy", 3)], { shared: { "arcade-filter": ["done"] } });
  Object.assign(v, { scroll: { scroll_to_item() {} } });
  assert.deepEqual(v.buildStrip(v.viewData(NOW)), [], "the Working card is filtered out");
  assert.doesNotThrow(() => v.stripView(v.viewData(NOW)));
  assert.equal(emptyText("", true), "Nothing in this filter");
  assert.equal(emptyText("fix", true), "No matching sessions");
  assert.equal(emptyText("", false), "All quiet for now");
});

test("the hidden Done count follows the filter, so a filtered-out Done group shows no more tile", () => {
  const sessions = Array.from({ length: 7 }, (_, i) => session(`d${i}`, "idle", 10 + i));
  const done = view(sessions, { shared: { "arcade-filter": ["done"] } });
  assert.equal(done.viewData(NOW).hiddenDone, 2);
  const both = view(sessions, { shared: { "arcade-filter": ["working", "done"] } });
  assert.equal(both.viewData(NOW).hiddenDone, 2);
  const working = view(sessions, { shared: { "arcade-filter": ["working"] } });
  assert.equal(working.viewData(NOW).hiddenDone, 0);
});

test("publish sends no selected cast entry for a card the chip filter hides", () => {
  const sessions = [session("a", "waiting", 3), session("w", "busy", 2)];
  const published = () => globalThis.herdrShared.find(([name]) => name === "arcade-cards")?.[1];

  const filtered = view(sessions, { shared: { "arcade-filter": ["working"] } });
  filtered.sel = "a";
  globalThis.herdrShared = [];
  try {
    filtered.publish(filtered.viewData(NOW), false);
    const value = published();
    assert.ok(value.cast.some((entry) => entry.id === "a"), "the hidden card is still in the cast");
    assert.equal(value.cast.some((entry) => entry.selected), false, "but none of them is the selection");
  } finally {
    globalThis.herdrShared = undefined;
  }

  const unfiltered = view(sessions);
  unfiltered.sel = "a";
  globalThis.herdrShared = [];
  try {
    unfiltered.publish(unfiltered.viewData(NOW), false);
    assert.equal(published().cast.find((entry) => entry.id === "a").selected, true, "with no filter the card is selected");
  } finally {
    globalThis.herdrShared = undefined;
  }
});

test("left and right move between cards and wrap; alt jumps to the ends", () => {
  const v = view([session("a", "waiting", 3), session("b", "busy", 5), session("c", "busy", 4)]);
  Object.assign(v, { scroll: { scroll_to_item() {} }, sel: "a" });
  press(v, "right"); assert.equal(v.sel, "b");
  press(v, "right"); assert.equal(v.sel, "c");
  press(v, "right"); assert.equal(v.sel, "a");
  press(v, "left"); assert.equal(v.sel, "c");
  press(v, "left", true); assert.equal(v.sel, "a");
  press(v, "right", true); assert.equal(v.sel, "c");
});

test("left and right cross the groups in one row, Done included", () => {
  const v = view([
    session("a", "waiting", 3),
    session("b", "busy", 5), session("c", "busy", 4),
    session("d1", "idle", 5), session("d2", "idle", 6),
  ]);
  v.sel = "c";
  press(v, "right");
  assert.equal(v.sel, "d1", "past the last Working card comes Done, not the first card");
  press(v, "right");
  assert.equal(v.sel, "d2");
  press(v, "right");
  assert.equal(v.sel, "a", "the last card wraps to the first");
  press(v, "left", true);
  assert.equal(v.sel, "a", "alt+left is the first card of the strip");
  press(v, "right", true);
  assert.equal(v.sel, "d2");
});

test("down opens a step column and scrolls it; up scrolls back and closes", () => {
  const steps = Array.from({ length: 14 }, (_, i) => ({ state: "left", label: `step ${i}` }));
  const v = view([session("s1", "busy", 5, { deadhd: { counts: { done: 0, now: 0, blocked: 0 }, total: 14, items: steps } })]);
  Object.assign(v, { scroll: { scroll_to_item() {} }, sel: "s1" });
  assert.equal(press(v, "down").stop, 1);
  assert.equal(v.expanded.has("s1"), true);
  assert.equal(v.stepTop.s1, 0);
  assert.equal(press(v, "down").stop, 1);
  assert.equal(v.stepTop.s1, 1);
  assert.equal(v.visibleSteps(v.selectedItem(v.viewData())).length, 9);
  assert.equal(press(v, "up").stop, 1);
  assert.equal(v.stepTop.s1, 0);
  assert.equal(press(v, "up").stop, 1);
  assert.equal(v.expanded.has("s1"), false);
});

test("down scrolls no further at the end, and up or down on a card without steps is not handled", () => {
  const steps = Array.from({ length: 14 }, (_, i) => ({ state: "left", label: `step ${i}` }));
  const v = view([
    session("plain", "waiting", 3),
    session("s1", "busy", 5, { deadhd: { counts: { done: 0, now: 0, blocked: 0 }, total: 14, items: steps } }),
  ]);
  Object.assign(v, { scroll: { scroll_to_item() {} }, sel: "s1", expanded: new Set(["s1"]), stepTop: { s1: 5 } });
  assert.equal(press(v, "down").stop, 1);
  assert.equal(v.stepTop.s1, 5);

  v.sel = "plain";
  assert.equal(press(v, "down").stop, 0);
  assert.equal(press(v, "up").stop, 0);
});

test("castOf lists every visible card with its mood, focus, topic and since", () => {
  const long = "가".repeat(60);
  const v = view([
    session("wait", "waiting", 3),
    session("stall", "busy", 20, { lastMeaningfulAt: NOW - 11 * MIN }),
    session("work", "busy", 4),
    session("done", "idle", 5, { customTitle: long }),
    session("seen", "idle", 6),
  ]);
  const item = (sessionId) => [...v.buildModel(NOW).attention, ...v.buildModel(NOW).working, ...v.buildModel(NOW).done]
    .find((entry) => entry.sessionId === sessionId);
  v.viewed = [item("seen").ackKey];
  const data = v.viewData(NOW);
  const cast = castOf(data.groups, "work", (entry) => (entry.sessionId === "wait" ? { pane: "p1" } : null));
  assert.deepEqual(cast.map((entry) => [entry.id, entry.mood, entry.selected, entry.focus]), [
    ["wait", "needs", false, { pane: "p1" }],
    ["stall", "stall", false, null],
    ["work", "working", true, null],
    ["done", "done", false, null],
    ["seen", "viewed", false, null],
  ]);
  assert.equal(cast[0].who, charFor("wait"));
  assert.equal(cast[0].topic, "wait");
  assert.equal(cast[0].since, NOW - 3 * MIN);
  assert.equal(cast[3].topic.length, 40, "a long topic is clipped to 40");
});

test("right on the last card reveals hidden Done cards and selects the first of them", () => {
  const v = view([
    session("b", "busy", 5),
    ...Array.from({ length: 6 }, (_, i) => session(`d${i}`, "idle", 10 + i)),
  ]);
  Object.assign(v, { scroll: { scroll_to_item() {} } });
  const data = v.viewData();
  assert.equal(data.hiddenDone, 1);
  const items = data.groups.flatMap((group) => group.items);
  v.sel = items.at(-1).sessionId;
  const calls = press(v, "right");
  assert.equal(calls.stop, 1);
  assert.equal(v.showAllDone, true);
  assert.equal(v.sel, "d5");
});

test("shift+enter opens a selected card's progress page, a Done card's first page, or flashes when there is none", () => {
  const v = view([
    session("prog", "waiting", 3, {
      deadhd: { counts: { done: 1, now: 1, blocked: 0 }, total: 2, items: [], pagePath: "/tmp/progress.html" },
    }),
    session("finished", "idle", 4, {
      pages: [{ label: "Progress", url: "https://example.test/page", openable: true }],
      deadhd: { counts: { done: 1, now: 0, blocked: 0 }, total: 1, items: [], pagePath: "/tmp/done.html" },
    }),
    session("plain", "waiting", 5),
  ]);
  Object.assign(v, { scroll: { scroll_to_item() {} } });
  const opened = [];
  const flashed = [];
  v.openPage = (page) => opened.push(page);
  v.flash = (_cx, message) => flashed.push(message);

  v.sel = "prog";
  press(v, "enter", false, true);
  assert.deepEqual(opened.at(-1), { url: "/tmp/progress.html", openable: true, files: [] });

  v.sel = "finished";
  press(v, "enter", false, true);
  assert.deepEqual(opened.at(-1), { label: "Progress", url: "https://example.test/page", openable: true });

  v.sel = "plain";
  press(v, "enter", false, true);
  assert.equal(flashed.at(-1), "This row has no page — pick a card that has one");
});

test("a session name someone chose becomes the topic; a generated one does not", async () => {
  const { chosenTitle } = await import("../mods/arcade-cards/main.js");
  assert.equal(chosenTitle("카드 UI 재설계"), "카드 UI 재설계");
  assert.equal(chosenTitle("japanesetutor"), "japanesetutor");
  assert.equal(chosenTitle("herdrarcadecards-1106-01"), null);
  assert.equal(chosenTitle("api-cserver-ABC-1435-1106-02"), null);
  assert.equal(chosenTitle("mv-1791252016"), null);
  assert.equal(chosenTitle("plan-2026-11"), "plan-2026-11", "only a real MMdd stamp marks a generated name");
  assert.equal(chosenTitle(null), null);
  const v = view([
    session("r", "busy", 3, { customTitle: "카드 UI 재설계", deadhd: null, identity: { firstPrompt: "/relay 스킬 때문에 앞 문장이 항상 경로인데" } }),
    session("g", "busy", 3, { customTitle: "herdrarcadecards-1106-01", identity: { firstPrompt: "레일 고쳐 줘" } }),
  ]);
  const m = v.buildModel(NOW);
  const topic = (id) => [...m.attention, ...m.working, ...m.done].find((i) => i.sessionId === id).topic;
  assert.equal(topic("r"), "카드 UI 재설계", "/rename beats every other source");
  assert.equal(topic("g"), "레일 고쳐 줘");
});

test("the strip reads the way Space and Shift+Space move: Needs you from the left, Done from the right", () => {
  const v = view([
    session("stall", "busy", 30, { lastMeaningfulAt: NOW - 25 * MIN }),
    session("wait-new", "waiting", 3),
    session("wait-old", "waiting", 9),
    session("done-new", "idle", 2),
    session("done-old", "idle", 40),
  ]);
  const model = v.buildModel(NOW);
  assert.deepEqual(model.attention.map((item) => item.sessionId), ["wait-old", "wait-new", "stall"],
    "replies first, oldest on the left, then the stall Space skips, even though it is older");
  assert.deepEqual(model.done.map((item) => item.sessionId), ["done-new", "done-old"], "the oldest finished card is at the right end");
});

test("toneKey names each real card's tone, and stalls keep their character still", () => {
  const agent = (address, status) => ({ address, pane: `p-${address}`, status, app: "codex", title: `${address} job`, space_name: "acme", program: { name: "codex" } });
  const v = view([
    session("wait", "waiting", 3),
    session("work", "busy", 4),
    session("stall", "busy", 20, { lastMeaningfulAt: NOW - 11 * MIN }),
  ], { agents: [agent("t4", "idle")] });
  const model = v.buildModel(NOW);
  const item = (sessionId) => [...model.attention, ...model.working, ...model.done].find((entry) => entry.sessionId === sessionId);

  assert.equal(toneKey(v.tone(item("wait"))), "needs");
  assert.equal(toneKey(v.tone(item("work"))), "working");
  assert.equal(toneKey(v.tone(item("stall"))), "stall");
  assert.equal(toneKey(v.tone(item("agent:t4"))), "done");

});

test("a card's title is the session name, and the last prompt only fills in when there is none", () => {
  const v = view([
    session("p", "idle", 5, { name: null, lastPrompt: "fix the login bug", lastAnswer: "Done. The bug is fixed." }),
    session("abc1408ai-1105-04", "busy", 4, { lastPrompt: "/Users/dev/orca/workspaces/api/a.md 를 먼저 읽어" }),
  ]);
  const model = v.buildModel(NOW);
  const item = (sessionId) => [...model.attention, ...model.working, ...model.done].find((entry) => entry.sessionId === sessionId);

  assert.equal(item("p").title, "fix the login bug");
  assert.equal(item("p").replyTail, "Done. The bug is fixed.");
  assert.equal(item("abc1408ai-1105-04").title, "abc1408ai-1105-04");
});

test("a strip click on an unknown row key leaves the selection alone and calls nothing", () => {
  const v = view([session("a", "waiting", 3)]);
  v.sel = "a";
  let moved = 0;
  let notified = 0;
  v.goTo = () => { moved += 1; };
  v.clickStrip("card-nope", { notify() { notified += 1; } });
  assert.equal(v.sel, "a");
  assert.equal(moved, 0);
  assert.equal(notified, 0);
});

test("charFor is stable and the rail mod uses the same function", () => {
  for (const key of ["t1", "t22", "abc", ""]) assert.ok(["kid", "robot", "cat", "oldman", "frog", "punk"].includes(charFor(key)));
  assert.equal(charFor("t7"), charFor("t7"));
  const rail = readFileSync(new URL("../mods/arcade-rail/main.js", import.meta.url), "utf8");
  const body = rail.match(/function charFor\(key\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(body, "arcade-rail defines charFor");
  const railChars = rail.match(/^const CHARS = (\[[^\]]*\]);$/m)?.[1];
  const cards = readFileSync(new URL("../mods/arcade-cards/main.js", import.meta.url), "utf8");
  assert.equal(railChars, cards.match(/^const CHARS = (\[[^\]]*\]);$/m)?.[1], "rail and cards list the characters in the same order");
  const railChar = new Function(`const CHARS = ${railChars}; ${body}; return charFor;`)();
  for (const key of ["t1", "t2", "t3", "t4", "t16n", "vps/t9"]) assert.equal(railChar(key), charFor(key));
});

test("every character has a persona line for every tone, and the strip draws at least six of them", () => {
  const CHARS = ["kid", "robot", "cat", "oldman", "frog", "punk"];
  for (const who of CHARS) {
    for (const key of ["needs", "stall", "working", "done"]) {
      assert.ok(personaLine(who, key).length > 0, `${who}/${key}`);
    }
  }
  assert.equal(personaLine("nobody", "needs"), "");
  const kid = new Set(Array.from({ length: 2 }, (_, i) => personaLine("kid", "needs", i * 3000)));
  assert.equal(kid.size, 2, "Kid's needs sounds take turns, one per poll");
  assert.equal(personaLine("kid", "needs", 0), personaLine("kid", "needs", 2999));
  const seen = new Set(Array.from({ length: 200 }, (_, i) => charFor(`t${i}`)));
  assert.ok(seen.size >= 6, `charFor picked ${seen.size} characters`);
});

test("the rail crew orders faces by status, caps them, and counts only shell-only terminals", async () => {
  const { crewOf } = await import("../mods/arcade-rail/main.js");
  const a = (address, status, space = "s1") => ({ address, status, space, title: `${address} job`, program: { name: "codex" } });
  const list = [a("t4", "idle"), a("t2", "working"), a("t3", "blocked"), a("t1", "done"), a("t9", "working", "s2")];
  const shell = (address) => ({ address, program: { shell: true } });
  const noShell = crewOf("s1", [shell("t2")], list);
  assert.deepEqual(noShell.faces.map((f) => f.address), ["t3", "t2", "t1"]);
  assert.equal(noShell.hidden, 1);
  assert.equal(noShell.shells, 0, "a shell terminal that runs an agent is not shell-only");
  assert.equal(noShell.tip, "t3 job, t2 job, t1 job, t4 job");
  const withShell = crewOf("s1", [shell("t2"), shell("t7")], list);
  assert.deepEqual([withShell.faces.length, withShell.hidden, withShell.shells], [2, 2, 1]);
  assert.equal(withShell.tip, "t3 job, t2 job, t1 job, t4 job · 1 shell");
  assert.deepEqual(crewOf("s3", [], list), { faces: [], hidden: 0, shells: 0, tip: "" });
});

test("rail tiles shorten each space name to its shortest unique prefix", async () => {
  const { tileLabels } = await import("../mods/arcade-rail/main.js");
  assert.deepEqual(
    tileLabels(["cserver", "cconsole", "cworker", "cdocs", "web", "api", "herdr-arcade-cards", "harness"]),
    ["cs", "cc", "cw", "cd", "we", "ap", "he", "ha"]);
  assert.deepEqual(tileLabels(["abc-1402", "abc-1405"]), ["1402", "1405"]);
  // The real rail on 2026-11-05: the old last-character fallback gave `cai` twice.
  assert.deepEqual(
    tileLabels(["abc-1408-ai", "abc-1421-ai-ai", "abc-1256-jev", "abc-1312-mvp-ai-chatwoot", "ABC-1402",
      "api-cserver-test-code", "api-cserver-ABC-1435", "web", "resumed", "herdr-arcade-cards"]),
    ["1408", "1421", "1256", "1312", "1402", "test", "1435", "we", "re", "he"]);
  assert.deepEqual(tileLabels(["same", "same"]), ["sam", "sam"]);
  assert.deepEqual(tileLabels(["", "#x"]), ["?", "x"]);
});

// Real cwds from scan.sh on 2026-11-06.
test("the place puts the ticket key first and drops the repo prefix, rd stamp and hash", () => {
  const known = ["api", "web", "docs"];
  const p = (cwd) => { const { key, rest, repo, label } = placeOf(cwd, null, known, ["ABC"]); return { key, rest, repo, label }; };
  assert.deepEqual(p("/Users/dev/git-repo/api-cserver-ABC-1435"), { key: "ABC-1435", rest: "cserver", repo: "api", label: "cserver · api" });
  assert.deepEqual(p("/Users/dev/orca/workspaces/api/abc-1408-ai"), { key: "ABC-1408", rest: "ai", repo: "api", label: "ai · api" });
  assert.deepEqual(p("/Users/dev/orca/workspaces/api/ABC-1402"), { key: "ABC-1402", rest: null, repo: "api", label: "api" });
  assert.deepEqual(p("/Users/dev/git-repo/api-cserver-rd-20261103-173837-abc-1435-c1acff-story-S1b"),
    { key: "ABC-1435", rest: "cserver-story-S1b", repo: "api", label: "cserver-story-S1b · api" });
  assert.deepEqual(p("/Users/dev/git-repo/herdr-arcade-cards"), { key: null, rest: null, repo: null, label: "herdr-arcade-cards" });
  assert.deepEqual(placeOf("/Users/dev/git-repo/api-cserver-ABC-1435"),
    { key: "ABC-1435", rest: "api-cserver", repo: null, label: "api-cserver", slack: false }, "no knownRepos prop means no repo prefix");
  assert.equal(placeOf("/x/sessions/C000TEST-1793691052_993259", { channel: "C000TEST" }).slack, true);
});

test("without ticketPrefixes only an uppercase key is a ticket, so a plain folder name is not", () => {
  assert.equal(placeOf("/Users/dev/git-repo/ABC-7-fix").key, "ABC-7");
  assert.equal(placeOf("/Users/dev/git-repo/worker-2").key, null);
});

test("the topic comes from the handoff, the Slack thread, a pasted brief or the first prompt, cleaned", () => {
  assert.equal(topicOf({ handoff: "ABC-1408 AI 점원 뜻 검색과 추천 이유 — rolling-delivery 본 핸드오프" }, "ABC-1408"), "AI 점원 뜻 검색과 추천 이유");
  assert.equal(topicOf({ handoff: "ABC-1435 AI 상담 끄기 이유 묻기 (rolling-delivery)" }, "ABC-1435"), "AI 상담 끄기 이유 묻기");
  assert.equal(topicOf({ handoff: "ABC-1256 해결 예상 루프 사람 퇴장(2026-11-09 05:00 자동 excluded) 실행 핸드오프" }, "ABC-1256"),
    "해결 예상 루프 사람 퇴장");
  assert.equal(topicOf({ slack: { topic: "블루문 사장님 복지몰(example.com) 오픈베타 오픈 알림. OCR job c4f5e194, 실패 93건." } }),
    "블루문 사장님 복지몰(example.com) 오픈베타 오픈 알림.");
  assert.equal(topicOf({ slack: { topic: "<@U0B6SB84B17> 대시보드 링크 사내망에서만 접속할 수 있게 수정해서 운영까지 배포해줘." } }),
    "대시보드 링크 사내망에서만 접속할 수 있게 수정해서 운영까지 배포해줘.");
  assert.equal(topicOf({ paste: "일본어 회화 튜터", firstPrompt: "<pasted_content> # 일본어 회화 튜터" }), "일본어 회화 튜터");
  assert.equal(topicOf({ firstPrompt: "[Image #1] 이거 `/relay` 스킬 때문에 앞 문장이 항상 경로야. 고쳐 줘" }), "/relay 스킬 때문에 앞 문장이 항상 경로야.");
  assert.equal(topicOf({ firstPrompt: "https://example.atlassian.net/browse/ABC-1313\n이거 진행할 건데 조사 후 /relay --auto 로" }),
    "진행할 건데 조사 후 /relay --auto 로");
  assert.equal(topicOf(null), null);
});

test("a reply loses links, markdown and a bold heading before a list, but keeps a bold sentence", () => {
  assert.equal(cleanMessage("**앞으로 할 것** - **12-14 3차 점검:** `greeting` 표본이 10건을 넘으면 확인해."),
    "12-14 3차 점검: greeting 표본이 10건을 넘으면 확인해.");
  assert.equal(cleanMessage("**자동 실행은 하지 않았어.** HAR을 저장해 줘. http://127.0.0.1:47615/relay/282?h=t18k"),
    "자동 실행은 하지 않았어. HAR을 저장해 줘.");
  assert.equal(cleanMessage("http://127.0.0.1:47615/relay/178"), null);
});

test("text wraps to the lines it may use and the last kept line ends in an ellipsis", () => {
  assert.deepEqual(wrapLines("short", 12, 190, 2), ["short"]);
  const lines = wrapLines("가".repeat(40), 12, 190, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…"));
  assert.ok(lines.every((line) => textWidth(line, 12) <= 190));
  assert.deepEqual(wrapLines("one two three four", 12, 70, 2), ["one two", "three four"]);
  assert.deepEqual(wrapLines("", 12, 190, 2), []);
});

test("Korean wraps at its spaces, and only a word wider than the line is cut inside", () => {
  assert.deepEqual(wrapLines("한국어 문장을 자르지 않고 말줄임표로 끝내기", 12, 96, 2),
    ["한국어 문장을", "자르지 않고…"], "the second line ends at a space before the ellipsis");
  assert.deepEqual(wrapLines("한국어 문장을 자르지 않고 말줄임표로 끝내기", 12, 96, 1), ["한국어 문장을…"]);
  assert.deepEqual(wrapLines("a bbbbbbbbbbbbbbb", 12, 55, 2), ["a", "bbbbbb…"],
    "a word longer than the line is cut inside it");
  assert.deepEqual(wrapLines("가나다라마바사아자차카타파하거너더", 12, 96, 2), ["가나다라마바사아", "자차카타파하거…"],
    "with no space at all, the cut is inside the word");
});

test("both Needs you replies wrap over the message panel instead of one being cut with an ellipsis", () => {
  const g = geometry(1);
  const lines = screenLines(screenHeight({}, g), g);
  for (const text of ["ABC-0002 테스트 픽스처를 지워도 될까요?", "ABC-0001 prod 롤아웃을 진행할까요?"]) {
    const wrapped = wrapLines(text, g.TEXT.message, g.MSG_W, lines);
    assert.ok(wrapped.length > 1, `${text} takes more than one line`);
    assert.equal(wrapped.join(" "), text, "no word is dropped");
    assert.ok(!wrapped.some((line) => line.endsWith("…")), "and nothing is cut short");
    for (const line of wrapped) assert.ok(textWidth(line, g.TEXT.message) <= g.MSG_W);
  }
});

test("a Korean topic that fits the card on screen stays on one line", () => {
  assert.deepEqual(wrapLines("연봉 계산기 웹페이지를 만들 거야.", 13, TEXT_W, 2), ["연봉 계산기 웹페이지를 만들 거야."]);
  assert.ok(textWidth("ABC", 13) > textWidth("abc", 13), "capitals are wider than lowercase");
  assert.ok(textWidth("0123456789", 13) >= 78, "digits are not counted narrower than CoreText measures them");
  assert.ok(textWidth(" .,:", 13) < textWidth("abcd", 13), "spaces and punctuation are narrower than letters");
});

test("the band shows the key with its round and PR, Slack with its lane, and nothing for a plain folder", () => {
  const v = view([
    session("j", "busy", 3, { cwd: "/Users/dev/git-repo/api-cserver-ABC-1435", identity: { round: 5, handoff: "ABC-1435 AI 상담 끄기 이유 묻기" },
      pr: { number: 9330, url: "https://github.com/example-org/web/pull/9330" } }),
    session("m", "idle", 3, { cwd: "/x/bot-sessions/sessions/C000TEST-1793691052_993259",
      identity: { slack: { channel: "C000TEST", lane: "prod", topic: "블루문 오픈 알림." } },
      pr: { number: 9401, url: "https://github.com/example-org/web/pull/9401" } }),
    session("h", "busy", 3, { cwd: "/Users/dev/git-repo/herdr-arcade-cards", pr: { number: 7, url: "https://github.com/lcalmsky/herdr-arcade-cards/pull/7" } }),
  ]);
  v.knownRepos = ["api", "web", "docs"];
  const item = (id) => { const m = v.buildModel(NOW); return [...m.attention, ...m.working, ...m.done].find((i) => i.sessionId === id); };
  assert.deepEqual(v.keyTagOf(item("j")), { head: "ABC-1435", sub: "Round 5 · web#9330" });
  assert.equal(item("j").topic, "AI 상담 끄기 이유 묻기");
  assert.deepEqual(v.keyTagOf(item("m")), { head: "Slack", sub: "prod lane" });
  assert.equal(v.keyTagOf(item("h")), null);
  assert.equal(item("h").prTag, "#7");
  assert.ok(!v.trayChips(item("j")).includes(item("j").prTag), "the band already shows this PR");
  assert.ok(item("m").prTag && v.trayChips(item("m")).includes(item("m").prTag), "a Slack band shows only its lane, so the PR goes to the tray");
  assert.ok(v.trayChips(item("h")).includes("#7"));
});

test("a right-click opens the card's links in order: ticket, pull requests, Slack thread, pages", async () => {
  const { linksOf, slackThreadOf, linksMenuHeight, LINKS_W } = await import("../mods/arcade-cards/main.js");
  const v = view([
    session("j", "busy", 3, { cwd: "/Users/dev/git-repo/api-cserver-ABC-1435", pr: { number: 9330, url: "https://github.com/example-org/web/pull/9330" } }),
    session("m", "idle", 3, { cwd: "/x/bot-sessions/sessions/C000TEST-1793691052_993259",
      identity: { slack: { channel: "C000TEST", lane: "prod", topic: "블루문 오픈 알림." } } }),
    session("h", "busy", 3, { cwd: "/Users/dev/git-repo/herdr-arcade-cards" }),
  ]);
  v.knownRepos = ["api", "web", "docs"];
  const item = (id) => { const m = v.buildModel(NOW); return [...m.attention, ...m.working, ...m.done].find((i) => i.sessionId === id); };
  const bases = { jiraBase: "https://example.atlassian.net/browse/", slackBase: "https://example.slack.com/archives/" };
  assert.deepEqual(linksOf(item("j"), bases).map((l) => [l.kind, l.meta, l.url, l.hot]), [
    ["jira", "ABC-1435", "https://example.atlassian.net/browse/ABC-1435", "j"],
    ["pr", "web#9330", "https://github.com/example-org/web/pull/9330", "p"],
  ]);
  assert.deepEqual(slackThreadOf("/x/C000TEST-1793691052_993259"), { channel: "C000TEST", ts: "1793691052.993259" });
  assert.equal(slackThreadOf("/Users/dev/git-repo/api"), null);
  assert.deepEqual(linksOf(item("m"), bases).map((l) => [l.kind, l.meta, l.url]),
    [["slack", "prod lane", "https://example.slack.com/archives/C000TEST/p1793691052993259"]]);
  assert.deepEqual(linksOf(item("j")).map((l) => l.kind), ["pr"], "no jiraBase prop means no ticket row");
  assert.deepEqual(linksOf(item("m")), [], "no slackBase prop means no thread row");
  assert.deepEqual(linksOf(item("h")), []);
  assert.deepEqual(linksOf({ jiraKey: null, prLinks: [{ url: "https://g/1", tag: "#1" }, { url: "https://g/2", tag: "#2" }],
    pages: [{ label: "Progress", url: "http://127.0.0.1:1/p", openable: true }] }).map((l) => [l.kind, l.hot]), [["pr", "p"], ["pr", null], ["page", "g"]]);

  globalThis.herdrOverlays = [];
  let notified = 0;
  Object.assign(v, bases);
  v.openLinks("card-j", { notify: () => { notified += 1; } });
  const [spec] = globalThis.herdrOverlays;
  assert.equal(v.sel, "j", "the right-clicked card is selected");
  assert.equal(notified, 1);
  assert.deepEqual([spec.mod, spec.kind, spec.width, spec.height, spec.props.role, spec.props.head],
    ["arcade-cards", "popup", LINKS_W, linksMenuHeight(2), "links", "ABC-1435"]);
  assert.equal(spec.props.links.length, 2);
  assert.equal(linksMenuHeight(0), 6 + 50 + 30 + 6, "a card with no links still opens a menu that says so");
  v.openLinks("card-nope", { notify() {} });
  assert.equal(globalThis.herdrOverlays.length, 1);
  globalThis.herdrOverlays = undefined;
});

test("the links popup opens http links through the system, local pages through open, and reads its keys", async () => {
  const { linksOf } = await import("../mods/arcade-cards/main.js");
  assert.deepEqual(linksOf({ pages: [{ label: "Progress", url: "http://127.0.0.1:1/p", openable: true },
    { label: "Bad", url: "-a Calculator", openable: false }] }).map((l) => l.url), ["http://127.0.0.1:1/p"],
  "a page scan.sh didn't vouch for stays out of the menu and the copied text");

  globalThis.herdrState = { props: { role: "links", overlay: "o9" } };
  globalThis.herdrClosed = [];
  const opened = [];
  const copied = [];
  let stopped = 0;
  const cx = { open_url: (url) => opened.push(url), write_to_clipboard: (text) => copied.push(text), stop_propagation: () => { stopped += 1; }, notify() {} };
  const v = new ArcadeCards();
  Object.assign(v, { role: "links", active: 0 });
  const links = [
    { kind: "jira", url: "https://example.atlassian.net/browse/ABC-1", hot: "j" },
    { kind: "pr", url: "https://github.com/a/b/pull/1", hot: "p" },
    { kind: "page", url: "/tmp/page.html", hot: "g" },
  ];
  v.linksKey("p", links, cx);
  assert.deepEqual(opened, ["https://github.com/a/b/pull/1"]);
  assert.deepEqual(globalThis.herdrClosed, ["o9"], "opening a link closes the menu");
  v.linksKey("g", links, cx);
  assert.equal(opened.length, 1, "a local page is not handed to open_url");
  v.linksKey("up", links, cx);
  assert.equal(v.active, 2, "up wraps to the last row");
  v.linksKey("down", links, cx);
  assert.equal(v.active, 0);
  v.linksKey("enter", links, cx);
  assert.equal(opened.at(-1), "https://example.atlassian.net/browse/ABC-1");
  const before = stopped;
  v.linksKey("x", links, cx);
  assert.equal(stopped, before, "an unknown key is left alone");
  v.copyLinks(links, cx);
  assert.deepEqual(copied, [links.map((l) => l.url).join("\n")]);
  globalThis.herdrClosed = undefined;
  globalThis.herdrState = {};
});

test("the links popup renders without touching focus, which Herdr refuses during render", () => {
  globalThis.herdrState = { props: { role: "links", head: "ABC-1435", topic: "운영진이 AI 상담을 끌 때",
    links: [{ kind: "jira", label: "Jira ticket", meta: "ABC-1435", url: "https://example.atlassian.net/browse/ABC-1435", hot: "j" }] } };
  const v = new ArcadeCards();
  Object.assign(v, { role: "links", active: 0, handle: { focus() { throw new Error("focus changed during render"); } } });
  assert.doesNotThrow(() => v.render());
  globalThis.herdrState = { props: { role: "links", head: "x", topic: null, links: [] } };
  assert.doesNotThrow(() => v.render(), "a card with no links renders too");
});

test("the links menu offers the checklist row only for a Claude session with a live terminal and no checklist", async () => {
  const { linksMenuHeight } = await import("../mods/arcade-cards/main.js");
  const state = {
    terminals: [
      { address: "t1b1", state: "live", cwd: "/repo/cards" },
      { address: "t2c2", state: "live", cwd: "/repo/other" },
    ],
  };
  const card = (id, extra = {}) => session(id, "busy", 3, {
    cwd: "/repo/cards", where: { kind: "herdr-app", terminalId: "t1b1" }, ...extra,
  });
  const v = view([
    card("none"),
    card("has", { deadhd: { counts: { done: 1, now: 0, blocked: 0 }, total: 1 } }),
    card("off", { deadhd: { off: true, counts: { done: 1, now: 0, blocked: 0 }, total: 1 } }),
    session("lost", "busy", 3, { cwd: "/repo/nowhere", where: { kind: "herdr-app", terminalId: "t2c2" } }),
  ], state);
  const open = (key) => {
    globalThis.herdrOverlays = [];
    v.openLinks(key, { notify() {} });
    return globalThis.herdrOverlays[0];
  };
  const spec = open("card-none");
  assert.deepEqual([spec.props.showChecklist, spec.props.terminal, spec.props.working], [true, "t1b1", true]);
  assert.equal(spec.height, linksMenuHeight(0, true));
  assert.equal(open("card-has").props.showChecklist, false, "a card with a checklist has no row");
  assert.equal(open("card-off").props.showChecklist, true, "deadhd.off is no checklist");
  assert.equal(open("card-lost").props.showChecklist, false, "a session without a live terminal has no row");
  globalThis.herdrOverlays = undefined;
});

test("the checklist row adds 30 px, plus a 9 px separator when links follow it", async () => {
  const { linksMenuHeight } = await import("../mods/arcade-cards/main.js");
  assert.equal(linksMenuHeight(0, true), linksMenuHeight(0) + 30);
  assert.equal(linksMenuHeight(2, true), linksMenuHeight(2) + 30 + 9);
  assert.equal(linksMenuHeight(2, false), linksMenuHeight(2), "the links-only menu keeps its height");
});

test("the checklist send runs hc with the terminal and the queued prompt as positional args", async () => {
  const { CHECKLIST_PROMPT, CHECKLIST_QUEUED_PROMPT } = await import("../mods/arcade-cards/main.js");
  const send = async (working) => {
    globalThis.herdrState = { props: { role: "links", overlay: "o9", showChecklist: true, terminal: "t1b1", working } };
    globalThis.herdrExec = [];
    globalThis.herdrClosed = [];
    const v = new ArcadeCards();
    Object.assign(v, { role: "links", active: 0, error: null });
    let task;
    const cx = { notify() {}, spawn(fn) { task = fn(cx); } };
    v.enableChecklist(cx);
    await task;
    return { exec: globalThis.herdrExec, closed: globalThis.herdrClosed, view: v };
  };
  const busy = await send(true);
  assert.deepEqual(busy.exec, [["sh", ["-lc", 'hc send "$1" "$2"', "x", "t1b1", CHECKLIST_QUEUED_PROMPT]]],
    "the prompt and the terminal are single positional arguments");
  assert.deepEqual(busy.closed, ["o9"], "a sent request closes the menu");
  const idle = await send(false);
  assert.deepEqual(idle.exec[0][1].at(-1), CHECKLIST_PROMPT, "an idle session gets the plain prompt");
  assert.equal(idle.view.error, null);
  globalThis.herdrExec = undefined;
  globalThis.herdrClosed = undefined;
  globalThis.herdrState = {};
});

test("C and enter run the highlighted checklist row before any link", async () => {
  globalThis.herdrState = { props: { role: "links", overlay: "o9", terminal: "t1b1" } };
  const v = new ArcadeCards();
  Object.assign(v, { role: "links", active: 0, enableChecklist() { this.enabled = (this.enabled ?? 0) + 1; } });
  const links = [{ kind: "jira", url: "https://example.atlassian.net/browse/ABC-1", hot: "j" }];
  const rows = [{ checklist: true }, ...links];
  const opened = [];
  v.openLink = (link) => { opened.push(link.url); };
  const cx = { stop_propagation() {}, notify() {}, open_url() {} };
  v.linksKey("c", rows, cx);
  v.linksKey("enter", rows, cx);
  assert.equal(v.enabled, 2, "C and enter on the highlighted row ask for the checklist");
  v.active = 1;
  v.linksKey("enter", rows, cx);
  assert.deepEqual(opened, ["https://example.atlassian.net/browse/ABC-1"], "row 1 is still the first link");
  v.linksKey("down", rows, cx);
  assert.equal(v.active, 0, "up/down move through the checklist row too");
  globalThis.herdrState = {};
});

test("with nothing to say the message slot shows the last prompt, unless it only points at a handoff", () => {
  const v = view([
    session("q", "idle", 3, { lastPrompt: "이어서 해줘 실수로 다른 거 입력했어." }),
    session("r", "idle", 3, { lastPrompt: "/Users/dev/git-repo/api/.claude/handoff/ABC-1421-S14.md 를 먼저 읽고" }),
  ]);
  const item = (id) => { const m = v.buildModel(NOW); return [...m.attention, ...m.working, ...m.done].find((i) => i.sessionId === id); };
  assert.deepEqual(v.messageOf(item("q")), { text: "↳ 이어서 해줘 실수로 다른 거 입력했어.", quiet: true, spinner: false });
  assert.equal(v.messageOf(item("r")), null);
});

test("with no utterance at all the screen falls back to the topic", () => {
  const v = view([
    session("t", "idle", 3, { lastPrompt: "/Users/dev/git-repo/api/.claude/handoff/ABC-1.md 를 먼저 읽고",
      identity: { handoff: "배포 승인 흐름 정리" } }),
    session("u", "idle", 3),
  ]);
  const item = (id) => { const m = v.buildModel(NOW); return [...m.attention, ...m.working, ...m.done].find((i) => i.sessionId === id); };
  assert.deepEqual(v.messageOf(item("t")), { text: "배포 승인 흐름 정리", quiet: true, spinner: false });
  assert.equal(v.messageOf(item("u")), null, "a session with no topic and nothing to say stays empty");
});

test("the screen under the head fills the card's height, so no bare stretch is left", () => {
  const one = geometry(1);
  const rest = (showProgress, tray) => one.HEAD_H + one.MSG_MT
    + (showProgress ? one.PROGRESS_H + one.PROGRESS_MB : 0) + (tray ? one.TRAY_H + one.TRAY_MB : 0) + one.STATE_H;
  for (const showProgress of [false, true]) {
    for (const tray of [false, true]) {
      const screen = screenHeight({ showProgress, tray }, one);
      assert.equal(one.CARD_H - 4 - one.BODY_PT - one.BODY_PB, rest(showProgress, tray) + screen,
        `head, screen, progress, tray and state fill the card (progress ${showProgress}, tray ${tray})`);
    }
  }
  const full = screenHeight({ showProgress: true, tray: true }, one);
  assert.equal(full, 118);
  assert.equal(screenLines(full, one), 6, "the message wraps over the lines the screen holds");
});

test("the lead line is the now line, the answer or the last reply, and only a non-herdr host gets a badge", () => {
  const v = view([
    session("w", "busy", 4, { currentAction: "running the tests" }),
    session("q", "waiting", 3, { lastAnswer: "Merge it now?" }),
    session("d", "idle", 2, { lastAnswer: "Merged and deployed.", where: { kind: "tmux" } }),
    session("e", "idle", 1),
  ]);
  const model = v.buildModel(NOW);
  const item = (sessionId) => [...model.attention, ...model.working, ...model.done].find((entry) => entry.sessionId === sessionId);
  assert.deepEqual(v.leadOf(item("w")), { text: "running the tests", waiting: false, spinner: true });
  assert.equal(v.leadOf(item("q")).text, "Merge it now?");
  assert.equal(v.leadOf(item("d")).text, "Merged and deployed.");
  assert.equal(v.leadOf(item("e")), null);
  const shell = view([session("sh", "shell", 4)]).buildModel(NOW).working[0];
  assert.deepEqual(v.leadOf(shell), { text: "Waiting on background tasks", waiting: true, spinner: false });
  const stepping = view([session("st", "shell", 4, {
    deadhd: { counts: { done: 1, now: 1, blocked: 0 }, total: 3, items: [], nowLabel: "Run the tests" },
  })]).buildModel(NOW).working[0];
  assert.deepEqual(v.leadOf(stepping), { text: "▶ Run the tests", waiting: false, spinner: false });
  const silent = view([session("si", "busy", 4)]).buildModel(NOW).working[0];
  assert.equal(v.leadOf(silent), null);
  assert.equal(v.kindBadge(item("w")), null);
  assert.equal(v.kindBadge(item("d")), "tmux");
});

test("the step column shows nine rows and clamps its window to the end", () => {
  const steps = Array.from({ length: 14 }, (_, i) => ({ state: "left", label: `step ${i}` }));
  const deadhd = { counts: { done: 0, now: 0, blocked: 0 }, total: 14, items: steps };
  const v = view([session("n", "busy", 5, { deadhd })]);
  const item = v.buildModel(NOW).working[0];

  assert.equal(v.stepCounter(item), "1–9 / 14");
  v.stepTop.n = 9;
  assert.equal(v.visibleSteps(item).length, 9);
  assert.equal(v.stepCounter(item), "6–14 / 14");

  const few = Array.from({ length: 8 }, (_, i) => ({ state: "left", label: `step ${i}` }));
  const fit = view([session("f", "busy", 5, { deadhd: { counts: { done: 0, now: 0, blocked: 0 }, total: 8, items: few } })]);
  assert.equal(fit.stepCounter(fit.buildModel(NOW).working[0]), null);
});

test("ctrl-alt-p on the strip hands the keyboard back to the pane below", () => {
  const v = view([session("a", "waiting", 3)]);
  Object.assign(v, { scroll: { scroll_to_item() {} } });
  globalThis.herdrRuns = [];
  const calls = press(v, "p", true, false, true);
  assert.deepEqual(globalThis.herdrRuns, [["pane.go", { direction: "down" }]]);
  assert.equal(calls.stop, 1);
  assert.equal(v.query, "");
  delete globalThis.herdrRuns;
});

test("a conversation sent to the background is one card, with the old record's terminal and checklist", () => {
  const cwd = "/repo/cards";
  const deadhd = { counts: { done: 7, now: 0, blocked: 0 }, total: 7, items: [] };
  const old = session("old", "busy", 30, { name: "cards-06", cwd, kind: "interactive", parkedJobId: "94b4d6cf",
    where: { kind: "herdr-app", terminalId: "t17h" }, deadhd });
  // The bg process restarts on its own, so its startedAt says nothing about the hand-off.
  const bg = session("bg", "busy", 1, { name: "cards-06", cwd, kind: "bg", jobId: "94b4d6cf", startedAt: NOW,
    where: { kind: "herdr-app", terminalId: "t16r" } });
  const other = session("other", "busy", 2, { name: "cards-07", cwd, startedAt: NOW - 20 * MIN, updatedAt: NOW });

  const folded = foldHandoffs([old, bg, other]);
  assert.deepEqual(folded.map((raw) => raw.sessionId), ["bg", "other"]);
  assert.equal(folded[0].where.terminalId, "t17h");
  assert.equal(folded[0].deadhd, deadhd);
  assert.deepEqual(view([old, bg, other]).buildModel(NOW).working.map((item) => item.sessionId).sort(), ["bg", "other"]);

  const state = {
    terminals: [{ address: "t16r", state: "live", cwd: "/repo/chatwoot" }, { address: "t17h", state: "live", cwd }],
    panes: [{ pane: "p16r", terminal: "t16r" }, { pane: "p17h", terminal: "t17h" }],
  };
  const clicked = view([old, bg], state);
  const card = clicked.buildModel(NOW).working[0];
  globalThis.herdrRuns = [];
  clicked.goTo(card, {});
  assert.deepEqual(globalThis.herdrRuns, [["pane.focus", { pane: "p17h" }]]);
  globalThis.herdrRuns = [];
  const alone = view([bg], state);
  alone.goTo(alone.buildModel(NOW).working[0], { notify() {}, timer: { after() {} } });
  assert.deepEqual(globalThis.herdrRuns, []);
  assert.equal(alone.notice, "Not in Herdr, tmux or Orca — open the session's terminal first");
  globalThis.herdrRuns = undefined;

  const otherJob = { ...bg, jobId: "11111111" };
  assert.equal(foldHandoffs([old, otherJob]).length, 2);
  assert.equal(foldHandoffs([{ ...old, parkedJobId: null }, bg]).length, 2);
});

test("a claude-bg card focuses its attached pane or splits one running claude attach", () => {
  const bg = session("bg-1", "busy", 1, {
    kind: "bg",
    where: { kind: "claude-bg", paneId: "p1", attachId: "e7b86417" },
  });
  const attached = view([bg], { panes: [{ pane: "p1", terminal: "t1" }] });
  globalThis.herdrRuns = [];
  attached.goTo(attached.buildModel(NOW).working[0], {});
  assert.deepEqual(globalThis.herdrRuns, [["pane.focus", { pane: "p1" }]]);
  assert.deepEqual(attached.focusOf(attached.buildModel(NOW).working[0]), { pane: "p1" });

  const detached = view([bg], { panes: [] });
  globalThis.herdrRuns = [];
  detached.goTo(detached.buildModel(NOW).working[0], {});
  assert.deepEqual(globalThis.herdrRuns, [["pane.split", { direction: "right", argv: ["claude", "attach", "e7b86417"] }]]);
  assert.equal(detached.focusOf(detached.buildModel(NOW).working[0]), null);
  globalThis.herdrRuns = [];
  detached.goTo(detached.buildModel(NOW).working[0], {});
  assert.deepEqual(globalThis.herdrRuns, [], "a second click before the next scan opens no second pane");

  const inApp = session("bg-2", "busy", 1, {
    kind: "bg",
    where: { kind: "claude-bg", paneId: null, terminalId: "t1gj", attachId: "e7b86418" },
  });
  const app = view([inApp], { panes: [{ pane: "p9", terminal: "t1gj" }], terminals: [{ address: "t1gj", state: "live" }] });
  globalThis.herdrRuns = [];
  app.goTo(app.buildModel(NOW).working[0], {});
  assert.deepEqual(globalThis.herdrRuns, [["pane.focus", { pane: "p9" }]]);
  globalThis.herdrRuns = undefined;
});

test("an inherited terminal id is trusted only while that terminal sits in the session's folder", () => {
  const live = [
    { address: "t16r", cwd: "/repo/chatwoot", foreground: { pid: 7 } },
    { address: "t17h", cwd: "/repo/cards/" },
  ];
  assert.equal(terminalOf({ pid: 7, cwd: "/repo/cards", where: { terminalId: "t17h" } }, live).address, "t16r");
  assert.equal(terminalOf({ pid: 1, cwd: "/repo/cards", where: { terminalId: "t16r" } }, live), null);
  assert.equal(terminalOf({ pid: 1, cwd: "/repo/cards", where: { terminalId: "t17h" } }, live).address, "t17h");
  assert.equal(terminalOf({ pid: 1, cwd: null, where: { terminalId: "t17h" } }, live), null);
  const stale = [{ address: "t192", cwd: "/orca/workspaces/api/abc-1408-ai", foreground: { pid: 4242, cwd: "/repo/cards" } }];
  assert.equal(terminalOf({ pid: 90652, cwd: "/repo/cards", where: { terminalId: "t192" } }, stale)?.address, "t192",
    "a terminal whose recorded folder is stale is still the session's when its foreground runs there");
  assert.equal(terminalOf({ pid: 90652, cwd: "/repo/other", where: { terminalId: "t192" } }, stale), null);
});

test("the rail reads the repo from where a terminal's program runs now, not where it opened", async () => {
  const { cwdOf } = await import("../mods/arcade-rail/main.js");
  // t192 on 2026-11-06: opened in api/abc-1408-ai, running Claude in herdr-arcade-cards.
  assert.equal(cwdOf({ cwd: "/Users/dev/orca/workspaces/api/abc-1408-ai", foreground: { cwd: "/Users/dev/git-repo/herdr-arcade-cards" } }),
    "/Users/dev/git-repo/herdr-arcade-cards");
  assert.equal(cwdOf({ cwd: "/a", foreground: { pid: 1 } }), "/a");
  assert.equal(cwdOf(null), null);
});

test("the rail heads every repository with its name and opens Slack into thread rows", async () => {
  const { railTree, RAIL_MAX, WIDE_W } = await import("../mods/arcade-rail/main.js");
  const layout = JSON.parse(readFileSync(new URL("../layouts/arcade.json", import.meta.url), "utf8"));
  assert.deepEqual(findNode(layout, "high-score-panel").size, { px: 220 }, "the board takes a 220 px side panel");
  assert.deepEqual(findNode(layout, "high-score").content.props, { variant: "board" });
  assert.equal(RAIL_MAX, 200, "the vertical rail keeps its 200 px ceiling for other layouts");
  assert.ok(WIDE_W > 76 && WIDE_W < RAIL_MAX);
  const api = { common: "/Users/dev/git-repo/api/.git", base: false };
  const space = (id, name, tabs = [{ id: `${id}-tab`, name: "1", active: false }]) => ({ id, name, tabs, active: id === "s2" });
  const rows = [
    { space: space("s1", "abc-1408-ai"), mine: [], repo: api },
    { space: space("s2", "api-cserver-ABC-1435"), mine: [], repo: api },
    { space: space("s3", "herdr-arcade-cards"), mine: [], repo: { common: "/Users/dev/git-repo/herdr-arcade-cards/.git", base: true } },
    { space: space("s4", "resumed", [{ id: "tb1", name: "mv-1791252016", active: true }, { id: "tb2", name: "mv-1793691052", active: false }]),
      mine: [{ address: "t90", cwd: "/Users/dev/.claude/state/bot-sessions/sessions/C000TEST-1791252016_169809" },
        { address: "t92", cwd: "/Users/dev/.claude/state/bot-sessions/sessions/C000TEST-1793691052_993259" }], repo: null },
  ];
  const list = [
    { address: "t18z", space: "s1", tab: "s1-tab", status: "done" },
    { address: "t18k", space: "s2", tab: "s2-tab", status: "blocked" }, { address: "t15y", space: "s2", tab: "s2-tab", status: "done" },
    { address: "t192", space: "s3", tab: "s3-tab", status: "working", tab_name: "1", program: { name: "claude" } },
    { address: "t90", space: "s4", tab: "tb1", status: "idle" }, { address: "t92", space: "s4", tab: "tb2", status: "idle" },
  ];
  const places = {
    t18z: { key: "ABC-1408", rest: "ai" }, t18k: { key: "ABC-1435", rest: "cserver" },
    t92: { key: null, rest: null, topic: "블루문 사장님 복지몰 오픈베타 오픈 알림.", slack: true },
  };
  const groups = railTree(rows, list, places);
  assert.deepEqual(groups.map((g) => g.head), ["api", "herdr-arcade-cards", "Slack"]);
  assert.deepEqual(groups[0].rows.map((r) => [r.name.key, r.name.rest, r.short]), [["ABC-1408", "ai", "1408"], ["ABC-1435", "cserver", "1435"]]);
  assert.deepEqual(groups[0].rows[1].crew.map((a) => a.address), ["t18k", "t15y"]);
  assert.deepEqual(groups[1].rows.map((r) => [r.name.key, r.name.rest]), [[null, "claude"]], "a space named like its repository shows its agent under the heading");
  assert.deepEqual(groups[2].rows.map((r) => [r.name.rest, r.tab.id, r.active]),
    [["mv-1791252016", "tb1", false], ["블루문 사장님 복지몰 오픈베타 오픈 알림.", "tb2", false]]);
});

test("a space the cards hold no session for is named from its own space name", async () => {
  const { spaceName } = await import("../mods/arcade-rail/main.js");
  assert.deepEqual(spaceName("api-cserver-ABC-1435"), { key: "ABC-1435", rest: "cserver" });
  assert.deepEqual(spaceName("abc-1312-mvp-ai-chatbot", ["ABC"]), { key: "ABC-1312", rest: "mvp-ai-chatbot" });
  assert.deepEqual(spaceName("api-ABC-1402-rd-20261105-101500-a1b2c3"), { key: "ABC-1402", rest: null });
  assert.deepEqual(spaceName("herdr-arcade-cards"), { key: null, rest: "herdr-arcade-cards" });
});

test("the narrow rail heads a group with the first word of its name", async () => {
  const { narrowHead } = await import("../mods/arcade-rail/main.js");
  assert.equal(narrowHead("herdr-arcade-cards"), "herdr");
  assert.equal(narrowHead("api"), "api");
  assert.equal(narrowHead("Slack"), "Slack");
});

test("a keyed session takes its rolling-delivery objective as the topic before any prompt", async () => {
  const { topicOf } = await import("../mods/arcade-cards/main.js");
  const identity = { firstPrompt: "/rolling-delivery https://example.atlassian.net/browse/ABC-1313 이거 진행할 건데 조사/분석/승인 후 /relay --auto 로 진행" };
  assert.equal(topicOf(identity, "ABC-1313", "고도화 에픽: 부재 판단"), "고도화 에픽: 부재 판단");
  assert.equal(topicOf(null, "ABC-1408", "AI 점원 뜻 검색과 추천 이유 설명"), "AI 점원 뜻 검색과 추천 이유 설명");
  assert.notEqual(topicOf(identity, "ABC-1313"), null, "without an objective the prompt still answers");
});

test("the selection follows the pane that takes focus, but not while the strip has the keyboard", () => {
  const terminals = [
    { address: "t1", state: "live", cwd: "/a", foreground: { pid: 101 } },
    { address: "t2", state: "live", cwd: "/b", foreground: { pid: 102 } },
  ];
  const state = { terminals, focused: { terminal: "t2" } };
  const v = view([session("a", "busy", 5, { pid: 101 }), session("b", "busy", 3, { pid: 102 })], state);
  const revealed = [];
  Object.assign(v, { scroll: { scroll_to_item: (index) => revealed.push(index) }, sel: "a" });
  v.followFocus(v.viewData());
  assert.equal(v.sel, "b");
  assert.equal(revealed.length, 1, "the followed card is scrolled into view");

  v.sel = "a";
  v.followFocus(v.viewData());
  assert.equal(v.sel, "a", "the same pane keeps focus, so a choice made on the strip stays");

  state.focused = { terminal: null };
  v.followFocus(v.viewData());
  assert.equal(v.sel, "a", "the strip's own mod pane has no terminal and changes nothing");
  state.focused = { terminal: "t2" };
  v.followFocus(v.viewData());
  assert.equal(v.sel, "b", "coming back from the strip to a pane follows it again");

  state.focused = null;
  v.sel = "a";
  v.followFocus(v.viewData());
  assert.equal(v.sel, "a");

  v.handle = { is_focused: () => true };
  state.focused = { terminal: "t1" };
  v.sel = "b";
  v.followFocus(v.viewData());
  assert.equal(v.sel, "b");
});

test("a focused pane whose card is not scanned yet is followed once the card appears", () => {
  const state = {
    terminals: [{ address: "t1", state: "live", cwd: "/a", foreground: { pid: 101 } }],
    focused: { terminal: "t3" },
  };
  const v = view([session("a", "busy", 5, { pid: 101 })], state);
  Object.assign(v, { scroll: { scroll_to_item() {} }, sel: "a" });
  v.followFocus(v.viewData());
  assert.equal(v.sel, "a");

  state.terminals.push({ address: "t3", state: "live", cwd: "/c", foreground: { pid: 103 } });
  v.sessions = [...v.sessions, session("c", "busy", 1, { pid: 103 })];
  v.followFocus(v.viewData());
  assert.equal(v.sel, "c");
});

test("focusing a Done pane marks its card viewed, and the card stays after focus moves on", () => {
  const state = {
    terminals: [
      { address: "t1", state: "live", cwd: "/a", foreground: { pid: 101 } },
      { address: "t2", state: "live", cwd: "/b", foreground: { pid: 102 } },
    ],
    focused: { terminal: "t1" },
  };
  const v = view([session("done", "idle", 5, { pid: 101 }), session("work", "busy", 3, { pid: 102 })], state);
  Object.assign(v, { scroll: { scroll_to_item() {} }, saveViewed() {} });
  v.followFocus(v.viewData());
  assert.equal(v.sel, "done");
  assert.deepEqual(v.viewed, [v.viewData().model.done[0].ackKey]);

  state.focused = { terminal: "t2" };
  v.followFocus(v.viewData());
  assert.equal(v.sel, "work");
  const done = v.viewData().model.done;
  assert.deepEqual(done.map((item) => item.sessionId), ["done"]);
  assert.equal(done[0].viewed, true);
});

test("opening a Done card marks it viewed and keeps its normal time", () => {
  const v = view([session("d", "idle", 5)]);
  Object.assign(v, { saveViewed() {}, flash() {} });
  const [item] = v.viewData(NOW).model.done;
  v.goTo(item, { notify() {}, timer: { after() {} } });
  assert.deepEqual(v.viewed, [item.ackKey]);
  const [after] = v.viewData(NOW).model.done;
  assert.equal(after.viewed, true);
  assert.equal(v.timeText(after, NOW), "5m ago");
});

test("shift-space walks every Done card from the right end, viewed or not, and cycles", () => {
  const v = view([session("w", "busy", 3), session("d-new", "idle", 5), session("d-mid", "idle", 7), session("d-old", "idle", 9)]);
  Object.assign(v, { scroll: { scroll_to_item() {} }, saveSeen() {}, saveViewed() {}, flash() {}, sel: "w" });
  const done = v.viewData().model.done;
  assert.deepEqual(done.map((item) => item.sessionId), ["d-new", "d-mid", "d-old"]);
  v.viewed = [done[2].ackKey];
  press(v, "space", false, true);
  assert.equal(v.sel, "d-old", "a viewed card is still in the cycle");
  assert.equal(v.showAllDone, true);
  assert.deepEqual(v.seen, [], "opening never marks a card seen");
  press(v, "space", false, true);
  assert.equal(v.sel, "d-mid");
  press(v, "space", false, true);
  press(v, "space", false, true);
  assert.equal(v.sel, "d-old", "past the left end it starts again at the right");

  v.sessions = v.sessions.filter((s) => s.sessionId !== "d-old");
  press(v, "space", false, true);
  assert.equal(v.sel, "d-mid", "when the last card visited has left, the walk restarts at the right end");

  v.sessions = v.sessions.filter((s) => !s.sessionId.startsWith("d-"));
  v.sel = "w";
  const flashed = [];
  v.flash = (_cx, message) => flashed.push(message);
  press(v, "space", false, true);
  assert.equal(flashed.at(-1), "No finished session — finish a turn first");
  assert.equal(v.sel, "w");
});

test("backspace hides a viewed Done card", () => {
  const v = view([session("d", "idle", 3)]);
  Object.assign(v, { saveSeen() {}, saveViewed() {}, flash() {}, sel: "d" });
  const [item] = v.viewData().model.done;
  v.viewed = [item.ackKey];
  press(v, "backspace");
  assert.deepEqual(v.seen, [item.ackKey]);
  assert.deepEqual(v.viewData().model.done, []);
  assert.deepEqual(v.viewed, [item.ackKey]);
});

test("pruneSeen drops seen and viewed keys of sessions that are gone", () => {
  const v = view([session("live", "idle", 3)]);
  Object.assign(v, { saveSeen() {}, saveViewed() {} });
  const [item] = v.viewData().model.done;
  v.seen = [item.ackKey, "gone+1"];
  v.viewed = [item.ackKey, "gone+2"];
  v.pruneSeen();
  assert.deepEqual(v.seen, [item.ackKey]);
  assert.deepEqual(v.viewed, [item.ackKey]);
});

test("a dismissed card hands the selection to the card that takes its place", () => {
  const v = view([session("a", "busy", 9), session("d1", "idle", 3), session("d2", "idle", 5), session("d3", "idle", 7)]);
  Object.assign(v, { scroll: { scroll_to_item() {} }, saveSeen() {}, saveViewed() {}, flash() {}, sel: "d2", selIndex: 2 });
  press(v, "backspace");
  assert.equal(v.selectedItem(v.viewData()).sessionId, "d3");
});

test("backspace on a card that cannot be dismissed hands nothing on later", () => {
  const v = view([session("w1", "busy", 9), session("w2", "busy", 5)]);
  Object.assign(v, { scroll: { scroll_to_item() {} }, saveSeen() {}, saveViewed() {}, flash() {}, sel: "w1", selIndex: 0 });
  press(v, "backspace");
  assert.ok(!v.handoff, "a Working card stays, so no handoff is armed");
  v.sessions = v.sessions.filter((s) => s.sessionId !== "w1");
  assert.equal(v.selectedItem(v.viewData()), null, "when its session then ends, the neighbour is not selected");
});

test("a card whose session ended on its own leaves nothing selected", () => {
  const v = view([session("a", "busy", 9), session("d1", "idle", 3), session("d2", "idle", 5), session("d3", "idle", 7)]);
  Object.assign(v, { sel: "d2", selIndex: 2 });
  v.sessions = v.sessions.filter((s) => s.sessionId !== "d2");
  assert.equal(v.selectedItem(v.viewData()), null, "the neighbour must not look like the session being closed");
  v.sel = "d3";
  assert.equal(v.selectedItem(v.viewData()).sessionId, "d3", "a card still on the strip stays selected");
  Object.assign(v, { sel: "gone", selIndex: 0, query: "d3" });
  assert.equal(v.selectedItem(v.viewData())?.sessionId, "d3", "while searching, the first match takes the selection so ↩ opens it");
  Object.assign(v, { sel: null, query: "" });
  assert.equal(v.selectedItem(v.viewData())?.sessionId, "a", "a strip where nothing was chosen yet starts at the first card");
});

test("a notch walks the strip one card at a time and stops with the last card on screen", () => {
  const widths = [245, 249, 219, 219, 219, 219, 249, 237];
  const viewportW = 1264;
  const notch = { delta: { x: 0, y: -10 }, delta_lines: { x: 0, y: -1 }, touch_phase: "moved" };
  const start = { acc: 0, index: 0, off: 0, at: 0, gesture: false, dir: 0 };
  const ends = widths.map((_, i) => widths.slice(0, i + 1).reduce((sum, width) => sum + width, 0));
  const maxOff = ends.at(-1) - viewportW;

  let next = wheelStepFor(start, notch, 1000, widths, viewportW);
  assert.deepEqual([next.target, next.state.off], [5, ends[5] - viewportW], "the first card past the right edge");
  next = wheelStepFor(next.state, notch, 1100, widths, viewportW);
  assert.deepEqual([next.target, next.state.off], [6, ends[6] - viewportW], "one card further");
  next = wheelStepFor(next.state, notch, 1200, widths, viewportW);
  assert.deepEqual([next.target, next.state.off], [7, maxOff], "the last card reaches the far end");
  next = wheelStepFor(next.state, notch, 1300, widths, viewportW);
  assert.deepEqual([next.target, next.state.off], [null, maxOff], "a turn with every card on screen asks nothing");
});

test("a native sideways swipe moves the estimate, and the next notch continues from there", () => {
  const widths = [245, 249, 219, 219, 219, 219, 249, 237];
  const viewportW = 1264;
  const start = { acc: 0, index: 0, off: 0, at: 0, gesture: false, dir: 0 };
  let next = wheelStepFor(start, { delta: { x: -300, y: 2 }, touch_phase: "moved" }, 1000, widths, viewportW);
  assert.deepEqual([next.target, next.state.off], [null, 300], "delta.x -300 moves the content 300 px to the right");
  assert.equal(next.state.index, 1, "card 1 is the one at the left edge now");

  next = wheelStepFor(next.state, { delta: { x: 0, y: -10 }, delta_lines: { x: 0, y: -1 }, touch_phase: "moved" }, 1100, widths, viewportW);
  assert.deepEqual([next.target, next.state.off], [6, 1619 - viewportW],
    "the first card whose end passes the right edge of [300, 1564]");
  next = wheelStepFor(next.state, { delta: { x: 0, y: 10 }, delta_lines: { x: 0, y: 1 }, touch_phase: "moved" }, 1200, widths, viewportW);
  assert.deepEqual([next.target, next.state.off], [1, 245], "the partly hidden card at the left edge comes back first");
});

test("a left notch at the start does nothing, and a narrower strip clamps the estimate", () => {
  const widths = [245, 249, 219, 219, 219, 219, 249, 237];
  const viewportW = 1264;
  const up = { delta: { x: 0, y: 10 }, delta_lines: { x: 0, y: 1 }, touch_phase: "moved" };
  let next = wheelStepFor({ acc: 0, index: 0, off: 0, at: 0, gesture: false, dir: 0 }, up, 1000, widths, viewportW);
  assert.deepEqual([next.target, next.state.off], [null, 0], "there is nothing to the left of the first card");

  const short = [200, 200, 200];
  assert.equal(maxOffset(short, 100), 500);
  next = wheelStepFor({ acc: 0, index: 0, off: maxOffset(widths, viewportW), at: 0, gesture: false, dir: 0 },
    { delta: { x: 0, y: 0 }, touch_phase: "ended" }, 1000, short, 100);
  assert.equal(next.state.off, 500, "the estimate is clamped to the shorter strip's new maximum");
});

test("a notch, a five-line event, the first 5 px of a trackpad move and a 300 px event each move one card", () => {
  const widths = [300, 300, 300, 300, 300, 300];
  const start = () => ({ acc: 0, index: 0, off: 0, at: 0, gesture: false, dir: 0 });
  const one = (event) => {
    const next = wheelStepFor(start(), event, 1000, widths, 400);
    return [next.target, next.state.off];
  };
  assert.deepEqual(one({ delta: { x: 0, y: -10 }, delta_lines: { x: 0, y: -1 }, touch_phase: "moved" }), [1, 200]);
  assert.deepEqual(one({ delta: { x: 0, y: -50 }, delta_lines: { x: 0, y: -5 }, touch_phase: "moved" }), [1, 200],
    "five lines in one event still move one card");
  assert.deepEqual(one({ delta: { x: 0, y: -5 }, touch_phase: "started" }), [1, 200],
    "a 5 px first movement is not swallowed");
  assert.deepEqual(one({ delta: { x: 0, y: -300 }, touch_phase: "started" }), [1, 200],
    "an event worth five cards still moves one");
});

test("the first trackpad movement moves one card, then pixels gather at 60 px per card", () => {
  const widths = [300, 300, 300, 300, 300, 300];
  const px = (dy, phase = "moved") => ({ delta: { x: 0, y: dy }, touch_phase: phase });
  let next = wheelStepFor({ acc: 0, index: 0, off: 0, at: 0, gesture: false, dir: 0 }, px(-5, "started"), 1000, widths, 400);
  assert.deepEqual([next.target, next.state.off], [1, 200], "a 5 px first movement is not swallowed");
  let state = next.state;
  next = wheelStepFor(state, px(-30), 1030, widths, 400);
  assert.deepEqual([next.target, next.state.off], [null, 200], "30 px is not yet a card");
  state = next.state;
  next = wheelStepFor(state, px(-30), 1060, widths, 400);
  assert.deepEqual([next.target, next.state.off], [2, 500], "the next 30 px completes one card");
  state = next.state;
  next = wheelStepFor(state, px(-5), 1300, widths, 400);
  assert.deepEqual([next.target, next.state.off], [3, 800], "after a 200 ms pause the first movement moves at once");
});

test("a reversal moves back at once with no dead zone, and the end of a touch drops the accumulator", () => {
  const widths = [300, 300, 300, 300, 300, 300];
  const px = (dy, phase) => ({ delta: { x: 0, y: dy }, touch_phase: phase });
  let next = wheelStepFor({ acc: 0, index: 0, off: 0, at: 0, gesture: false, dir: 0 }, px(-5, "started"), 1000, widths, 400);
  next = wheelStepFor(next.state, px(-3, "moved"), 1010, widths, 400);
  assert.deepEqual([next.target, next.state.off], [null, 200]);
  next = wheelStepFor(next.state, px(4, "moved"), 1020, widths, 400);
  assert.deepEqual([next.target, next.state.off], [0, 0], "a small reverse movement moves back immediately");
  next = wheelStepFor(next.state, px(30, "moved"), 1030, widths, 400);
  assert.deepEqual([next.target, next.state.off], [null, 0], "30 px toward the reverse is not yet a card");
  next = wheelStepFor(next.state, px(0, "ended"), 1040, widths, 400);
  assert.equal(next.state.acc, 0, "the end of a touch drops the leftover travel");
  assert.equal(next.state.off, 0);
  assert.equal(next.target, null);
});

test("without a viewport a step falls back to one card at a time", () => {
  const widths = [250, 250, 250, 250, 250, 250, 250];
  const notch = { delta: { x: 0, y: -10 }, delta_lines: { x: 0, y: -1 }, touch_phase: "moved" };
  const forward = wheelStepFor({ acc: 0, index: 0, at: 0, gesture: false, dir: 0 }, notch, 1000, widths, null);
  assert.deepEqual([forward.target, forward.state.index], [1, 1]);
  const back = wheelStepFor({ acc: 0, index: 2, at: 0, gesture: false, dir: 0 },
    { delta: { x: 0, y: 10 }, delta_lines: { x: 0, y: 1 } }, 1000, widths, null);
  assert.deepEqual([back.target, back.state.index], [1, 1]);
  const end = wheelStepFor({ acc: 0, index: 6, at: 0, gesture: false, dir: 0 }, notch, 1000, widths, null);
  assert.deepEqual([end.target, end.state.index], [null, 6], "the last card is the end");
});

test("centring a card puts its middle in the viewport's middle, clamped to the strip's ends", () => {
  const widths = [250, 250, 250, 250, 250, 250, 250];
  assert.equal(centeredOffset(3, widths, 1264), 243, "card 3 starts at 750, so the left edge sits 243 px in");
  assert.equal(centeredOffset(6, widths, 1264), 486, "the strip cannot centre its last card past its end");
  assert.equal(centeredOffset(1, widths, null), null, "without a viewport there is no offset to compute");
  assert.equal(clampOffset(243, widths, 1264), 243);
  assert.equal(leftIndexAt(243, widths), 0, "the first card still reaches into the viewport");
  assert.equal(rightIndexAt(243, widths, 1264), 5, "and the sixth is the last one fully inside it");
});

test("a wheel turn over the strip tracks a native swipe and redraws only when it scrolls", () => {
  const v = view([]);
  v.wheel = { acc: 0, index: 0, off: 0, at: 0, gesture: false, dir: 0 };
  const calls = [];
  let notified = 0;
  v.scroll = { scroll_to_item: (index, strategy) => calls.push([index, strategy]) };
  const cx = { notify() { notified += 1; } };
  const widths = [300, 300, 300, 300, 300, 300];
  const bounds = { width: 400 };

  v.wheelRow(widths, { delta: { x: -90, y: 10 }, delta_lines: { x: -1, y: 0 }, bounds }, cx);
  assert.deepEqual(calls, [], "a mostly horizontal delta is left to the native scroll");
  assert.equal(v.wheel.off, 90, "the estimate follows the swipe");
  assert.equal(v.wheel.viewportW, 400);
  assert.equal(notified, 0);

  v.wheelRow(widths, { delta: { x: 0, y: -WHEEL_STEP }, delta_lines: { x: 0, y: -1 }, bounds }, cx);
  assert.deepEqual(calls.at(-1), [1, "top"], "downward moves right by one card, by item");
  assert.equal(v.wheel.off, 200);
  v.wheelRow(widths, { delta: { x: 0, y: -WHEEL_STEP }, delta_lines: { x: 0, y: -1 }, bounds }, cx);
  assert.deepEqual(calls.at(-1), [2, "top"], "the next card scrolls to the right edge");
  assert.equal(v.wheel.off, 500);
  assert.equal(notified, 2, "only a turn that scrolls the strip redraws it");
});

test("reveal moves the wheel's pixel offset with the centred card", () => {
  const v = view([session("a", "busy", 5), session("b", "busy", 3)]);
  v.wheel = { acc: 0, index: 0, off: 0, viewportW: 500 };
  const calls = [];
  v.scroll = { scroll_to_item: (index, strategy) => calls.push([index, strategy]) };
  const data = v.viewData(NOW);
  const index = v.buildStrip(data).findIndex((entry) => entry.kind === "card" && entry.item.sessionId === "b");
  assert.equal(index, 1);
  v.reveal("b", data);
  assert.deepEqual(calls.at(-1), [index, "center"], "the strip scrolls the card to the middle");
  assert.equal(v.wheel.off, 144, "the estimate lands where the last known viewport puts the card's middle");

  const unknown = view([session("a", "busy", 5), session("b", "busy", 3)]);
  unknown.wheel = { acc: 0, index: 0, off: 7 };
  unknown.scroll = { scroll_to_item() {} };
  unknown.reveal("b", unknown.viewData(NOW));
  assert.equal(unknown.wheel.off, 7, "without a viewport the estimate is left alone");
  assert.equal(unknown.wheel.index, 1);
});

test("the strip draws the amber focus ring only while it has the keyboard", () => {
  for (const focused of [false, true]) {
    const v = view([session("w", "busy", 5)]);
    Object.assign(v, { handle: { focus() {}, is_focused: () => focused }, scroll: {} });
    let rings = 0;
    const ring = v.focusRing.bind(v);
    v.focusRing = () => { rings += 1; return ring(); };
    assert.doesNotThrow(() => v.render({ notify() {}, timer: { after() {}, every() {} } }));
    assert.equal(rings, focused ? 1 : 0, focused ? "focused" : "not focused");
  }
});

test("watchFocus redraws the strip when the keyboard leaves it", () => {
  let stripFocused = true;
  const v = view([session("w", "busy", 5)]);
  Object.assign(v, { handle: { focus() {}, is_focused: () => stripFocused }, scroll: {} });
  assert.doesNotThrow(() => v.render({ notify() {}, timer: { after() {}, every() {} } }));
  stripFocused = false;
  let notified = 0;
  v.watchFocus({ notify() { notified += 1; } });
  assert.equal(notified, 1, "the ring that was drawn is no longer the strip's");
});

test("watchFocus keeps quiet when the keyboard and the focused terminal have not moved", () => {
  const v = view([session("w", "busy", 5)]);
  Object.assign(v, { handle: { focus() {}, is_focused: () => true }, scroll: {} });
  assert.doesNotThrow(() => v.render({ notify() {}, timer: { after() {}, every() {} } }));
  let notified = 0;
  v.watchFocus({ notify() { notified += 1; } });
  assert.equal(notified, 0);
});

test("watchFocus redraws when the focused terminal changed", () => {
  const v = view([session("w", "busy", 5)], { focused: { terminal: "t1" } });
  Object.assign(v, { handle: { focus() {}, is_focused: () => false }, scroll: {} });
  assert.doesNotThrow(() => v.render({ notify() {}, timer: { after() {}, every() {} } }));
  globalThis.herdrState = { ...globalThis.herdrState, focused: { terminal: "t2" } };
  let notified = 0;
  v.watchFocus({ notify() { notified += 1; } });
  assert.equal(notified, 1);
});

test("watchFocus compares the strip's own ring and the focused terminal, and no legend button's", () => {
  const v = view([session("w", "busy", 5)]);
  Object.assign(v, {
    handle: { is_focused: () => true },
    retryHandle: { is_focused: () => true },
    undoHandle: { is_focused: () => false },
    scroll: {},
  });
  assert.doesNotThrow(() => v.render({ notify() {}, timer: { after() {}, every() {} } }));
  let notified = 0;
  v.watchFocus({ notify() { notified += 1; } });
  assert.equal(notified, 0, "the redraw matches the watch");
  v.retryHandle = { is_focused: () => false };
  v.watchFocus({ notify() { notified += 1; } });
  assert.equal(notified, 0, "a handle the strip no longer tracks is not a focus change");
  v.handle = { is_focused: () => false };
  v.watchFocus({ notify() { notified += 1; } });
  assert.equal(notified, 1, "the strip's own ring going away is a focus change");
});

test("the rail's ↑↓ move the row highlight and wrap, and ↩ or Space pick it", () => {
  assert.deepEqual(railKey("down", 1, 3), { at: 2, select: false });
  assert.deepEqual(railKey("down", 2, 3), { at: 0, select: false }, "↓ wraps to the first row");
  assert.deepEqual(railKey("up", 0, 3), { at: 2, select: false }, "↑ wraps to the last row");
  assert.deepEqual(railKey("enter", 1, 3), { at: 1, select: true });
  assert.deepEqual(railKey("space", 1, 3), { at: 1, select: true });
  assert.equal(railKey("down", 0, 0), null, "an empty rail takes no key");
  assert.equal(railKey("left", 0, 3), null, "a key the rail does not use is left to the host");
});

test("the tab bar's ←→ move the tab highlight and wrap, and ↩ or Space select", () => {
  assert.deepEqual(tabsKey("right", 0, 2), { at: 1, select: false });
  assert.deepEqual(tabsKey("right", 1, 2), { at: 0, select: false }, "→ wraps to the first tab");
  assert.deepEqual(tabsKey("left", 0, 2), { at: 1, select: false }, "← wraps to the last tab");
  assert.deepEqual(tabsKey("enter", 1, 2), { at: 1, select: true });
  assert.deepEqual(tabsKey("space", 0, 2), { at: 0, select: true });
  assert.equal(tabsKey("right", 0, 0), null);
  assert.equal(tabsKey("down", 0, 2), null);
});

test("the legend bar is drawn only for the ? toggle", () => {
  const cases = [[null, null, false, 0], ["boom", null, false, 0], [null, "done", false, 0], [null, null, true, 1], ["boom", null, true, 1]];
  for (const [err, notice, showKeys, expected] of cases) {
    const v = view([session("w", "busy", 5)]);
    Object.assign(v, { geo: geometry(1), k: 1, err, notice, showKeys,
      handle: { focus() {}, is_focused: () => false }, scroll: {} });
    let calls = 0;
    v.legend = () => { calls += 1; return null; };
    assert.doesNotThrow(() => v.render({ notify() {}, timer: { after() {}, every() {} } }));
    assert.equal(calls, expected, `err=${err} notice=${notice} showKeys=${showKeys}`);
  }
});

test("the card's head and the props role's head are separate methods", () => {
  const v = view([]);
  assert.equal(typeof v.cardHead, "function");
  assert.equal(typeof v.head, "function");
  assert.notEqual(v.cardHead, v.head, "one class method of the name would overwrite the other");
  assert.equal(v.cardHead.length, 3, "the card head takes the item, its tone and the player number");
  assert.equal(v.head.length, 0, "the role's head takes no item, so the card cannot reach it");
});

test("the strip publishes its notice for the head row's pill, and only when it changes", () => {
  const notices = () => globalThis.herdrShared.filter(([name]) => name === NOTICE_KEY).map(([, value]) => value);
  const draw = (v) => v.render({ notify() {}, timer: { after() {}, every() {} } });
  globalThis.herdrShared = [];
  try {
    const v = view([session("w", "busy", 5)]);
    Object.assign(v, {
      geo: geometry(1), k: 1, err: null, notice: "x", noticeAction: { label: "Undo", run() {} },
      handle: { focus() {}, is_focused: () => false }, scroll: {},
    });
    draw(v);
    assert.deepEqual(notices().at(-1), { tone: "note", text: "x", action: "Undo" });
    const sent = notices().length;
    draw(v);
    assert.equal(notices().length, sent, "an unchanged notice is not republished");
    v.err = "boom";
    draw(v);
    assert.deepEqual(notices().at(-1), { tone: "err", text: "boom", action: "Retry" });
    Object.assign(v, { err: null, notice: null, noticeAction: null });
    draw(v);
    assert.equal(notices().at(-1), null, "clearing both publishes null");
  } finally {
    globalThis.herdrShared = undefined;
  }
});

test("the head row's pill runs its Retry or Undo through the strip's watch", () => {
  globalThis.herdrShared = [];
  try {
    const v = view([session("w", "busy", 5)]);
    let ran = 0;
    let polls = 0;
    Object.assign(v, {
      notice: "Marked done", noticeAction: { label: "Undo", run: () => { ran += 1; } }, err: "boom",
      lastNoticeAct: null, poll: () => { polls += 1; },
    });
    setShared(NOTICE_ACT_KEY, { token: "t1", act: "undo" });
    v.watchFocus({ notify() {} });
    assert.equal(ran, 1, "the undo action ran");
    assert.equal(v.notice, null);
    assert.equal(v.noticeAction, null);
    v.watchFocus({ notify() {} });
    assert.equal(ran, 1, "the same token does not run twice");
    setShared(NOTICE_ACT_KEY, { token: "t2", act: "retry" });
    v.watchFocus({ notify() {} });
    assert.equal(v.err, null);
    assert.equal(polls, 1, "Retry polls again");
  } finally {
    globalThis.herdrState = undefined;
    globalThis.herdrShared = undefined;
  }
});

test("⌘Z undoes the last acknowledge while its notice is up, and is left to the host otherwise", () => {
  const v = view([session("w", "busy", 5)]);
  let ran = 0;
  Object.assign(v, { scroll: { scroll_to_item() {} }, notice: "Marked done", noticeAction: { label: "Undo", run: () => { ran += 1; } } });
  const calls = { stop: 0 };
  const cx = { stop_propagation() { calls.stop += 1; }, notify() {}, spawn() {} };
  const pressZ = () => v.key({ key: "z", modifiers: { alt: false, shift: false, platform: true, control: false }, key_char: null, is_held: false }, cx);
  pressZ();
  assert.equal(ran, 1);
  assert.equal(v.notice, null);
  assert.equal(v.noticeAction, null);
  assert.equal(calls.stop, 1, "the key is taken");
  pressZ();
  assert.equal(ran, 1, "with no notice there is nothing to undo");
  assert.equal(calls.stop, 1, "the host keeps ⌘Z");
});

test("the tabs mod draws the cards' notice pill and asks back over the shared channel", () => {
  const tabs = readFileSync(new URL("../mods/arcade-tabs/main.js", import.meta.url), "utf8");
  assert.ok(tabs.includes('shared("arcade-cards.notice")'));
  assert.ok(tabs.includes('setShared("arcade-cards.notice-act"'));
});

test("? (shift+/) toggles the key legend, and types into an open search instead", () => {
  const v = view([session("w", "busy", 5)]);
  Object.assign(v, { scroll: { scroll_to_item() {} }, showKeys: false, query: "" });
  press(v, "?");
  assert.equal(v.showKeys, true);
  press(v, "/", false, true);
  assert.equal(v.showKeys, false);

  Object.assign(v, { showKeys: false, query: "ami" });
  press(v, "?", false, false, false, "?");
  assert.equal(v.query, "ami?");
  assert.equal(v.showKeys, false, "? is part of the query, not the legend toggle");
  press(v, "/", false, true, false, "?");
  assert.equal(v.query, "ami??");
  assert.equal(v.showKeys, false);
});

test("a selected card takes the amber border and title only while the strip has the keyboard", () => {
  assert.deepEqual(selectedTone(true), { border: "#f9d544", title: "#f9d544" });
  assert.deepEqual(selectedTone(false), { border: "#3adaf2", title: "#f1f0ff" });
});

test("the tools role shows the branch when the pane has one and hides it when it has none", () => {
  const pages = [{ url: "a", openable: true }];
  assert.equal(toolsParts({ pages, unreadable: 2 }, "main").branch, true);
  assert.equal(toolsParts({ pages, unreadable: 2 }, "").branch, false);
  assert.equal(toolsParts({}, undefined).branch, false);
  assert.equal(toolsParts({ pages, unreadable: 2 }, "main").pageCount, 3);
});

test("the to-read chip publishes why, and the strip flashes it once, when no page can open", () => {
  const v = Object.create(ArcadeCards.prototype);
  globalThis.herdrState = { shared: {} };
  globalThis.herdrShared = [];
  try {
    v.openChipPage([], {});
    const first = shared("arcade-cards.flash");
    assert.equal(first.message, NO_PAGE_FLASH);
    assert.equal(NO_PAGE_FLASH, "No page can open yet — try again after the scan");
    assert.equal(/\.$/.test(first.message), false, "the notice carries no full stop");

    v.openChipPage([{ url: "/tmp/a.html", openable: false }], {});
    assert.equal(shared("arcade-cards.flash").message, NO_PAGE_FLASH, "an unopenable page says the same");

    const strip = view([session("w", "busy", 5)]);
    Object.assign(strip, { handle: { focus() {}, is_focused: () => false }, scroll: {}, drawnFocus: "false|" });
    v.openChipPage([], {});
    const flashed = [];
    strip.flash = (_cx, message) => flashed.push(message);
    strip.watchFocus({ notify() {} });
    strip.watchFocus({ notify() {} });
    assert.deepEqual(flashed, [NO_PAGE_FLASH], "the strip shows the tools copy's notice once");
  } finally {
    globalThis.herdrState = undefined;
    globalThis.herdrShared = undefined;
  }
});

test("the lane column shows the group's dot colour, its count and a tooltip naming the group", () => {
  const v = view([session("a", "waiting", 3), session("w", "busy", 5), session("d", "idle", 6)]);
  assert.deepEqual(v.viewData(NOW).groups.map(laneParts), [
    { color: "#ff41b4", title: "CONTINUE?", sub: "Your turn 1", count: "1", tip: "CONTINUE?" },
    { color: "#3adaf2", title: "NOW PLAYING", sub: "In play 1", count: "1", tip: "NOW PLAYING" },
    { color: "#f9d544", title: "CLEAR!", sub: "Cleared 1", count: "1", tip: "CLEAR!" },
  ]);
});

test("the rail frames the shown space in its line colour at both widths, never amber", async () => {
  const { shownFrame } = await import("../mods/arcade-rail/main.js");
  assert.deepEqual(shownFrame(true), { bg: "#31265a", border: 1, color: "#483e74" });
  assert.deepEqual(shownFrame(false), { bg: null, border: 2, color: "#483e74" });
});

test("geometry(1) is the strip's original numbers, and geometry(k) scales every length and text size", () => {
  const one = geometry(1);
  assert.deepEqual(
    [one.CARD_W, one.CARD_H, one.STEPS_W, one.MORE_W, one.HEAD_H, one.FACE, one.FACE_PAD, one.MSG_LINE],
    [240, 252, 240, 120, 50, 40, 8, 17]);
  assert.deepEqual(
    [one.PAD_X, one.GROUP_GAP, one.CARD_GAP, one.LANE_W, one.STRIP_TOP_PAD, one.STRIP_BOTTOM_PAD, one.LEGEND_H],
    [20, 24, 12, 112, 12, 12, 28]);
  assert.deepEqual([one.STRIP_H, one.STRIP_BLOCK_H, one.BODY_H, one.TEXT_W], [264, 276, 196, 216]);
  assert.equal(one.MSG_W, 202, "the message wraps inside the panel's padding and mood edge");
  assert.equal(one.TAG_GAP, 6, "the key and its sub share the card head's gap");
  assert.equal(geometry(BLOCK_H_MIN / BASE_BLOCK_H).TEXT_W, 187.5);
  assert.equal(one.STRIP_H, STRIP_H);
  assert.equal(one.STRIP_BLOCK_H, STRIP_BLOCK_H);
  assert.equal(one.TEXT_W, TEXT_W);
  assert.equal(one.STRIP_BLOCK_H, 276);
  assert.equal(BASE_BLOCK_H, 276, "the block's default height is the beach's reference height");
  assert.equal(one.STRIP_BLOCK_H, BASE_BLOCK_H);
  assert.deepEqual(
    [one.TEXT.base, one.TEXT.persona, one.TEXT.key, one.TEXT.tagSub, one.TEXT.topic, one.TEXT.message, one.TEXT.chip, one.TEXT.keycap],
    [13, 11, 13, 10, 12, 12, 10, 10]);

  const two = geometry(2);
  for (const key of ["CARD_W", "CARD_H", "STEPS_W", "MORE_W", "HEAD_H", "FACE", "FACE_PAD", "MSG_LINE", "PAD_X", "GROUP_GAP", "CARD_GAP",
    "LANE_W", "STRIP_TOP_PAD", "STRIP_BOTTOM_PAD", "LEGEND_H", "STRIP_H", "BODY_H"]) {
    assert.equal(two[key], one[key] * 2, key);
  }
  assert.equal(two.TEXT_W, one.TEXT_W * 2 + 4, "the card border stays 4 px while the body scales");
  for (const [key, value] of Object.entries(one.TEXT)) assert.equal(two.TEXT[key], value * 2, `TEXT.${key}`);
  assert.equal(two.STRIP_BLOCK_H, BASE_BLOCK_H * 2, "the whole block scales with k");
  assert.equal(two.STEP_ROWS, one.STEP_ROWS, "a fixed card holds the same number of step rows");
});

test("the block's measured height clamps to 240..420 before it becomes the strip's scale", () => {
  assert.equal(cardsScale(276), 1);
  assert.equal(cardsScale(200), BLOCK_H_MIN / BASE_BLOCK_H);
  assert.equal(cardsScale(500), BLOCK_H_MAX / BASE_BLOCK_H);
  assert.equal(cardsScale(400), 400 / BASE_BLOCK_H);
  assert.equal(BLOCK_H_MIN, 240);
  assert.equal(BLOCK_H_MAX, 420);
});

test("sizeChanged clamps the block height into the strip's scale and redraws only when it moves", () => {
  const v = new ArcadeCards();
  Object.assign(v, { blockHeight: null, k: 1, geo: geometry(1) });
  let notified = 0;
  const cx = { notify() { notified += 1; } };

  v.sizeChanged({ width: 800, height: 100 }, cx);
  assert.equal(v.k, BLOCK_H_MIN / BASE_BLOCK_H, "a short block clamps to the floor");
  assert.deepEqual(v.geo, geometry(v.k));
  assert.equal(notified, 1);

  v.sizeChanged({ width: 800, height: 999 }, cx);
  assert.equal(v.k, BLOCK_H_MAX / BASE_BLOCK_H, "a tall block clamps to the ceiling");
  assert.deepEqual(v.geo, geometry(v.k));
  assert.equal(notified, 2);

  v.sizeChanged({ width: 800, height: 0 }, cx);
  v.sizeChanged({ width: 800, height: -10 }, cx);
  assert.equal(v.k, BLOCK_H_MAX / BASE_BLOCK_H, "a non-positive height is ignored");
  assert.equal(notified, 2);

  v.sizeChanged({ width: 800, height: 999 }, cx);
  assert.equal(notified, 2, "the same height again does not redraw");

  v.sizeChanged({ width: 1200, height: 420 }, cx);
  assert.equal(notified, 2, "a width-only change does not redraw");
});

test("the cabinet column lets only the marquee's lower boundary drag, between 240 and 480", () => {
  const layout = JSON.parse(readFileSync(new URL("../layouts/arcade.json", import.meta.url), "utf8"));
  assert.equal(layout.type, "column");
  assert.equal(layout.resizable, false, "the cabinet's own edges stay fixed");
  const top = findNode(layout, "cab-top");
  assert.equal(top.resizable, true, "the column holding the marquee lets its lower boundary drag");
  const marquee = findNode(layout, "marquee");
  assert.deepEqual([marquee.size, marquee.min, marquee.max], [{ px: 340 }, 240, 480],
    "the marquee opens at 340 px and is clamped between 240 and 480");
  assert.equal(findNode(layout, "mid").resizable, false, "the CRT row holds its own boundary");
  assert.equal(findNode(layout, "high-score-panel").resizable, false, "the HIGH SCORE column holds its boundary");
  assert.deepEqual(findNode(layout, "panel").size, { px: 120 }, "the control panel is a fixed 120 px strip");
});

test("the measured height is divided by the app's zoom before it becomes the strip's scale", () => {
  const v = new ArcadeCards();
  Object.assign(v, { blockHeight: null, k: 1, geo: geometry(1) });
  const cx = { notify() {} };
  try {
    // A 420 px block at zoom 1.25 measures 525 on screen; it is still the 420 px block.
    globalThis.herdrState = { settings: { zoom: 1.25 } };
    v.sizeChanged({ width: 800, height: 525 }, cx);
    assert.equal(v.k, 420 / BASE_BLOCK_H);
    // A 400 px block at zoom 0.6 measures 240 on screen and must not clamp to the floor.
    globalThis.herdrState = { settings: { zoom: 0.6 } };
    v.sizeChanged({ width: 800, height: 240 }, cx);
    assert.equal(v.k, 400 / BASE_BLOCK_H);
  } finally {
    globalThis.herdrState = undefined;
  }
  assert.equal(zoomOf({}), 1, "no zoom reads as 1");
  assert.equal(zoomOf({ zoom: 0 }), 1);
});

test("cmd +/- step the terminals' text size in settings.json and cmd-0 resets it with the zoom", () => {
  const person = { zoom: 0.9, sounds: { enabled: true } };
  assert.deepEqual(nextSettings(person, "font_in"), { ...person, font_size: TERM_FONT + 1 });
  assert.deepEqual(nextSettings(person, "font_out", 15), { ...person, font_size: 14 }, "steps from the size shown");
  assert.equal(nextSettings({ font_size: 32 }, "font_in").font_size, 32, "clamps to 32");
  assert.equal(nextSettings({ font_size: 8 }, "font_out").font_size, 8, "clamps to 8");
  assert.equal(nextSettings(person, "font_in").zoom, 0.9, "the zoom is left alone");
  assert.deepEqual(nextSettings({ ...person, font_size: 18 }, "font_reset"), { zoom: 1, sounds: { enabled: true } });
  assert.equal(nextSettings(person, "toggle"), null);
  assert.deepEqual(person, { zoom: 0.9, sounds: { enabled: true } }, "the input is not changed");
});

test("the cmd +/-/0 commands write settings.json", async () => {
  const v = new ArcadeCards();
  globalThis.herdrFiles = { "/tmp/settings.json": JSON.stringify({ zoom: 1 }) };
  try {
    await v.changeTermFont("font_in");
    assert.deepEqual(JSON.parse(globalThis.herdrFiles["/tmp/settings.json"]), { zoom: 1, font_size: TERM_FONT + 1 });
  } finally {
    globalThis.herdrFiles = undefined;
  }
});

test("a visit appends the terminal and ignores a null or repeated one", () => {
  const empty = { list: [], at: -1 };
  const once = visitHistory(empty, "t1");
  assert.deepEqual(once, { list: ["t1"], at: 0 });
  assert.deepEqual(empty, { list: [], at: -1 }, "the input is not changed");
  assert.equal(visitHistory(once, null), once, "no terminal is no visit");
  assert.equal(visitHistory(once, "t1"), once, "the terminal already at the cursor is no visit");
  assert.deepEqual(visitHistory(visitHistory(once, "t2"), "t3"), { list: ["t1", "t2", "t3"], at: 2 });
});

test("a visit after going back drops the forward entries", () => {
  const back = { list: ["t1", "t2", "t3"], at: 0 };
  const next = visitHistory(back, "t9");
  assert.deepEqual(next, { list: ["t1", "t9"], at: 1 });
  assert.deepEqual(back, { list: ["t1", "t2", "t3"], at: 0 }, "the input is not changed");
});

test("the history keeps the newest HISTORY_MAX visits and leaves the cursor on the last", () => {
  let history = { list: [], at: -1 };
  for (let i = 0; i < HISTORY_MAX + 5; i++) history = visitHistory(history, `t${i}`);
  assert.equal(history.list.length, HISTORY_MAX);
  assert.equal(history.list[0], "t5", "the oldest visits are dropped");
  assert.equal(history.list[history.list.length - 1], `t${HISTORY_MAX + 4}`);
  assert.equal(history.at, HISTORY_MAX - 1);
});

test("back and forward step one live terminal at a time", () => {
  const history = { list: ["t1", "t2", "t3"], at: 2 };
  const alive = new Set(["t1", "t2", "t3"]);
  const back = stepHistory(history, -1, alive);
  assert.deepEqual(back, { history: { list: ["t1", "t2", "t3"], at: 1 }, target: "t2" });
  assert.deepEqual(history, { list: ["t1", "t2", "t3"], at: 2 }, "the input is not changed");
  assert.deepEqual(stepHistory(back.history, -1, alive).target, "t1");
  assert.deepEqual(stepHistory(back.history, 1, alive).target, "t3");
});

test("a step skips terminals that are gone and ones equal to the cursor", () => {
  const history = { list: ["t1", "t2", "t3", "t4"], at: 3 };
  const back = stepHistory(history, -1, new Set(["t1", "t4"]));
  assert.deepEqual(back, { history: { list: history.list, at: 0 }, target: "t1" });
  const repeat = { list: ["t1", "t2", "t2", "t3"], at: 3 };
  assert.equal(stepHistory(repeat, -1, new Set(["t1", "t2", "t3"])).target, "t2");
  assert.equal(stepHistory(repeat, -1, new Set(["t1", "t2", "t3"])).history.at, 2);
});

test("a step past either end returns no target and the same history object", () => {
  const atStart = { list: ["t1", "t2"], at: 0 };
  const start = stepHistory(atStart, -1, new Set(["t1", "t2"]));
  assert.equal(start.target, null);
  assert.equal(start.history, atStart);
  const atEnd = { list: ["t1", "t2"], at: 1 };
  const end = stepHistory(atEnd, 1, new Set(["t1", "t2"]));
  assert.equal(end.target, null);
  assert.equal(end.history, atEnd);
  const empty = { list: [], at: -1 };
  assert.equal(stepHistory(empty, 1, new Set()).history, empty);
});

test("navigate focuses the previous live terminal and leaves the rest to trackVisit", () => {
  const v = new ArcadeCards();
  Object.assign(v, { history: { list: ["t0", "t1", "t2"], at: 2 }, navTarget: null });
  globalThis.herdrState = { terminals: [{ address: "t0", state: "exited" }, { address: "t1", state: "live" }, { address: "t2", state: "live" }] };
  globalThis.herdrRuns = [];
  try {
    v.navigate(-1);
    assert.deepEqual(globalThis.herdrRuns, [["pane.focus", { terminal: "t1" }]]);
    assert.deepEqual(v.history, { list: ["t0", "t1", "t2"], at: 1 });
    assert.equal(v.navTarget, "t1", "the arrival is claimed, so it is not recorded as a new visit");
    v.navigate(-1);
    assert.deepEqual(globalThis.herdrRuns, [["pane.focus", { terminal: "t1" }]], "an exited terminal is not a place to go back to");
  } finally {
    globalThis.herdrRuns = undefined;
    globalThis.herdrState = undefined;
  }
});

test("trackVisit ignores the terminal being left until the back/forward target shows", () => {
  const v = new ArcadeCards();
  Object.assign(v, { history: { list: ["t1", "t2"], at: 0 }, navTarget: "t1", navUntil: 1000 });
  try {
    globalThis.herdrState = { focused: { terminal: "t2" } };
    v.trackVisit(500);
    assert.deepEqual(v.history, { list: ["t1", "t2"], at: 0 }, "the forward entry survives a late pane.focus");
    globalThis.herdrState = { focused: { terminal: "t1" } };
    v.trackVisit(600);
    assert.equal(v.navTarget, null);
    assert.deepEqual(v.history, { list: ["t1", "t2"], at: 0 });
    Object.assign(v, { navTarget: "t2", navUntil: 1000 });
    globalThis.herdrState = { focused: { terminal: "t3" } };
    v.trackVisit(1500);
    assert.deepEqual(v.history, { list: ["t1", "t3"], at: 1 }, "after the settle time a landing elsewhere is a visit");
  } finally {
    globalThis.herdrState = undefined;
  }
});

test("the window is one cabinet: a marquee bar, the scene, a CRT between two side panels, and the control panel", () => {
  const layout = JSON.parse(readFileSync(new URL("../layouts/arcade.json", import.meta.url), "utf8"));
  assert.deepEqual(layout.background, { gradient: ["cab", "canvas"], angle: 180 }, "the cabinet's body colour runs down into the room");
  assert.deepEqual([layout.padding, layout.gap], [[10, 14], 10]);

  const bar = findNode(layout, "marquee-bar");
  assert.deepEqual([bar.size, bar.background, bar.window_drag, bar.padding], [{ px: 40 }, "cab", true, [0, 12]]);
  assert.deepEqual(bar.children.map((child) => child.id), ["lights-room", "cards-title", "tabs", "cards-tools"]);

  const marquee = findNode(layout, "marquee");
  assert.deepEqual(marquee.content.props, { frame: "marquee" });
  assert.deepEqual(marquee.border, { width: 3, color: "cabEdge" }, "the scene is framed in the cabinet's edge colour");

  const main = findNode(layout, "main");
  assert.deepEqual(main.content.pane.border, { width: 2, color: "border" }, "the CRT has the side panels' edge");
  assert.equal(main.content.pane.radius, 0, "and a square screen");
  assert.deepEqual(main.content.pane.focus, { width: 2, color: "accent" });
  assert.equal(main.content.pane.header.content.mod, "arcade-pane");
  assert.equal("background" in main, false, "no block background shows behind the screen");

  const credit = findNode(layout, "credit-panel");
  assert.equal(credit.type, "column");
  assert.deepEqual(findNode(layout, "credit").content.props, { role: "board" });
  assert.deepEqual(findNode(layout, "rail-buttons").content.props, { role: "buttons" });
  assert.deepEqual(findNode(layout, "panel").content.props, { role: "panel" });
  assert.equal(findNode(layout, "cab-top").gap, 10, "the marquee and the middle row keep the layout's gap");
});

test("the marquee bar leaves the macOS traffic lights their room", () => {
  const layout = JSON.parse(readFileSync(new URL("../layouts/arcade.json", import.meta.url), "utf8"));
  assert.deepEqual(layout.traffic_lights, [12, 16], "the system draws the window buttons over the layout there");
  const bar = findNode(layout, "marquee-bar");
  const [, side] = layout.padding;
  let x = side + bar.padding[1];
  for (const child of bar.children) {
    if (child.id === "cards-title") break;
    x += (child.size?.px ?? 0) + bar.gap;
  }
  assert.equal(x, 78, "the first text starts right of the buttons, 78 px from the window's left edge");
});

test("every row and column in the layout carries a children list, as Herdr's layout parser requires", () => {
  const layout = JSON.parse(readFileSync(new URL("../layouts/arcade.json", import.meta.url), "utf8"));
  const missing = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if ((node.type === "row" || node.type === "column") && !Array.isArray(node.children)) missing.push(node.id);
    Object.values(node).forEach(walk);
  };
  walk(layout);
  assert.deepEqual(missing, []);
});

test("the panels sit square on the dark floor, the head reads in the display face and the tabs show stages", () => {
  const bodyOf = (source, name) => {
    const start = source.indexOf(name);
    assert.ok(start >= 0, `${name} is in the file`);
    const ends = ["\n}", "\n  }"].map((marker) => source.indexOf(marker, start)).filter((at) => at >= 0);
    return source.slice(start, Math.min(...ends));
  };

  const cards = readFileSync(new URL("../mods/arcade-cards/main.js", import.meta.url), "utf8");
  assert.ok(cards.includes('v_flex().id("arcade-cards").relative().size_full().min_h(0).rounded(0).bg(INK.surface)'));
  const fade = bodyOf(cards, "function edgeFade");
  assert.ok(fade.includes(".top(12).bottom(12)"), "the fade stays clear of the panel's top and bottom edges");
  assert.ok(fade.includes("INK.surface"));
  const ring = bodyOf(cards, "focusRing() {");
  assert.ok(ring.includes(".left(0).top(0).right(0).bottom(0)"));
  assert.ok(ring.includes(".rounded(0)"));
  assert.ok(ring.includes("INK.focus"));
  assert.ok(cards.includes(".text_size(14).font_family(DISPLAY)"), "the head title uses Galmuri14");

  assert.ok(cards.includes('.bg(INK.surface).border(2).border_color(INK.line).cursor_pointer()'));
  assert.ok(cards.includes("style.bg(INK.chrome)"));
  assert.ok(cards.includes('.bg(INK.bg).border(2).border_color(state.focused ? INK.focus : INK.line)'));
  assert.ok(cards.includes("state.query ? INK.t1 : INK.t2"));

  const scene = readFileSync(new URL("../mods/arcade-scene/main.js", import.meta.url), "utf8");
  assert.ok(scene.includes('div().id("arcade-frame").w(W).h(H).relative().overflow_hidden().rounded(0).bg(FRAME_BG)'),
    "the scene panel is square on the dark floor");
  assert.equal(scene.includes("cornerMask"), false, "a square panel needs no corner masks");
  assert.equal(scene.includes("PathBuilder"), false, "and no path painting for one");

  const tabs = readFileSync(new URL("../mods/arcade-tabs/main.js", import.meta.url), "utf8");
  assert.ok(tabs.includes('.font_family(BODY)'));
  assert.ok(tabs.includes('bg(c.active ? SURFACE : BG)'));
  assert.ok(tabs.includes("div().w(170).flex_none().truncate()"));
  assert.ok(tabs.includes("`1-${i + 1}`"), "each tab shows its stage number");
});

test("⌘↩ opens the selected card's menu, the one a right-click opens", () => {
  const v = view([session("a", "waiting", 3), session("d", "idle", 5)]);
  Object.assign(v, { scroll: { scroll_to_item() {} }, sel: "d" });
  let opened = null;
  let gone = null;
  let at = "unset";
  v.openLinks = (key, _cx, where) => { opened = key; at = where; };
  v.goTo = (item) => { gone = item.sessionId; };
  const cx = { stop_propagation() {}, notify() {}, spawn() {} };
  v.key({ key: "enter", modifiers: { alt: false, shift: false, platform: true, control: false }, key_char: null, is_held: false }, cx);
  assert.equal(opened, "card-d");
  assert.equal(at, undefined, "before the pointer has crossed the strip the menu falls back to the pointer");
  assert.equal(gone, null, "⌘↩ does not open the session");
  v.key({ key: "enter", modifiers: { alt: false, shift: false, platform: false, control: false }, key_char: null, is_held: false }, cx);
  assert.equal(gone, "d", "plain ↩ still opens the session");
});

test("a keyboard-opened card menu sits under its card, from the strip box the last pointer move left", () => {
  const v = view([session("a", "waiting", 3), session("d", "idle", 5)]);
  Object.assign(v, { scroll: { scroll_to_item() {} }, wheel: { acc: 0, index: 0, off: 0, at: 0, gesture: false, dir: 0 } });
  v.trackStrip({ position: { x: 500, y: 120 }, local_position: { x: 300, y: 70 }, bounds: { x: 0, y: 0, width: 1200, height: 260 } });
  assert.deepEqual(v.stripBox, { x: 200, y: 50, width: 1200, height: 260 });
  assert.equal(v.wheel.viewportW, 1200);
  const strip = v.buildStrip(v.viewData());
  const index = strip.findIndex((entry) => entry.kind === "card" && entry.item.sessionId === "d");
  const left = strip.slice(0, index).reduce((sum, entry) => sum + entry.w, 0) + strip[index].lead;
  assert.deepEqual(v.cardMenuAt("d"), { x: 200 + left, y: 50 + 260 - 8 });
  v.wheel.off = left + 10_000;
  assert.equal(v.cardMenuAt("d").x, 200, "a card scrolled past the left edge keeps the menu inside the strip");
  assert.equal(v.cardMenuAt("nope"), undefined);

  globalThis.herdrOverlays = [];
  v.openLinks("card-d", { notify() {} }, { x: 10, y: 20 });
  assert.deepEqual(globalThis.herdrOverlays[0].at, { x: 10, y: 20 });
  v.openLinks("card-d", { notify() {} });
  assert.equal("at" in globalThis.herdrOverlays[1], false, "a right-click still opens at the pointer");
  globalThis.herdrOverlays = undefined;
});

test("the card tooltip names a repeated title once and puts the details on a second line", () => {
  assert.equal(cardTooltip("Same title", "Same title", ["repo", null, "Cat", "Working"]), "Same title\nrepo · Cat · Working");
  assert.equal(cardTooltip("ABC-1465", "Fix login", ["cconsole"]), "ABC-1465 · Fix login\ncconsole");
  assert.equal(cardTooltip(null, null, ["repo"]), "repo");
});

test("the control panel numbers a button per shown session, across the groups, and the strip keys move and open them", () => {
  const v = view([session("a", "waiting", 3), session("w", "busy", 2), session("d", "idle", 5)]);
  const groups = v.panelGroups(v.viewData(NOW).groups);
  assert.deepEqual(groups.map((group) => group.id), ["attention", "working", "done"]);
  assert.deepEqual(groups.flatMap((group) => group.items.map((entry) => [entry.item.sessionId, entry.player])),
    [["a", 1], ["w", 2], ["d", 3]], "P numbers run across the groups, as on the strip");

  const filtered = view([session("a", "waiting", 3), session("w", "busy", 2)], { shared: { "arcade-filter": ["working"] } });
  assert.deepEqual(filtered.panelGroups(filtered.viewData(NOW).groups).flatMap((group) => group.items.map((entry) => [entry.item.sessionId, entry.player])),
    [["w", 1]], "a filtered-out session takes no button and leaves no number behind");

  globalThis.herdrState = {};
  Object.assign(v, { scroll: { scroll_to_item() {} }, sel: null, selIndex: 0 });
  let gone = null;
  v.goTo = (item) => { gone = item.sessionId; };
  press(v, "right");
  assert.equal(v.sel, "w", "→ moves to the next button");
  press(v, "left");
  assert.equal(v.sel, "a", "← moves back");
  press(v, "enter");
  assert.equal(gone, "a", "↩ opens the selected session, as on the strip");
});

test("the control panel's info area takes the selected session, else the first Needs you one", () => {
  const first = { sessionId: "a1" }, second = { sessionId: "a2" }, work = { sessionId: "w" };
  const groups = [{ id: "working", items: [work] }, { id: "attention", items: [first, second] }];
  assert.equal(infoItemOf(groups, second), second, "a selection is described even when it is not the first");
  assert.equal(infoItemOf(groups, null), first, "with no selection the first Needs you session is described");
  assert.equal(infoItemOf([{ id: "working", items: [work] }], null), null, "no Needs you session leaves the area empty");
  assert.equal(infoItemOf(null, null), null);
});

test("the control panel renders the selected session's info area, and hovering a button raises its card", () => {
  const v = view([session("a", "waiting", 3), session("w", "busy", 2)]);
  Object.assign(v, { role: "panel", k: 1, geo: geometry(1), expanded: new Set(), infoWidth: 0,
    handle: { focus() {}, is_focused: () => false } });
  globalThis.herdrState.shared = {};
  const cx = { notify() {}, timer: { after() {}, every() {} } };
  const seen = [];
  const infoView = v.infoView.bind(v);
  v.infoView = (item, now, g) => { seen.push(item?.sessionId ?? null); return infoView(item, now, g); };
  assert.doesNotThrow(() => v.render(cx));
  assert.deepEqual(seen, ["a"], "with nothing selected the first session is described");
  let cards = 0;
  const card = v.card.bind(v);
  v.card = (...args) => { cards += 1; return card(...args); };
  v.panelHover = "a";
  assert.doesNotThrow(() => v.render(cx));
  assert.equal(cards, 1, "the hovered button builds its full card above it");
  cards = 0;
  v.panelHover = null;
  assert.doesNotThrow(() => v.render(cx));
  assert.equal(cards, 0, "and no card is built while the pointer is away");
  v.sel = "w";
  seen.length = 0;
  assert.doesNotThrow(() => v.render(cx));
  assert.deepEqual(seen, ["w"], "the info area follows the selected session");
});
