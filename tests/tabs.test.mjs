// arcade-tabs: the parts taken from the shipped tabs 0.1.16, and the side panel this layout lacks.
// Run: node --import ./tests/stubs/register.mjs --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import ArcadeTabs, { panelChoices } from "../mods/arcade-tabs/main.js";

const cx = () => ({
  timer: { every() { return { cancel() {} }; }, after() { return { cancel() {} }; } },
  spawn() {},
  notify() {},
  focus_handle() { return { focus() {}, is_focused: () => false, release() { return true; } }; },
});

const fresh = () => {
  const v = new ArcadeTabs();
  v.init({}, cx());
  return v;
};

test("a damaged panels value in localStorage leaves the bar loading with no panels remembered", () => {
  try {
    for (const value of ["null", "[1,2]", "{not json", "7"]) {
      localStorage.setItem("panels", value);
      let v;
      assert.doesNotThrow(() => { v = fresh(); }, value);
      assert.deepEqual(v.panels, {}, value);
      assert.doesNotThrow(() => "s1" in v.panels, value);
    }
    localStorage.setItem("panels", JSON.stringify({ s1: "files" }));
    assert.deepEqual(fresh().panels, { s1: "files" }, "a good value is kept");
  } finally {
    localStorage.setItem("panels", "{}");
  }
});

test("one touchpad swipe of many small wheel events moves one tab, not one per event", () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  globalThis.herdrRuns = [];
  try {
    const v = fresh();
    for (let i = 0; i < 30; i++) { v.wheel({ delta: { x: 0, y: 2 } }); now += 2; }
    assert.deepEqual(globalThis.herdrRuns, [["tab.prev"]], "30 events of 2 px inside 60 ms");
    now += 400;
    for (let i = 0; i < 12; i++) v.wheel({ delta: { x: 0, y: -2 } });
    assert.deepEqual(globalThis.herdrRuns.at(-1), ["tab.next"], "a pause starts a new gesture the other way");
    globalThis.herdrRuns = [];
    v.wheel({ delta: { x: 0, y: 0 }, delta_lines: { x: 0, y: 1 } });
    v.wheel({ delta: { x: 0, y: 0 }, delta_lines: { x: 0, y: -1 } });
    assert.deepEqual(globalThis.herdrRuns, [["tab.prev"], ["tab.next"]], "a mouse notch is one tab each");
  } finally {
    Date.now = realNow;
    globalThis.herdrRuns = undefined;
  }
});

test("Files and Changes are drawn only where the layout has the panel-body stack", () => {
  assert.deepEqual(panelChoices(null, null), [], "this layout: no stack, no buttons");
  assert.deepEqual(panelChoices(null, ["files", "changes"]), [], "even when another layout left them on");
  assert.deepEqual(panelChoices({ id: "panel-body" }, null), ["files", "changes"]);
  assert.deepEqual(panelChoices({ id: "panel-body" }, ["files"]), ["files"]);
});

test("in this layout the cards panel is never shown or hidden as a side panel", () => {
  const arcade = { id: "root", type: "column", children: [{ id: "cab-top" }, { id: "panel", hidden: false }] };
  localStorage.setItem("panels", JSON.stringify({ s2: "files" }));
  globalThis.herdrState = { layout: arcade, spaces: [{ id: "s1", active: true, tabs: [] }], shared: {} };
  globalThis.herdrRuns = [];
  try {
    const v = fresh();
    v.render();
    globalThis.herdrState.spaces = [{ id: "s2", active: true, tabs: [] }];
    v.render();
    assert.deepEqual(globalThis.herdrRuns, [], "no layout.select on a missing stack, no layout.show/hide of the cards panel");
    assert.equal(localStorage.getItem("panels"), JSON.stringify({ s2: "files" }), "nothing recorded");
  } finally {
    localStorage.setItem("panels", "{}");
    globalThis.herdrRuns = undefined;
    globalThis.herdrState = undefined;
  }
});

test("the active tab is scrolled into view when it changes", () => {
  const tab = (id, active = false) => ({ id, name: id, named: true, active });
  globalThis.herdrState = { spaces: [{ id: "s1", active: true, tabs: [tab("a"), tab("b"), tab("c", true)] }], shared: {} };
  try {
    const v = fresh();
    const asked = [];
    v.scroll = { scroll_to_item: (i) => asked.push(i) };
    v.render();
    v.render();
    assert.deepEqual(asked, [2], "once for the new active tab");
    globalThis.herdrState.spaces[0].tabs = [tab("a", true), tab("b"), tab("c")];
    v.render();
    assert.deepEqual(asked, [2, 0]);
  } finally {
    globalThis.herdrState = undefined;
  }
});
